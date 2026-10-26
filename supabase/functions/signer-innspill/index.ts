// Signering, bekreftelse og trekk for felles innspill.
// verify_jwt = false: lenken i e-posten og skjemaet uten innlogging
// har ingen brukersesjon. Rate limit og dobbel opt-in erstatter direkte INSERT.
// Mottaket er av til MOBILISERING_SIGNATUR_AKTIV er nøyaktig true.
// E-post sendes bare når UTSENDING_AKTIV også er true. Ellers mockes brevet.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { byggSignaturBrev } from "../_shared/mobilisering.ts";
import {
  ALLEREDE_SIGNERT,
  SAMTYKKE_VERSJON,
  bekreftSignatur,
  erUuid,
  fyllSamtykke,
  sha256Hex,
  signaturMottakAktiv,
  svarVedSignaturKonflikt,
  trekkSignatur,
  validerSignering,
  vurderCaptcha,
} from "../_shared/mobilisering-kjerne.ts";
import { corsHeadere } from "../_shared/cors.ts";
import {
  FART_BRUKER,
  FART_EPOST,
  FART_IP,
  klientIp as ipFraForesporsel,
  registrerFartsgrense,
} from "../_shared/fartsgrense.ts";

function svar(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadere(req), "Content-Type": "application/json" },
  });
}

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function klientIp(req: Request): string {
  return ipFraForesporsel(req);
}

function offentlig(): string {
  return (Deno.env.get("OFFENTLIG_URL") ?? "https://www.kulturvarsling.no").replace(/\/$/, "");
}

