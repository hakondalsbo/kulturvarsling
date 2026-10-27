import { harPremium, reserverAiKvote } from "../_shared/tilgang.ts";
import { kallClaude } from "../_shared/claude.ts";
import { kildegrunnlag, lagreTallSperring, loggUdokumenterteTall } from "../_shared/kildekontroll.ts";
// Klartekst (VEIKART E2): «Hva betyr dette for deg?»
// POST {varsel_id} med innlogget bruker-JWT →
//   {svar: {hva_skjer, hvem_pavirkes, tall_belop, frist, hva_kan_du_gjore}, cachet}
// Profilen hentes alltid server-side fra profiler. Svaret caches per sak +
// normalisert profiltype i klartekst_cache.
// Skriver til klartekst_cache, og ved tall uten kilde én rad i
// varsel_sperringer. Aldri til varsler. Tittel, sammendrag og kategori
// — også når manuelt_redigert er satt — blir ikke rørt her.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import {
  byggPrompt,
  hentBearerToken,
  KLARTEKST_MAKS_TOKENS,
  KLARTEKST_MODELL,
  klartekstSomTekst,
  lagProfilNokkel,
  lagInnholdsNokkel,
  lesGyldigCache,
  normaliserProfil,
  normaliserVarselId,
  parseKlartekstSvar,
  trekkUtTekst,
  type KlartekstSvar,
  type Profil,
} from "./logikk.ts";
import { corsHeadere } from "../_shared/cors.ts";

function svar(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadere(req), "Content-Type": "application/json" },
  });
}

const MAKS_BODY_BYTES = 2048;
const LOKAL_CACHE_MAKS = 128;
const MAKS_SAMTIDIGE_GENERERINGER = 8;
const lokalCache = new Map<string, KlartekstSvar>();
const pågåendeGenereringer = new Map<string, Promise<KlartekstSvar | null>>();

async function lesJsonBody(req: Request): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: 400 | 413; feil: string }
> {
  const oppgittLengde = Number(req.headers.get("content-length"));
  if (Number.isFinite(oppgittLengde) && oppgittLengde > MAKS_BODY_BYTES) {
    return { ok: false, status: 413, feil: "Forespørselen er for stor" };
  }

  if (!req.body) return { ok: false, status: 400, feil: "Ugyldig JSON" };
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let tekst = "";
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAKS_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, status: 413, feil: "Forespørselen er for stor" };
    }
    tekst += decoder.decode(value, { stream: true });
  }
  tekst += decoder.decode();

  try {
    const data = JSON.parse(tekst);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, status: 400, feil: "Ugyldig JSON" };
    }
    return { ok: true, data: data as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, feil: "Ugyldig JSON" };
  }
}

function leggILokalCache(nøkkel: string, verdi: KlartekstSvar): void {
  if (!lokalCache.has(nøkkel) && lokalCache.size >= LOKAL_CACHE_MAKS) {
    const eldste = lokalCache.keys().next().value;
    if (eldste) lokalCache.delete(eldste);
  }
  lokalCache.set(nøkkel, verdi);
}

