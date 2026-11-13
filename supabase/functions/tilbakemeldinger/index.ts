// Intern oversikt. Krever verifisert Supabase-JWT og at e-posten
// står i serverhemmeligheten ADMIN_EPOSTER. Ingen adresser i klienten.
// Vanlige brukere har ikke SELECT på public.feedback.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { corsHeadere } from "../_shared/cors.ts";
import { hentBearerToken } from "../klartekst/logikk.ts";
import { erAdminEpost, lesAdminKall } from "../_shared/tilbakemelding.ts";

const KOLONNER = "id, type, tekst, sak_tittel, sak_id, side, status, opprettet, bruker_id";

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

  const token = hentBearerToken(req.headers.get("authorization"));
  if (!token) return svar(req, { ok: false, feil: "Logg inn for å se oversikten." }, 401);

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authFeil } = await db.auth.getUser(token);
  const bruker = auth.user;
  if (authFeil || !bruker) return svar(req, { ok: false, feil: "Logg inn for å se oversikten." }, 401);
  const admin = erAdminEpost(bruker.email, Deno.env.get("ADMIN_EPOSTER"), !!bruker.email_confirmed_at);
  if (!admin) return svar(req, { ok: false, feil: "Denne kontoen har ikke tilgang til oversikten." }, 403);

  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    return svar(req, { ok: false, feil: "Ugyldig JSON." }, 400);
  }
  const kall = lesAdminKall(raw);
  if ("feil" in kall) return svar(req, { ok: false, feil: kall.feil }, 400);

  if (kall.handling === "status") {
    const { data, error } = await db.from("feedback")
      .update({ status: kall.status })
      .eq("id", kall.id)
      .select("id, status")
      .maybeSingle();
    if (error) return svar(req, { ok: false, feil: "Kunne ikke oppdatere statusen." }, 503);
    if (!data) return svar(req, { ok: false, feil: "Fant ikke tilbakemeldingen." }, 404);
    return svar(req, { ok: true, id: data.id, status: data.status });
  }

  let sporring = db.from("feedback").select(KOLONNER).order("opprettet", { ascending: false }).limit(200);
  if (kall.status) sporring = sporring.eq("status", kall.status);
  if (kall.type) sporring = sporring.eq("type", kall.type);
  const { data, error } = await sporring;
  if (error) {
    console.error("tilbakemeldinger les", error.message.slice(0, 160));
    return svar(req, { ok: false, feil: "Oversikten er ikke klar ennå. Migrasjonen må kjøres før den kan leses." }, 503);
  }
  return svar(req, { ok: true, rader: data ?? [] });
});
