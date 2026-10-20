// Manuell bekreftelses-e-post. Aldri cron.
//
// Krever header x-bekreftelse-nokkel. For å sende kreves i tillegg
// UTSENDING_AKTIV=true. Uten bryteren blir kallet et tørrkjør: antall og
// forhåndsvisning, ingen e-post og ingen skriving.
//
//   POST {"maal":"lansering"}                         → tørrkjør
//   POST {"maal":"lansering","til":"delivered@resend.dev"} → én adresse
//   POST {"maal":"lansering","bekreft":"send"}        → kvalifiserte gamle rader
//   POST {"maal":"nye","bekreft":"send"}             → nye som venter
//
// Tom kropp, tom til og en mottakerliste er aldri «alle».
// Lansering til alle er stoppet mens malen er merket UTKAST.
// Ikke kall denne før avsenderdomenet er verifisert i Resend.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PERSONVERN_URL, behandlingsansvarlig, bunntekst, lesAvsender, orgnr } from "../_shared/organisasjon.ts";
import { LANSERING_MAL } from "./lansering.mal.ts";
import {
  BEKREFTELSE_PAUSE_MS,
  FORHANDSVISNING_TOKEN,
  HISTORISK_VERSJON,
  SAMTYKKE_VERSJON,
  avmeldingsFunksjon,
  avmeldingsSide,
  bekreftelsesBrev,
  bekreftelsesSide,
  erUuid,
  fyllLanseringsmal,
  hemmeligheterStemmer,
  lagEpost,
  lesBekreftelsesOppdrag,
  loggNarResendMangler,
  malErUtkast,
  parseLanseringsmal,
  utsendingErAktiv,
  utsendelsesBeslutning,
  velgLanseringsmottakere,
  velgVentendeBekreftelser,
  type Bekreftelsesrad,
  type Lanseringsrad,
  type Lanseringsvalg,
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

function eksempelLenker(supabaseUrl: string): { bekreftelse: string; side: string; funksjon: string } {
  return {
    bekreftelse: bekreftelsesSide(offentligUrl(), FORHANDSVISNING_TOKEN),
    side: avmeldingsSide(offentligUrl(), FORHANDSVISNING_TOKEN),
    funksjon: avmeldingsFunksjon(supabaseUrl, FORHANDSVISNING_TOKEN),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ feil: "Bruk POST. Ingenting er sendt.", sendt: 0 }, 405);
  if (!hemmeligheterStemmer(
    req.headers.get("x-bekreftelse-nokkel"),
    Deno.env.get("BEKREFTELSE_NOKKEL"),
  )) {
    return json({ feil: "Ikke autorisert. Ingenting er sendt.", sendt: 0 }, 401);
  }

  const oppdrag = lesBekreftelsesOppdrag(await req.json().catch(() => null));
  if (oppdrag.type === "avvist") return json({ feil: oppdrag.grunn, sendt: 0 }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const utkast = malErUtkast(LANSERING_MAL);
  const mal = oppdrag.maal === "lansering" ? parseLanseringsmal(LANSERING_MAL) : null;
  if (mal && "feil" in mal) return json({ feil: mal.feil, sendt: 0 }, 500);

  const { data, error } = oppdrag.maal === "lansering"
    ? await supabase.from("pamelding")
      .select("id, epost, avmeldings_token, bekreftelses_token, samtykke_tekst_versjon, bekreftet_at, avmeldt_at, bekreftelse_sendt_at")
      .eq("samtykke_tekst_versjon", HISTORISK_VERSJON)
      .is("bekreftet_at", null)
      .is("avmeldt_at", null)
      .is("bekreftelse_sendt_at", null)
    : await supabase.from("pamelding")
      .select("id, epost, avmeldings_token, bekreftelses_token, samtykke_gitt_at, samtykke_tekst_versjon, bekreftet_at, avmeldt_at, bekreftelse_sendt_at")
      .is("bekreftelse_sendt_at", null)
      .is("bekreftet_at", null)
      .is("avmeldt_at", null)
      .not("samtykke_gitt_at", "is", null)
      .eq("samtykke_tekst_versjon", SAMTYKKE_VERSJON);
  if (error) {
    console.error("send-bekreftelser les", error.message);
    return json({ sendt: 0, feil: "Kunne ikke lese mottakere. Ingenting er sendt." }, 500);
  }

  const loggStatus = oppdrag.maal === "lansering"
    ? ["lansering_sendt", "lansering_reservert"]
    : ["sendt", "reservert"];
  const { data: logg, error: loggFeil } = await supabase.from("bekreftelse_utsendelser")
    .select("pamelding_id, epost_normalisert")
    .in("status", loggStatus);
  if (loggFeil) {
    console.error("send-bekreftelser logg", loggFeil.message);
    return json({ sendt: 0, feil: "Kunne ikke lese sendeloggen. Ingenting er sendt." }, 500);
  }
  const sendteEpost = new Set<string>();
  const sendteId = new Set<number>();
  for (const rad of logg ?? []) {
    if (typeof rad.epost_normalisert === "string") sendteEpost.add(rad.epost_normalisert);
    if (typeof rad.pamelding_id === "number") sendteId.add(rad.pamelding_id);
  }

  const kvalifiserte: Lanseringsvalg[] = oppdrag.maal === "lansering"
    ? velgLanseringsmottakere((data ?? []) as Lanseringsrad[], { eposter: sendteEpost })
    : velgVentendeBekreftelser((data ?? []) as Bekreftelsesrad[], { ids: sendteId, eposter: sendteEpost })
      .map((rad) => ({
        id: rad.id,
        epost: rad.epost,
        avmeldings_token: rad.avmeldings_token,
        bekreftelses_token: rad.bekreftelses_token,
        ovrigeIder: rad.ovrigeIder,
      }));

  const treff = oppdrag.type === "test"
    ? kvalifiserte.filter((rad) => rad.epost === oppdrag.til)
    : kvalifiserte;
  const beslutning = utsendelsesBeslutning({
    oppdrag,
    aktiv: utsendingErAktiv(Deno.env.get("UTSENDING_AKTIV")),
    utkast,
    antall: oppdrag.type === "test" ? treff.length : kvalifiserte.length,
  });
  const antall = oppdrag.type === "test" ? 1 : kvalifiserte.length;
  const eksempel = eksempelLenker(supabaseUrl);
  const bunn = bunntekst(behandlingsansvarlig);
  const forhandsvisning = mal && !("feil" in mal)
    ? (() => {
      const fylt = fyllLanseringsmal(mal, {
        bekreftelseslenke: eksempel.bekreftelse,
        avmeldingslenke: eksempel.side,
        behandlingsansvarlig,
        orgnr,
        personvern: PERSONVERN_URL,
        avsender: fraAdresse(),
      });
      const brev = lagEpost({
        fra: fraAdresse(),
        til: oppdrag.type === "test" ? oppdrag.til : "forhandsvisning@kulturvarsling.no",
        emne: fylt.emne,
        html: fylt.html,
        tekst: fylt.tekst,
        side: eksempel.side,
        funksjon: eksempel.funksjon,
      });
      return { emne: brev.subject, tekst: brev.text, html: brev.html, headers: brev.headers, utkast };
    })()
    : (() => {
      const innhold = bekreftelsesBrev(eksempel.bekreftelse, bunn);
      const brev = lagEpost({
        fra: fraAdresse(),
        til: oppdrag.type === "test" ? oppdrag.til : "forhandsvisning@kulturvarsling.no",
        emne: innhold.emne,
        html: innhold.html,
        tekst: innhold.tekst,
        side: eksempel.side,
        funksjon: eksempel.funksjon,
      });
      return { emne: brev.subject, tekst: brev.text, html: brev.html, headers: brev.headers, utkast: false };
    })();

  if (!beslutning.send) {
    return json({
      dry_run: true,
      sendt: 0,
      maal: oppdrag.maal,
      antall,
      kvalifisert: kvalifiserte.length,
      forhandsvisning,
      merknad: beslutning.grunn,
    });
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.error(loggNarResendMangler("send-bekreftelser"));
    return json({
      sendt: 0,
      feil: "RESEND_API_KEY mangler. Ingenting er sendt. Ventende rader er uendret.",
    }, 503);
  }

  const maalrader = beslutning.sandkasse ? [] : treff;
  let sendt = 0;
  const feil: string[] = [];

  if (beslutning.sandkasse && oppdrag.type === "test") {
    const innhold = byggInnhold(oppdrag.maal, mal, eksempel.bekreftelse, eksempel.side, bunn);
    const brev = lagEpost({
      fra: fraAdresse(),
      til: oppdrag.til,
      emne: innhold.emne,
      html: innhold.html,
      tekst: innhold.tekst,
      side: eksempel.side,
      funksjon: eksempel.funksjon,
    });
    const resultat = await sendEn(resendKey, brev);
    const { error: testLogg } = await supabase.from("bekreftelse_utsendelser").insert({
      pamelding_id: null,
      epost_normalisert: oppdrag.til,
      resend_id: resultat.resendId,
      status: resultat.ok ? "test_sendt" : "feilet",
    });
    if (testLogg) console.error("send-bekreftelser testlogg", testLogg.message);
    return json({
      sendt: resultat.ok ? 1 : 0,
      sandkasse: true,
      maal: oppdrag.maal,
      til: oppdrag.til,
      feil: resultat.ok ? undefined : "Resend avslo testsendingen. Ingen påmeldingsrad er endret.",
    });
  }

  for (const rad of maalrader) {
    const reservertStatus = oppdrag.maal === "lansering" ? "lansering_reservert" : "reservert";
    const sendtStatus = oppdrag.maal === "lansering" ? "lansering_sendt" : "sendt";
    const feiletStatus = oppdrag.maal === "lansering" ? "lansering_feilet" : "feilet";
    const { data: reserve, error: reserveFeil } = await supabase.from("bekreftelse_utsendelser")
      .insert({
        pamelding_id: rad.id,
        epost_normalisert: rad.epost,
        resend_id: null,
        status: reservertStatus,
      })
      .select("id")
      .single();
    if (reserveFeil) {
      if (reserveFeil.code === "23505") continue;
      console.error("send-bekreftelser reserve", reserveFeil.message);
      return json({
        sendt,
        feil: "Kunne ikke reservere adressen. Utsendingen er stoppet.",
      }, 500);
    }

    let bekreftelse = rad.bekreftelses_token;
    let avmelding = rad.avmeldings_token;
    if (!erUuid(bekreftelse) || !erUuid(avmelding)) {
      bekreftelse = erUuid(bekreftelse) ? bekreftelse : crypto.randomUUID();
      avmelding = erUuid(avmelding) ? avmelding : crypto.randomUUID();
      const { error: tokenFeil } = await supabase.from("pamelding")
        .update({ bekreftelses_token: bekreftelse, avmeldings_token: avmelding })
        .eq("id", rad.id);
      if (tokenFeil) {
        console.error("send-bekreftelser token", tokenFeil.message);
        await supabase.from("bekreftelse_utsendelser").update({ status: feiletStatus }).eq("id", reserve.id);
        feil.push(`${rad.id}: token`);
        await pause();
        continue;
      }
    }

    const side = avmeldingsSide(offentligUrl(), avmelding);
    const lenke = bekreftelsesSide(offentligUrl(), bekreftelse);
    const innhold = byggInnhold(oppdrag.maal, mal, lenke, side, bunn);
    const brev = lagEpost({
      fra: fraAdresse(),
      til: rad.epost,
      emne: innhold.emne,
      html: innhold.html,
      tekst: innhold.tekst,
      side,
      funksjon: avmeldingsFunksjon(supabaseUrl, avmelding),
    });
    const resultat = await sendEn(resendKey, brev);
    if (!resultat.ok) {
      await supabase.from("bekreftelse_utsendelser").update({ status: feiletStatus }).eq("id", reserve.id);
      console.error(`send-bekreftelser: Resend avslo ${rad.id}. bekreftelse_sendt_at er ikke satt.`);
      feil.push(`${rad.id}: resend`);
      await pause();
      continue;
    }

    const ider = [rad.id, ...rad.ovrigeIder];
    const { error: oppdatert } = await supabase.from("bekreftelse_utsendelser")
      .update({ status: sendtStatus, resend_id: resultat.resendId })
      .eq("id", reserve.id);
    if (oppdatert) console.error("send-bekreftelser logg", oppdatert.message);
    if (rad.ovrigeIder.length) {
      await supabase.from("bekreftelse_utsendelser").insert(
        rad.ovrigeIder.map((id) => ({
          pamelding_id: id,
          epost_normalisert: rad.epost,
          resend_id: null,
          status: oppdrag.maal === "lansering" ? "lansering_duplikat" : "duplikat",
        })),
      );
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
    await pause();
  }

  return json({
    sendt,
    maal: oppdrag.maal,
    antall: maalrader.length,
    feil: feil.length ? feil.slice(0, 5) : undefined,
  });
});

function byggInnhold(
  maal: "lansering" | "nye",
  mal: { emne: string; forhandsvisning: string; tekst: string } | { feil: string } | null,
  bekreftelse: string,
  side: string,
  bunn: string,
): { emne: string; html: string; tekst: string } {
  if (maal === "lansering" && mal && !("feil" in mal)) {
    return fyllLanseringsmal(mal, {
      bekreftelseslenke: bekreftelse,
      avmeldingslenke: side,
      behandlingsansvarlig,
      orgnr,
      personvern: PERSONVERN_URL,
      avsender: fraAdresse(),
    });
  }
  return bekreftelsesBrev(bekreftelse, bunn);
}

async function sendEn(
  resendKey: string,
  brev: ReturnType<typeof lagEpost>,
): Promise<{ ok: boolean; resendId: string | null }> {
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
    let resendId: string | null = null;
    try { resendId = JSON.parse(tekst).id ?? null; } catch { /* tomt svar */ }
    return { ok: res.ok, resendId };
  } catch (e) {
    console.error("send-bekreftelser: kall til Resend feilet.", e);
    return { ok: false, resendId: null };
  }
}

function pause(): Promise<void> {
  return new Promise((r) => setTimeout(r, BEKREFTELSE_PAUSE_MS));
}
