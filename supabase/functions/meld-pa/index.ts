// Påmelding med dokumentert samtykke og dobbel opt-in.
// verify_jwt = false (se supabase/config.toml): bekreftelsen kommer fra
// nettleseren uten brukersesjon, og anon-nøkkelen skal ikke ligge i siden.
// Misbruk stanses med validering, honeypot og rate limit – ikke med en
// hemmelighet i frontend.
//
// Lagringen er suksess for brukeren selv om Resend mangler eller avviser.
// Raden blir liggende med bekreftelse_sendt_at null til e-posten er sendt.
//
// POST { fornavn, etternavn, epost, samtykke: true, samtykke_tekst_versjon }
// POST { handling: "bekreft", token }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { behandlingsansvarlig, bunntekst, lesAvsender } from "../_shared/organisasjon.ts";
import {
  KILDE_VENTESIDE,
  SAMTYKKE_VERSJON,
  avmeldingsFunksjon,
  avmeldingsSide,
  bekreftelsesBrev,
  bekreftelsesSide,
  bekreftelsesutfall,
  erBlokkert,
  erUuid,
  escapeHtml,
  lagEpost,
  loggNarResendMangler,
  opphavTillatt,
  svarAlleredeRegistrert,
  svarEtterLagretPamelding,
  svarEtterSkriving,
  validerPamelding,
} from "../_shared/samtykke.ts";
import { corsHeadere } from "../_shared/cors.ts";

function fraAdresse(): string {
  return lesAvsender(behandlingsansvarlig, Deno.env);
}

function svar(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadere(req), "Content-Type": "application/json" },
  });
}

function offentligUrl(): string {
  return (Deno.env.get("OFFENTLIG_URL") ?? "https://www.kulturvarsling.no").replace(/\/$/, "");
}

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function sha256(tekst: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function klientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip")
    || req.headers.get("x-real-ip")
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "ukjent";
}

async function antallSiden(
  db: ReturnType<typeof admin>,
  nokkel: string,
  siden: string,
): Promise<number | null> {
  const { count, error } = await db.from("meld_pa_forsok")
    .select("id", { count: "exact", head: true })
    .eq("nokkel", nokkel)
    .gte("opprettet_at", siden);
  if (error) return null;
  return count ?? 0;
}

type SendResultat = {
  ok: boolean;
  grunn: "sendt" | "mangler" | "avvist" | "feil";
  resendId: string | null;
};

async function sendEpost(
  brev: ReturnType<typeof lagEpost>,
  spor: "ny" | "allerede",
): Promise<SendResultat> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    console.error(loggNarResendMangler("meld-pa"));
    if (spor === "allerede") {
      console.error("meld-pa: allerede bekreftet adresse får ingen e-post. Raden er uendret.");
    }
    return { ok: false, grunn: "mangler", resendId: null };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
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
    if (!res.ok) {
      console.error(
        `meld-pa: Resend avslo e-posten (${res.status}). ${
          spor === "ny"
            ? "Påmeldingen er lagret. bekreftelse_sendt_at forblir null."
            : "Adressen er allerede bekreftet."
        }`,
      );
      return { ok: false, grunn: "avvist", resendId: null };
    }
    return { ok: true, grunn: "sendt", resendId };
  } catch (e) {
    console.error(
      spor === "ny"
        ? "meld-pa: kall til Resend feilet. Påmeldingen er lagret. bekreftelse_sendt_at forblir null."
        : "meld-pa: kall til Resend feilet. Adressen er allerede bekreftet.",
      e,
    );
    return { ok: false, grunn: "feil", resendId: null };
  }
}

function brevMedAvmelding(
  til: string,
  emne: string,
  html: string,
  tekst: string,
  token: string,
): ReturnType<typeof lagEpost> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "https://zyyijlvmgoanjdzngmon.supabase.co";
  return lagEpost({
    fra: fraAdresse(),
    til,
    emne,
    html,
    tekst,
    side: avmeldingsSide(offentligUrl(), token),
    funksjon: avmeldingsFunksjon(supabaseUrl, token),
  });
}

function medBunn(html: string): string {
  const bunn = escapeHtml(bunntekst(behandlingsansvarlig));
  return `${html}<p style="color:#6B665C;font-size:14px;">${bunn}</p>`;
}

