// Tar imot tilbakemelding fra innloggede og utloggede.
// verify_jwt er av, fordi utloggede også skal kunne sende.
// Fartsgrensen og lengdesjekken ligger her. Bruker-id tas bare fra verifisert JWT.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { corsHeadere } from "../_shared/cors.ts";
import { klientIp, registrerFartsgrense, sha256Hex } from "../_shared/fartsgrense.ts";
import { hentBearerToken } from "../klartekst/logikk.ts";
import {
  FART_TILBAKEMELDING_BRUKER,
  FART_TILBAKEMELDING_IP,
  forsokLagre,
  validerTilbakemelding,
} from "../_shared/tilbakemelding.ts";

function svar(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadere(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeadere(req) });
  if (req.method !== "POST") return svar(req, { ok: false, feil: "Bruk POST" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return svar(req, { ok: false, feil: "Tjenesten er ikke konfigurert." }, 503);

  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    return svar(req, { ok: false, feil: "Ugyldig JSON." }, 400);
  }
  const validert = validerTilbakemelding(raw);
  if (!validert.ok) return svar(req, { ok: false, feil: validert.feil }, 400);

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = hentBearerToken(req.headers.get("authorization"));
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  let brukerId: string | null = null;
  if (token && token !== anon) {
    const { data, error } = await db.auth.getUser(token);
    if (!error && data.user && data.user.is_anonymous !== true && data.user.role !== "anon") {
      brukerId = data.user.id;
    }
  }

  const nokler = [
    { nokkel: `ip:${await sha256Hex(klientIp(req))}`, grense: FART_TILBAKEMELDING_IP },
  ];
  if (brukerId) {
    nokler.push({ nokkel: `bruker:${await sha256Hex(brukerId)}`, grense: FART_TILBAKEMELDING_BRUKER });
  }
  const fart = await registrerFartsgrense(db, "tilbakemelding", nokler);
  if (fart === "utilgjengelig") {
    return svar(req, { ok: false, feil: "Tilbakemelding er midlertidig utilgjengelig. Prøv igjen." }, 503);
  }
  if (fart === "blokkert") {
    return svar(req, { ok: false, feil: "Du har sendt flere tilbakemeldinger på kort tid. Vent litt og prøv igjen." }, 429);
  }

  const lagret = await forsokLagre(
    {
      insert: async (rad) => {
        const { error } = await db.from("feedback").insert(rad);
        return { error: error ? { message: error.message } : null };
      },
    },
    validert.verdi,
    brukerId,
  );
  if (lagret !== "ok") return svar(req, { ok: false, feil: "Kunne ikke lagre tilbakemeldingen. Prøv igjen." }, 503);
  return svar(req, { ok: true });
});
