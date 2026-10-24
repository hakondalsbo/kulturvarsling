// Høringshjelp: utkast til høringssvar for innloggede Premium-brukere.
// Svaret sendes ikke. Funksjonen skriver bare døgnkvoten, med service_role.
// Selve utkastet lagres av brukeren fra klienten, under RLS.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { kallClaude } from "../_shared/claude.ts";
import { harPremium, reserverAiKvote } from "../_shared/tilgang.ts";
import { trekkUtTekst } from "../klartekst/logikk.ts";
import {
  HORING_MAKS_TOKENS,
  HORING_MODELL,
  HORING_TEMPERATUR,
  htmlTilTekst,
  hentBearerToken,
  kjorHoringshjelp,
  tryggKildeUrl,
  type OffisiellKilde,
  type SakRad,
} from "./logikk.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function svar(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
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
    const res = await fetch(sak.kilde, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { accept: "text/html, text/plain;q=0.9" },
    });
    if (!res.ok) return { tekst: fallback, hentet: null, grunnlag: "sak" };
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
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return svar({ feil: "Bruk POST" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return svar({ feil: "Tjenesten er ikke konfigurert" }, 503);

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return svar({ feil: "Ugyldig JSON" }, 400);
  }

  const resultat = await kjorHoringshjelp(
    { token: hentBearerToken(req.headers.get("authorization")), body },
    {
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
      reserverKvote: async (brukerId) => {
        const { data: profil } = await db.from("profiler").select("plan").eq("id", brukerId).maybeSingle();
        return reserverAiKvote(db, brukerId, "horingshjelp", harPremium(profil));
      },
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

  return svar(resultat.body, resultat.status);
});
