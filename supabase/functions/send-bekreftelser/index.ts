// Manuell utsending av bekreftelses-e-post til rader som venter.
// Aldri cron. Ikke kall denne før kulturvarsling.no er verifisert i Resend
// (DKIM resend._domainkey) og RESEND_API_KEY er satt.
//
// Tilgang: header x-bekreftelse-nokkel må matche hemmeligheten BEKREFTELSE_NOKKEL.
// verify_jwt = true er ikke nok alene. Anon-nøkkelen er en JWT.
//
// POST {}  → sender til ventende rader, eller stopper uten å stemple noe.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { behandlingsansvarlig, bunntekst, lesAvsender } from "../_shared/organisasjon.ts";
import {
  SAMTYKKE_VERSJON,
  avmeldingsFunksjon,
  avmeldingsSide,
  bekreftelsesBrev,
  bekreftelsesSide,
  hemmeligheterStemmer,
  lagEpost,
  loggNarResendMangler,
  velgVentendeBekreftelser,
  type Bekreftelsesrad,
} from "../_shared/samtykke.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function offentligUrl(): string {
  return (Deno.env.get("OFFENTLIG_URL") ?? "https://www.kulturvarsling.no").replace(/\/$/, "");
}

function fraAdresse(): string {
  return lesAvsender(behandlingsansvarlig, Deno.env);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ feil: "Bruk POST. Ingenting er sendt." }, 405);
  if (!hemmeligheterStemmer(
    req.headers.get("x-bekreftelse-nokkel"),
    Deno.env.get("BEKREFTELSE_NOKKEL"),
  )) {
    return json({ feil: "Ikke autorisert. Ingenting er sendt." }, 401);
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.error(loggNarResendMangler("send-bekreftelser"));
    return json({
      sendt: 0,
      feil: "RESEND_API_KEY mangler. Ingenting er sendt. Ventende rader er uendret.",
    }, 503);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase.from("pamelding")
    .select("id, epost, avmeldings_token, bekreftelses_token, samtykke_gitt_at, samtykke_tekst_versjon, bekreftet_at, avmeldt_at, bekreftelse_sendt_at")
    .is("bekreftelse_sendt_at", null)
    .is("bekreftet_at", null)
    .is("avmeldt_at", null)
    .not("samtykke_gitt_at", "is", null)
    .eq("samtykke_tekst_versjon", SAMTYKKE_VERSJON);
  if (error) {
    console.error("send-bekreftelser les", error.message);
    return json({ sendt: 0, feil: "Kunne ikke lese ventende rader. Ingenting er sendt." }, 500);
  }

  const { data: logg, error: loggFeil } = await supabase.from("bekreftelse_utsendelser")
    .select("pamelding_id, epost_normalisert")
    .eq("status", "sendt");
  if (loggFeil) {
    console.error("send-bekreftelser logg", loggFeil.message);
    return json({ sendt: 0, feil: "Kunne ikke lese sendeloggen. Ingenting er sendt." }, 500);
  }

  const { data: stemplet, error: stempelLesFeil } = await supabase.from("pamelding")
    .select("epost")
    .not("bekreftelse_sendt_at", "is", null);
  if (stempelLesFeil) {
    console.error("send-bekreftelser stempel", stempelLesFeil.message);
    return json({ sendt: 0, feil: "Kunne ikke lese allerede sendte rader. Ingenting er sendt." }, 500);
  }

  const ids = new Set<number>();
  const eposter = new Set<string>();
  for (const rad of logg ?? []) {
    if (typeof rad.pamelding_id === "number") ids.add(rad.pamelding_id);
    if (typeof rad.epost_normalisert === "string") eposter.add(rad.epost_normalisert);
  }
  for (const rad of stemplet ?? []) {
    if (typeof rad.epost === "string") eposter.add(rad.epost);
  }

  const ventende = velgVentendeBekreftelser((data ?? []) as Bekreftelsesrad[], { ids, eposter });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  let sendt = 0;
  const feil: string[] = [];

  for (const rad of ventende) {
    const lenke = bekreftelsesSide(offentligUrl(), rad.bekreftelses_token);
    const innhold = bekreftelsesBrev(lenke, bunntekst(behandlingsansvarlig));
    const brev = lagEpost({
      fra: fraAdresse(),
      til: rad.epost,
      emne: innhold.emne,
      html: innhold.html,
      tekst: innhold.tekst,
      side: avmeldingsSide(offentligUrl(), rad.avmeldings_token),
      funksjon: avmeldingsFunksjon(supabaseUrl, rad.avmeldings_token),
    });
    let resendId: string | null = null;
    let ok = false;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: brev.from,
          to: brev.to,
          subject: brev.subject,
          html: brev.html,
          text: brev.text,
          headers: brev.headers,
        }),
      });
      const tekst = await res.text();
      try { resendId = JSON.parse(tekst).id ?? null; } catch { /* tomt svar */ }
      ok = res.ok;
      if (!ok) console.error(`send-bekreftelser: Resend avslo ${rad.id} (${res.status}). bekreftelse_sendt_at er ikke satt.`);
    } catch (e) {
      console.error(`send-bekreftelser: kall til Resend feilet for ${rad.id}. bekreftelse_sendt_at er ikke satt.`, e);
    }

    const ider = [rad.id, ...rad.ovrigeIder];
    if (!ok) {
      const { error: feilLogg } = await supabase.from("bekreftelse_utsendelser").insert({
        pamelding_id: rad.id,
        epost_normalisert: rad.epost,
        resend_id: null,
        status: "feilet",
      });
      if (feilLogg) feil.push(`${rad.id}: logg`);
      else feil.push(`${rad.id}: resend`);
      await new Promise((r) => setTimeout(r, 550));
      continue;
    }

    const { error: sendtLogg } = await supabase.from("bekreftelse_utsendelser").insert([
      {
        pamelding_id: rad.id,
        epost_normalisert: rad.epost,
        resend_id: resendId,
        status: "sendt",
      },
      ...rad.ovrigeIder.map((id) => ({
        pamelding_id: id,
        epost_normalisert: rad.epost,
        resend_id: null,
        status: "duplikat",
      })),
    ]);
    if (sendtLogg) {
      console.error("send-bekreftelser logg", sendtLogg.message);
      feil.push(`${rad.id}: logg`);
    }
    const { error: stempelFeil } = await supabase.from("pamelding")
      .update({ bekreftelse_sendt_at: new Date().toISOString() })
      .in("id", ider)
      .is("bekreftelse_sendt_at", null);
    if (stempelFeil) {
      console.error("send-bekreftelser stempel", stempelFeil.message);
      feil.push(`${rad.id}: stempel`);
    } else {
      sendt += 1;
    }
    await new Promise((r) => setTimeout(r, 550));
  }

  return json({
    sendt,
    ventende: ventende.length,
    feil: feil.length ? feil.slice(0, 5) : undefined,
  });
});
