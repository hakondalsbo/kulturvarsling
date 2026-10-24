// Høringshjelp: utkast for innloggede brukere. Av til HORINGSHJELP_AKTIV=true.
// Svaret sendes ikke. Funksjonen skriver bare døgnkvoten, med service_role.
// Selve utkastet lagres av brukeren fra klienten, under RLS.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { kallClaude } from "../_shared/claude.ts";
import { reserverAiKvote } from "../_shared/tilgang.ts";
import { trekkUtTekst } from "../klartekst/logikk.ts";
import {
  HORING_MAKS_TOKENS,
  HORING_MODELL,
  HORING_TEMPERATUR,
  htmlTilTekst,
  hentBearerToken,
  kjorHoringshjelp,
  nesteTryggeUrl,
  tryggKildeUrl,
  type OffisiellKilde,
  type SakRad,
} from "./logikk.ts";
import { corsHeadere } from "../_shared/cors.ts";

function svar(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadere(req), "Content-Type": "application/json" },
  });
}

async function lesOffisiellKilde(sak: SakRad): Promise<OffisiellKilde> {
  const fallback = [sak.tittel, sak.sammendrag, sak.instans, sak.frist, sak.kilde]
    .filter((del) => typeof del === "string" && del.trim())
    .join("\n");
  if (!sak.kilde || !tryggKildeUrl(sak.kilde)) {
    return { tekst: fallback, hentet: null, grunnlag: "sak" };
  }
  try {
    let url = sak.kilde;
    let res: Response | null = null;
    for (let hopp = 0; hopp < 4; hopp++) {
      if (!tryggKildeUrl(url)) return { tekst: fallback, hentet: null, grunnlag: "sak" };
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        headers: { accept: "text/html, text/plain;q=0.9" },
      });
      if (res.status >= 300 && res.status < 400) {
        const neste = nesteTryggeUrl(url, res.headers.get("location"));
        await res.body?.cancel();
        if (!neste) return { tekst: fallback, hentet: null, grunnlag: "sak" };
        url = neste;
        res = null;
        continue;
      }
      break;
    }
    if (!res || !res.ok) return { tekst: fallback, hentet: null, grunnlag: "sak" };
    const type = res.headers.get("content-type") ?? "";
    if (type && !/text\/html|text\/plain|application\/xhtml/.test(type)) {
      return { tekst: fallback, hentet: null, grunnlag: "sak" };
    }
    const rå = (await res.text()).slice(0, 500_000);
    const ren = htmlTilTekst(rå);
    if (ren.length < 200) return { tekst: fallback, hentet: null, grunnlag: "sak" };
    return { tekst: ren, hentet: new Date().toISOString(), grunnlag: "notat" };
  } catch (e) {
    console.error("horingshjelp kilde", String(e).slice(0, 160));
    return { tekst: fallback, hentet: null, grunnlag: "sak" };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeadere(req) });
  if (req.method !== "POST") return svar(req, { feil: "Bruk POST" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return svar(req, { feil: "Tjenesten er ikke konfigurert" }, 503);

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return svar(req, { feil: "Ugyldig JSON" }, 400);
  }

  const resultat = await kjorHoringshjelp(
    { token: hentBearerToken(req.headers.get("authorization")), body },
    {
      aktiv: Deno.env.get("HORINGSHJELP_AKTIV") === "true",
      getUser: async (token) => {
        const { data, error } = await db.auth.getUser(token);
        if (error || !data.user) return null;
        return { id: data.user.id, anonymous: data.user.is_anonymous === true || data.user.role === "anon" };
      },
      hentProfil: async (brukerId) => {
        const { data, error } = await db.from("profiler").select("plan").eq("id", brukerId).maybeSingle();
        if (error) return "feil";
        return data;
      },
      hentSak: async (id) => {
        const { data, error } = await db
          .from("varsler")
          .select("id, tittel, sammendrag, instans, frist, kilde")
          .eq("id", id)
          .eq("publisert", true)
          .maybeSingle();
        if (error) return "feil";
        return data;
      },
      hentOffisiellKilde: lesOffisiellKilde,
      reserverKvote: (brukerId) => reserverAiKvote(db, brukerId, "horingshjelp", false),
      kallModell: async (prompt) => {
        const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
        if (!apiKey) return null;
        const res = await kallClaude({
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: HORING_MODELL,
            max_tokens: HORING_MAKS_TOKENS,
            temperature: HORING_TEMPERATUR,
            system: prompt,
            messages: [{ role: "user", content: "Skriv utkastet." }],
          }),
        }, "horingshjelp");
        if (!res.ok) {
          console.error(`horingshjelp Claude HTTP ${res.status}`);
          return null;
        }
        const data = await res.json();
        const tekst = trekkUtTekst(data.content).trim();
        return tekst || null;
      },
    },
  );

  return svar(req, resultat.body, resultat.status);
});