async function spørClaude(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const res = await kallClaude({
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: KLARTEKST_MODELL,
        // Sonnet 5 tenker adaptivt som standard, og tenke-tokens teller mot
        // max_tokens — gi rom nok til både tenking og selve JSON-svaret.
        max_tokens: KLARTEKST_MAKS_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    }, "klartekst");
    if (!res.ok) {
      console.error(`Claude API HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    return trekkUtTekst(data.content);
  } catch (e) {
    console.error("Claude-kall feilet:", String(e).slice(0, 200));
    return null;
  }
}

async function genererKlartekst(
  cacheNøkkel: string,
  sak: {
    tittel: string;
    sammendrag?: string | null;
    instans?: string | null;
    frist?: string | null;
    niva?: string | null;
    sted?: string | null;
  },
  profil: Profil,
  apiKey: string,
): Promise<KlartekstSvar | null> {
  const pågår = pågåendeGenereringer.get(cacheNøkkel);
  if (pågår) return await pågår;

  const generering = (async () => {
    const prompt = byggPrompt(sak, profil);
    const tekst = await spørClaude(prompt, apiKey);
    const parsed = tekst ? parseKlartekstSvar(tekst) : null;
    return parsed;
  })();

  pågåendeGenereringer.set(cacheNøkkel, generering);
  try {
    return await generering;
  } finally {
    if (pågåendeGenereringer.get(cacheNøkkel) === generering) {
      pågåendeGenereringer.delete(cacheNøkkel);
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeadere(req) });
  if (req.method !== "POST") return svar(req, { feil: "Bruk POST" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Klartekst mangler påkrevd Supabase-konfigurasjon");
      return svar(req, { feil: "Tjenesten er ikke konfigurert" }, 503);
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Håndhev brukerinnlogging også i funksjonen. Gateway-verifisering er et
    // ekstra lag, men funksjonen skal være sikker selv ved feil deploy-config.
    const token = hentBearerToken(req.headers.get("authorization"));
    if (!token) return svar(req, { feil: "Du må være innlogget" }, 401);
    const { data: authData, error: authFeil } = await supabase.auth.getUser(token);
    const bruker = authData.user;
    if (authFeil || !bruker || bruker.is_anonymous === true || bruker.role === "anon") {
      return svar(req, { feil: "Du må være innlogget" }, 401);
    }

    const body = await lesJsonBody(req);
    if (!body.ok) return svar(req, { feil: body.feil }, body.status);
    const varselId = normaliserVarselId(body.data.varsel_id);
    if (!varselId) return svar(req, { feil: "Ugyldig varsel_id" }, 400);

    // Profilen kommer fra canonical database-rad, aldri fra klient-body.
    const { data: profilRad, error: profilFeil } = await supabase
      .from("profiler")
      .select("fagfelt, org_type, fylkesnr, plan")
      .eq("id", bruker.id)
      .maybeSingle();
    if (profilFeil) {
      console.error("Klartekst profiloppslag feilet");
      return svar(req, { feil: "Kunne ikke hente profilen akkurat nå" }, 503);
    }
    if (!profilRad) {
      return svar(req, { feil: "Fullfør profilen før du ber om klartekst" }, 409);
    }
    const profil = normaliserProfil(profilRad);

    // Service role omgår RLS. Saken må derfor bekreftes publisert FØR både
    // lokal og persistent cache leses, ellers kan avpubliserte saker lekke.
    const { data: sak, error: sakFeil } = await supabase
      .from("varsler")
      .select("tittel, sammendrag, instans, frist, niva, sted")
      .eq("id", varselId)
      .eq("publisert", true)
      .maybeSingle();
    if (sakFeil) {
      console.error("Klartekst saksoppslag feilet");
      return svar(req, { feil: "Kunne ikke hente saken akkurat nå" }, 503);
    }
    if (!sak) return svar(req, { feil: "Fant ikke saken" }, 404);

    const profilNøkkel = lagProfilNokkel(profil);
    const innhold = await lagInnholdsNokkel(byggPrompt(sak, profil), KLARTEKST_MODELL);
    const cacheNøkkel = `${varselId}|${profilNøkkel}|${innhold}`;
    const lokaltSvar = lokalCache.get(cacheNøkkel);
    if (lokaltSvar) return svar(req, { svar: lokaltSvar, cachet: true });

    // Ved cache-feil genererer vi ikke et nytt, betalbart svar. Det forhindrer
    // en databasefeil fra å bli til en kostnadsløkke.
    const { data: cachet, error: cacheFeil } = await supabase
      .from("klartekst_cache")
      .select("svar")
      .eq("varsel_id", varselId)
      .eq("profil_nokkel", profilNøkkel)
      .maybeSingle();
    if (cacheFeil) {
      console.error("Klartekst cache-oppslag feilet");
      return svar(req, { feil: "Kunne ikke hente forklaringen akkurat nå" }, 503);
    }
    if (cachet?.svar) {
      const validertCache = lesGyldigCache(cachet.svar, innhold);
      if (validertCache) {
        leggILokalCache(cacheNøkkel, validertCache);
        return svar(req, { svar: validertCache, cachet: true });
      }
      console.error("Klartekst-cache inneholdt ugyldig svar");
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      console.error("ANTHROPIC_API_KEY mangler");
      return svar(req, { feil: "AI-laget er ikke konfigurert" }, 503);
    }

    if (
      !pågåendeGenereringer.has(cacheNøkkel) &&
      pågåendeGenereringer.size >= MAKS_SAMTIDIGE_GENERERINGER
    ) {
      return svar(req, { feil: "Tjenesten har høy belastning — prøv igjen om litt" }, 429);
    }

    // Én pågående generering per cache-nøkkel i samme isolat. Det fjerner den
    // vanligste samtidighetsdobbeltkostnaden uten å utvide databaseskjemaet.
    if (!pågåendeGenereringer.has(cacheNøkkel)) {
      const kvote = await reserverAiKvote(supabase, bruker.id, "klartekst", harPremium(profilRad));
      if (kvote !== "ok") return svar(req, { feil: kvote === "grense" ? "Du har nådd grensen for nye forklaringer i dag. Lagrede forklaringer er fortsatt tilgjengelige." : "Kunne ikke kontrollere analysegrensen akkurat nå" }, kvote === "grense" ? 429 : 503);
    }
    const parsed = await genererKlartekst(cacheNøkkel, sak, profil, apiKey);
    if (!parsed) {
      console.error("Klartekst fikk ikke et gyldig AI-svar");
      return svar(req, { feil: "AI-laget er utilgjengelig akkurat nå — prøv igjen om litt" }, 502);
    }
    leggILokalCache(cacheNøkkel, parsed);

    // Flagget stopper ikke svaret. varsler-raden skrives ikke.
    // Avviket blir en sporbar rad med varsel-id og årsak tall_uten_kilde.
    const avvik = loggUdokumenterteTall(
      "klartekst",
      klartekstSomTekst(parsed),
      kildegrunnlag([sak.tittel, sak.sammendrag, sak.instans, sak.frist, sak.sted]),
      sak.tittel,
    );
    const sperreFeil = await lagreTallSperring(supabase, varselId, "klartekst", avvik);
    if (sperreFeil) console.error("varsel_sperringer klartekst:", sperreFeil.slice(0, 120));

    // Bare cache-tabellen. varsler.tittel/sammendrag/kategori oppdateres ikke.
    const { error: cacheLagreFeil } = await supabase.from("klartekst_cache").upsert(
      { varsel_id: varselId, profil_nokkel: profilNøkkel, svar: { ...parsed, _innhold: innhold } },
      { onConflict: "varsel_id,profil_nokkel" },
    );
    if (cacheLagreFeil) console.error("Klartekst cache-lagring feilet");

    return svar(req, { svar: parsed, cachet: false });
  } catch (e) {
    console.error("Klartekst uventet feil:", e instanceof Error ? e.name : "ukjent");
    return svar(req, { feil: "Uventet feil i klartekst-tjenesten" }, 500);
  }
});
