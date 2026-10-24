// Manuell slettejobb for felles innspill.
// Ikke planlegg denne i prod. Ingen pg_cron og ingen kall herfra til cron.
// verify_jwt = true er ikke nok alene. Krever x-cron-secret.
// Sender ingen e-post.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hemmeligheterStemmer } from "../_shared/samtykke.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false }), { status: 405, headers: CORS });
  }
  if (!hemmeligheterStemmer(req.headers.get("x-cron-secret"), Deno.env.get("SLETT_SIGNATUR_SECRET"))) {
    return new Response(JSON.stringify({ ok: false, feil: "Avvist." }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await db.rpc("slett_utlopte_signaturer");
  if (error) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true, resultat: data }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
