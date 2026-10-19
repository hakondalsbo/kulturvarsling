// Tokenbasert avmelding. verify_jwt = false: lenken klikkes fra e-post
// uten Authorization-header. Det eneste som godtas, er avmeldings_token.
// GET endrer ingenting. POST (skjema eller List-Unsubscribe=One-Click)
// skriver avmeldt_at. Suksess vises bare når skrivingen lykkes.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  erUuid,
  lesToken,
  skalSkriveAvmelding,
  svarEtterSkriving,
} from "../_shared/samtykke.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function svar(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!skalSkriveAvmelding(req.method)) {
    return svar({
      ok: false,
      feil: "Ingenting er endret. Åpne avmeldingslenken og trykk på knappen.",
    }, 405);
  }

  const url = new URL(req.url);
  const bodyTekst = await req.text();
  const contentType = req.headers.get("content-type") ?? "";
  const token = lesToken(url, bodyTekst, contentType);
  if (!erUuid(token)) {
    return svar({ ok: false, feil: "Ugyldig avmeldingslenke. Ingenting er endret." }, 400);
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await db.from("pamelding")
    .select("id, epost_normalisert, avmeldt_at")
    .eq("avmeldings_token", token);
  if (error) {
    console.error("avmeld les", error.message);
    return svar({ ok: false, feil: "Kunne ikke melde deg av. Ingenting er endret." }, 500);
  }
  if (!data?.length || !data[0].epost_normalisert) {
    return svar({ ok: false, feil: "Ugyldig avmeldingslenke. Ingenting er endret." }, 404);
  }

  const { data: søsken, error: søskenFeil } = await db.from("pamelding")
    .select("id, avmeldt_at")
    .eq("epost_normalisert", data[0].epost_normalisert);
  if (søskenFeil) {
    console.error("avmeld søsken", søskenFeil.message);
    return svar({ ok: false, feil: "Kunne ikke melde deg av. Ingenting er endret." }, 500);
  }
  const allerede = (søsken ?? []).length > 0 && (søsken ?? []).every((rad) => rad.avmeldt_at);
  if (allerede) {
    return svar({ ok: true, melding: "Du er allerede meldt av nyhetsbrevet." });
  }

  const skrevet = await db.from("pamelding")
    .update({ avmeldt_at: new Date().toISOString() })
    .eq("epost_normalisert", data[0].epost_normalisert)
    .is("avmeldt_at", null);
  const resultat = svarEtterSkriving(skrevet.error?.message ?? null);
  if (!resultat.ok) {
    console.error("avmeld skriv", resultat.feil);
    return svar({ ok: false, feil: "Kunne ikke melde deg av. Ingenting er endret." }, 500);
  }
  return svar({ ok: true, melding: "Du er meldt av nyhetsbrevet." });
});