async function loggBekreftelse(
  db: ReturnType<typeof admin>,
  rad: { pameldingId: number | null; epost: string; status: string; resendId: string | null },
): Promise<void> {
  const { error } = await db.from("bekreftelse_utsendelser").insert({
    pamelding_id: rad.pameldingId,
    epost_normalisert: rad.epost,
    resend_id: rad.resendId,
    status: rad.status,
  });
  if (error) console.error("bekreftelse-logg", error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadere(req) });
  if (req.method !== "POST") {
    return svar(req, { ok: false, feil: "Bruk skjemaet på kulturvarsling.no." }, 405);
  }
  if (!opphavTillatt(req.headers.get("origin"))) {
    return svar(req, { ok: false, feil: "Forespørselen ble avvist." }, 403);
  }

  const db = admin();
  const body = await req.json().catch(() => null);
  const felt = body && typeof body === "object" ? body as Record<string, unknown> : {};

  if (felt.handling === "bekreft") {
    const token = typeof felt.token === "string" ? felt.token : "";
    if (!erUuid(token)) return svar(req, { ok: false, feil: "Ugyldig bekreftelseslenke." }, 400);
    const { data, error } = await db.from("pamelding")
      .select("id, bekreftet_at, avmeldt_at, samtykke_gitt_at")
      .eq("bekreftelses_token", token);
    if (error) {
      console.error("bekreft les", error.message);
      return svar(req, { ok: false, feil: "Kunne ikke bekrefte påmeldingen. Prøv igjen." }, 500);
    }
    if (!data?.length) return svar(req, { ok: false, feil: "Lenken er ugyldig eller utløpt." }, 404);
    const utfall = data.map((rad) => ({ id: rad.id, utfall: bekreftelsesutfall(rad) }));
    if (utfall.every((rad) => rad.utfall === "avmeldt")) {
      return svar(req, {
        ok: false,
        feil: "Du er meldt av. Denne lenken endrer ingenting. Meld deg på på nytt hvis du vil motta brevet.",
      }, 409);
    }
    const skalBekreftes = utfall.filter((rad) => rad.utfall === "bekreft").map((rad) => rad.id);
    if (!skalBekreftes.length) {
      return svar(req, { ok: true, melding: "Påmeldingen er allerede bekreftet." });
    }
    const skrevet = await db.from("pamelding")
      .update({ bekreftet_at: new Date().toISOString(), avmeldt_at: null })
      .in("id", skalBekreftes);
    const resultat = svarEtterSkriving(skrevet.error?.message ?? null);
    if (!resultat.ok) {
      console.error("bekreft skriv", resultat.feil);
      return svar(req, { ok: false, feil: "Kunne ikke lagre bekreftelsen. Ingenting er bekreftet." }, 500);
    }
    return svar(req, { ok: true, melding: "Påmeldingen er bekreftet. Du kan lukke denne siden." });
  }

  const validert = validerPamelding(body);
  if (!validert.ok) return svar(req, { ok: false, feil: validert.feil }, 400);
  if (validert.bot) {
    return svar(req, { ok: true, melding: "Sjekk e-posten din og klikk på bekreftelseslenken." });
  }

  const timeSiden = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const epostNokkel = `epost:${await sha256(validert.verdi.epost)}`;
  const ipNokkel = `ip:${await sha256(klientIp(req))}`;
  const [epostAntall, ipAntall] = await Promise.all([
    antallSiden(db, epostNokkel, timeSiden),
    antallSiden(db, ipNokkel, timeSiden),
  ]);
  if (epostAntall == null || ipAntall == null) {
    return svar(req, { ok: false, feil: "Påmeldingen er midlertidig utilgjengelig. Prøv igjen." }, 503);
  }
  if (erBlokkert(epostAntall, ipAntall)) {
    return svar(req, { ok: false, feil: "For mange forsøk. Prøv igjen senere." }, 429);
  }
  const { error: loggFeil } = await db.from("meld_pa_forsok").insert([
    { nokkel: epostNokkel },
    { nokkel: ipNokkel },
  ]);
  if (loggFeil) {
    console.error("rate-limit logg", loggFeil.message);
    return svar(req, { ok: false, feil: "Påmeldingen er midlertidig utilgjengelig. Prøv igjen." }, 503);
  }
  await db.from("meld_pa_forsok").delete()
    .lt("opprettet_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .then(() => undefined, () => undefined);

  const { data: treff, error: lesFeil } = await db.from("pamelding")
    .select("id, bekreftet_at, avmeldt_at, avmeldings_token")
    .eq("epost_normalisert", validert.verdi.epost);
  if (lesFeil) {
    console.error("pamelding les", lesFeil.message);
    return svar(req, { ok: false, feil: "Kunne ikke lagre påmeldingen. Prøv igjen." }, 500);
  }

  const rader = treff ?? [];
  let avToken = rader.find((rad) => erUuid(rad.avmeldings_token))?.avmeldings_token ?? null;
  const alleBekreftet = rader.length > 0 && rader.every((rad) => rad.bekreftet_at && !rad.avmeldt_at);
  if (alleBekreftet) {
    if (!avToken) {
      avToken = crypto.randomUUID();
      const { error: tokenFeil } = await db.from("pamelding")
        .update({ avmeldings_token: avToken })
        .eq("id", rader[0].id);
      if (tokenFeil) {
        console.error("meld-pa: allerede bekreftet, men token ble ikke lagret.", tokenFeil.message);
        const kropp = svarAlleredeRegistrert(false);
        return svar(req, { ok: true, melding: kropp.melding }, kropp.status);
      }
    }
    const resultat = await sendEpost(brevMedAvmelding(
      validert.verdi.epost,
      "Du er allerede påmeldt Kulturvarsling",
      medBunn("<p>Adressen er allerede bekreftet. Du trenger ikke gjøre noe mer.</p>"),
      `Adressen er allerede bekreftet. Du trenger ikke gjøre noe mer.\n\n${bunntekst(behandlingsansvarlig)}`,
      avToken,
    ), "allerede");
    const kropp = svarAlleredeRegistrert(resultat.ok);
    return svar(req, { ok: true, melding: kropp.melding }, kropp.status);
  }

  const token = crypto.randomUUID();
  const naa = new Date().toISOString();
  const felles = {
    fornavn: validert.verdi.fornavn,
    etternavn: validert.verdi.etternavn,
    samtykke_gitt_at: naa,
    samtykke_tekst_versjon: SAMTYKKE_VERSJON,
    kilde: KILDE_VENTESIDE,
    bekreftet_at: null,
    bekreftelse_sendt_at: null,
    bekreftelses_token: token,
  };

  if (!avToken) avToken = crypto.randomUUID();

  let ids: number[] = [];
  if (rader.length === 0) {
    const { data: opprettet, error } = await db.from("pamelding").insert({
      ...felles,
      epost: validert.verdi.epost,
      avmeldings_token: avToken,
    }).select("id").single();
    if (error || opprettet?.id == null) {
      console.error("pamelding insert", error?.message ?? "mangler id");
      return svar(req, { ok: false, feil: "Kunne ikke lagre påmeldingen. Ingenting er registrert." }, 500);
    }
    ids = [opprettet.id];
  } else {
    const { error } = await db.from("pamelding").update(felles).in("id", rader.map((rad) => rad.id));
    if (error) {
      console.error("pamelding update", error.message);
      return svar(req, { ok: false, feil: "Kunne ikke lagre påmeldingen. Ingenting er bekreftet." }, 500);
    }
    ids = rader.map((rad) => rad.id);
    const { error: slettLoggFeil } = await db.from("bekreftelse_utsendelser").delete().in("pamelding_id", ids);
    if (slettLoggFeil) console.error("bekreftelse-logg slett", slettLoggFeil.message);
    let skrevAvToken = rader.some((rad) => rad.avmeldings_token === avToken);
    for (const rad of rader) {
      if (rad.avmeldings_token) continue;
      const neste = skrevAvToken ? crypto.randomUUID() : avToken;
      skrevAvToken = true;
      const { error: tokenFeil } = await db.from("pamelding")
        .update({ avmeldings_token: neste })
        .eq("id", rad.id);
      if (tokenFeil) {
        console.error("meld-pa: påmeldingen er lagret, men avmeldingstoken ble ikke skrevet.", tokenFeil.message);
        const kropp = svarEtterLagretPamelding(false);
        return svar(req, { ok: true, melding: kropp.melding }, kropp.status);
      }
    }
  }

  const lenke = bekreftelsesSide(offentligUrl(), token);
  const innhold = bekreftelsesBrev(lenke, bunntekst(behandlingsansvarlig));
  const resultat = await sendEpost(brevMedAvmelding(
    validert.verdi.epost,
    innhold.emne,
    innhold.html,
    innhold.tekst,
    avToken,
  ), "ny");
  const status = resultat.ok ? "sendt" : resultat.grunn === "mangler" ? "ikke_konfigurert" : "feilet";
  await loggBekreftelse(db, {
    pameldingId: ids[0] ?? null,
    epost: validert.verdi.epost,
    status,
    resendId: resultat.resendId,
  });
  if (resultat.ok) {
    const { error: stempelFeil } = await db.from("pamelding")
      .update({ bekreftelse_sendt_at: new Date().toISOString() })
      .in("id", ids)
      .is("bekreftelse_sendt_at", null);
    if (stempelFeil) {
      console.error("meld-pa: e-posten ble sendt, men bekreftelse_sendt_at ble ikke satt.", stempelFeil.message);
    }
  }
  const kropp = svarEtterLagretPamelding(resultat.ok);
  return svar(req, { ok: true, melding: kropp.melding }, kropp.status);
});
