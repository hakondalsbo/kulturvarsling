// Innloggets egne innspill. verify_jwt = true.
// Leser via service_role og returnerer bare denne brukerens rader,
// uten e-post. Andre signaturer er ikke med.
// Når MOBILISERING_SIGNATUR_AKTIV er av, returneres en tom liste.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { signaturMottakAktiv } from "../_shared/mobilisering-kjerne.ts";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return svar({ ok: false }, 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return svar({ ok: false, feil: "Du må være innlogget." }, 401);

  const somBruker = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: { user } } = await somBruker.auth.getUser();
  if (!user?.id) return svar({ ok: false, feil: "Du må være innlogget." }, 401);
  if (!signaturMottakAktiv(Deno.env.get("MOBILISERING_SIGNATUR_AKTIV"))) {
    return svar({ ok: true, aapent: false, innspill: [] });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await db.from("kampanje_signaturer")
    .select("kampanje_id, varsel_id, bekreftet_tid, trukket_tid, kampanjer(tittel, sak_id, slag)")
    .eq("bruker_id", user.id);
  if (error) return svar({ ok: false, feil: "Kunne ikke hente innspillene." }, 500);

  const innspill = (data ?? [])
    .filter((rad) => {
      const kampanje = rad.kampanjer as { slag?: string } | null;
      return kampanje?.slag === "felles_innspill";
    })
    .map((rad) => {
      const kampanje = rad.kampanjer as { tittel?: string; sak_id?: string | null } | null;
      return {
        innspillId: rad.kampanje_id,
        tittel: kampanje?.tittel ?? "Felles innspill",
        sakId: rad.varsel_id ?? kampanje?.sak_id ?? null,
        bekreftet: !!rad.bekreftet_tid,
        trukket: !!rad.trukket_tid,
      };
    });
  return svar({ ok: true, aapent: true, innspill });
});