async function godkjennCaptcha(req: Request, body: Record<string, unknown>, ip: string): Promise<Response | null> {
  const vurdering = vurderCaptcha({
    hemmelighet: Deno.env.get("TURNSTILE_SECRET_KEY"),
    token: body.captcha_token,
  });
  if (!vurdering.krev) return null;
  if ("feil" in vurdering) return svar(req, { ok: false, feil: vurdering.feil }, vurdering.status);
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
  let data: { success?: boolean } = {};
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: vurdering.token, remoteip: ip }),
    });
    if (!res.ok) return svar(req, { ok: false, feil: "Captcha kunne ikke sjekkes." }, 503);
    data = await res.json() as { success?: boolean };
  } catch {
    return svar(req, { ok: false, feil: "Captcha kunne ikke sjekkes." }, 503);
  }
  if (!data.success) return svar(req, { ok: false, feil: "Captcha ble ikke godkjent." }, 400);
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadere(req) });
  if (req.method !== "POST") return svar(req, { ok: false, feil: "Ugyldig forespørsel." }, 405);
  if (!signaturMottakAktiv(Deno.env.get("MOBILISERING_SIGNATUR_AKTIV"))) {
    return svar(req, { ok: false, feil: "Signering er ikke åpnet." }, 403);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return svar(req, { ok: false, feil: "Ugyldig forespørsel." }, 400);
  }

  const db = admin();
  const handling = body.handling === "bekreft" || body.handling === "trekk" ? body.handling : "signer";

  if (handling === "signer") {
    if (!erUuid(body.kampanje_id)) return svar(req, { ok: false, feil: "Innspillet er ikke åpent for signering." }, 404);
    const kampanjeId = body.kampanje_id;
    const { data: kampanje, error: kampanjeFeil } = await db.from("kampanjer")
      .select("id, slag, mottaker, planlagt_dato, sendt_tid, aktiv, sak_id")
      .eq("id", kampanjeId)
      .maybeSingle();
    if (kampanjeFeil || !kampanje || kampanje.slag !== "felles_innspill" || !kampanje.aktiv || kampanje.sendt_tid) {
      return svar(req, { ok: false, feil: "Innspillet er ikke åpent for signering." }, 404);
    }
    const dato = kampanje.planlagt_dato
      ? new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${kampanje.planlagt_dato}T12:00:00Z`))
      : "";
    const sjekk = validerSignering(body, { mottaker: kampanje.mottaker ?? "", dato });
    if (!sjekk.ok) return svar(req, { ok: false, feil: sjekk.feil }, 400);
    if (sjekk.bot) return svar(req, { ok: true, melding: "Takk." });
    const captcha = await godkjennCaptcha(req, body, klientIp(req));
    if (captcha) return captcha;

    let brukerId: string | null = null;
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (jwt && jwt !== Deno.env.get("SUPABASE_ANON_KEY")) {
      const { data: { user } } = await db.auth.getUser(jwt);
      brukerId = user?.id ?? null;
    }
    const nokler = [
      { nokkel: `epost:${await sha256Hex(sjekk.verdi.epost)}`, grense: FART_EPOST },
      { nokkel: `ip:${await sha256Hex(klientIp(req))}`, grense: FART_IP },
    ];
    if (brukerId) nokler.push({ nokkel: `bruker:${await sha256Hex(brukerId)}`, grense: FART_BRUKER });
    const fart = await registrerFartsgrense(db, "signer-innspill", nokler);
    if (fart === "utilgjengelig") return svar(req, { ok: false, feil: "Prøv igjen om litt." }, 503);
    if (fart === "blokkert") return svar(req, { ok: false, feil: "For mange forsøk. Prøv igjen senere." }, 429);

    const { data: finnes } = await db.from("kampanje_signaturer")
      .select("id")
      .eq("kampanje_id", kampanje.id)
      .eq("epost", sjekk.verdi.epost)
      .is("trukket_tid", null)
      .limit(1);
    if (finnes && finnes.length > 0) return svar(req, { ok: false, feil: ALLEREDE_SIGNERT }, 409);

    const token = crypto.randomUUID();
    const tokenHash = await sha256Hex(token);
    const vist = fyllSamtykke(kampanje.mottaker ?? "", dato);

    const { error: settInn } = await db.from("kampanje_signaturer").insert({
      kampanje_id: kampanje.id,
      varsel_id: kampanje.sak_id,
      bruker_id: brukerId,
      navn: sjekk.verdi.navn,
      epost: sjekk.verdi.epost,
      rolle: sjekk.verdi.rolle || null,
      organisasjonsnavn: sjekk.verdi.organisasjonsnavn || null,
      kommune: sjekk.verdi.kommune || null,
      synlighet: "skjult",
      samtykke_tekst_versjon: SAMTYKKE_VERSJON,
      samtykke_gitt_tid: new Date().toISOString(),
      samtykke_vist: vist,
      token_hash: tokenHash,
      minstealder_bekreftet: true,
    });
    if (settInn) {
      const konflikt = svarVedSignaturKonflikt(settInn);
      return svar(req, { ok: false, feil: konflikt.feil }, konflikt.status);
    }

    const brev = byggSignaturBrev({
      bekreftLenke: `${offentlig()}/mobiliser?handling=bekreft&t=${token}`,
      trekkLenke: `${offentlig()}/mobiliser?handling=trekk&t=${token}`,
      mottaker: kampanje.mottaker ?? "",
      utsending: Deno.env.get("UTSENDING_AKTIV"),
      signatur: Deno.env.get("MOBILISERING_SIGNATUR_AKTIV"),
    });
    if (brev.send) {
      const key = Deno.env.get("RESEND_API_KEY");
      if (key) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: Deno.env.get("AVSENDER") ?? "Kulturvarsling <nyhetsbrev@kulturvarsling.no>",
            to: sjekk.verdi.epost,
            subject: brev.emne,
            html: brev.html,
            text: brev.tekst,
          }),
        });
      }
    }
    return svar(req, {
      ok: true,
      bekreftet: false,
      melding: brev.send
        ? "Sjekk e-posten og bekreft signaturen. Den teller ikke før det."
        : "Signaturen er lagret, men e-posten er ikke sendt. Den teller ikke før den er bekreftet.",
    });
  }

  if (!erUuid(body.token)) return svar(req, { ok: false, feil: "Lenken er ugyldig." }, 400);
  const token = body.token;
  const fart = await registrerFartsgrense(db, "signer-innspill", [
    { nokkel: `ip:${await sha256Hex(klientIp(req))}`, grense: FART_IP },
  ]);
  if (fart === "utilgjengelig") return svar(req, { ok: false, feil: "Prøv igjen om litt." }, 503);
  if (fart === "blokkert") return svar(req, { ok: false, feil: "For mange forsøk. Prøv igjen senere." }, 429);
  const tokenHash = await sha256Hex(token);
  const { data: rad } = await db.from("kampanje_signaturer")
    .select("id, kampanje_id, samtykke_gitt_tid, bekreftet_tid, trukket_tid, trekk_forespurt_tid")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!rad) return svar(req, { ok: false, feil: "Fant ikke signaturen." }, 404);

  if (handling === "bekreft") {
    const utfall = bekreftSignatur({
      samtykkeGittTid: rad.samtykke_gitt_tid,
      bekreftetTid: rad.bekreftet_tid,
      trukketTid: rad.trukket_tid,
      trekkForespurtTid: rad.trekk_forespurt_tid,
    });
    if (!utfall.ok) return svar(req, { ok: false, feil: utfall.feil }, 409);
    if (!utfall.allerede) {
      const { error } = await db.from("kampanje_signaturer")
        .update({ bekreftet_tid: new Date().toISOString() })
        .eq("id", rad.id);
      if (error) return svar(req, { ok: false, feil: "Bekreftelsen ble ikke lagret." }, 500);
    }
    return svar(req, { ok: true, bekreftet: true, melding: "Signaturen er bekreftet og teller med." });
  }

  const { data: kampanje } = await db.from("kampanjer").select("sendt_tid").eq("id", rad.kampanje_id).maybeSingle();
  const utfall = trekkSignatur({
    samtykkeGittTid: rad.samtykke_gitt_tid,
    bekreftetTid: rad.bekreftet_tid,
    trukketTid: rad.trukket_tid,
    trekkForespurtTid: rad.trekk_forespurt_tid,
  }, !!kampanje?.sendt_tid);
  if (utfall === "trukket") {
    await db.from("kampanje_signaturer").update({ trukket_tid: new Date().toISOString() }).eq("id", rad.id);
    return svar(req, { ok: true, trukket: true, melding: "Signaturen er trukket tilbake og teller ikke." });
  }
  if (utfall === "forespurt") {
    await db.from("kampanje_signaturer").update({ trekk_forespurt_tid: new Date().toISOString() }).eq("id", rad.id);
    return svar(req, {
      ok: true,
      trukket: false,
      melding: "Innspillet er allerede sendt. Vi kan ikke hente signaturen tilbake hos mottakeren. Ønsket om å si fra er registrert. Ingen e-post er sendt.",
    });
  }
  return svar(req, { ok: true, melding: "Tilbaketrekkingen er allerede registrert." });
});
