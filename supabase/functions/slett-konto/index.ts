// Sletter innlogget bruker og data som er knyttet til kontoen.
// Krever brukerens JWT (verify_jwt = true). Service role brukes bare
// etter at getUser har bekreftet tokenet. user_metadata brukes ikke.
//
// Suksess returneres bare når auth-brukeren faktisk er slettet.
// horingssvar og feedback har ON DELETE SET NULL og må slettes først,
// ellers blir teksten liggende uten eier.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { SLETT_FØR_BRUKER, normaliserEpost } from "../_shared/samtykke.ts";
import { corsHeadere } from "../_shared/cors.ts";

function svar(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadere(req), "Content-Type": "application/json" },
  });
}

const IKKE_SLETTET = "Kontoen ble ikke slettet. Prøv igjen, eller skriv til post@kulturvarsling.no.";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadere(req) });
  if (req.method !== "POST") return svar(req, { ok: false, feil: IKKE_SLETTET }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return svar(req, { ok: false, feil: "Du må være innlogget." }, 401);

  const somBruker = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: { user }, error: brukerFeil } = await somBruker.auth.getUser();
  if (brukerFeil || !user?.id) return svar(req, { ok: false, feil: "Du må være innlogget." }, 401);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  for (const tabell of SLETT_FØR_BRUKER) {
    const { error } = await db.from(tabell).delete().eq("bruker_id", user.id);
    if (error) {
      console.error("slett", tabell, error.message);
      return svar(req, { ok: false, feil: IKKE_SLETTET }, 500);
    }
  }

  if (user.email) {
    const { data: rader, error: lesFeil } = await db.from("pamelding")
      .select("id")
      .eq("epost_normalisert", normaliserEpost(user.email));
    if (lesFeil) {
      console.error("slett pamelding les", lesFeil.message);
      return svar(req, { ok: false, feil: IKKE_SLETTET }, 500);
    }
    const ids = (rader ?? []).map((rad) => rad.id);
    if (ids.length) {
      const { error } = await db.from("pamelding").delete().in("id", ids);
      if (error) {
        console.error("slett pamelding", error.message);
        return svar(req, { ok: false, feil: IKKE_SLETTET }, 500);
      }
    }
  }

  // Tilgangstokenet er gyldig til det utløper selv om brukeren slettes.
  // Global utlogging trekker sesjonene først. Selve suksessen krever deleteUser.
  await db.auth.admin.signOut(jwt, "global").catch((feil) => {
    console.error("signOut før sletting", feil);
  });

  const { error: slettFeil } = await db.auth.admin.deleteUser(user.id);
  if (slettFeil) {
    console.error("deleteUser", slettFeil.message);
    return svar(req, { ok: false, feil: IKKE_SLETTET }, 500);
  }

  return svar(req, { ok: true, melding: "Kontoen og de tilknyttede dataene er slettet." });
});
