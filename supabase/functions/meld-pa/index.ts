// Påmelding med dokumentert samtykke og dobbel opt-in.
// verify_jwt = false (se supabase/config.toml): bekreftelsen kommer fra
// nettleseren uten brukersesjon, og anon-nøkkelen skal ikke ligge i siden.
// Misbruk stanses med validering, honeypot og rate limit – ikke med en
// hemmelighet i frontend.
//
// POST { fornavn, etternavn, epost, samtykke: true, samtykke_tekst_versjon }
// POST { handling: "bekreft", token }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { avsender, behandlingsansvarlig, bunntekst } from "../_shared/organisasjon.ts";
import {
  KILDE_VENTESIDE,
  SAMTYKKE_VERSJON,
  avmeldingsFunksjon,
  avmeldingsSide,
  bekreftelsesSide,
  bekreftelsesutfall,
  erBlokkert,
  erUuid,
  escapeHtml,
  lagEpost,
  opphavTillatt,
  svarEtterSkriving,
  validerPamelding,
} from "../_shared/samtykke.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function fraAdresse(): string {
  return avsender(behandlingsansvarlig, Deno.env.get("AVSENDER"));
}

function svar(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
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

async function sendEpost(brev: ReturnType<typeof lagEpost>): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return false;
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
  if (!res.ok) console.error("Resend feilet", res.status);
  return res.ok;
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

function bekreftHtml(lenke: string): string {
  const href = escapeHtml(lenke);
  return `<!doctype html><html lang="no"><body style="font-family:Georgia,serif;background:#FBF8F2;color:#1C1B19;padding:32px;">
    <p>Bekreft at du vil motta nyhetsbrev fra Kulturvarsling.</p>
    <p><a href="${href}">Bekreft påmeldingen</a></p>
    <p style="color:#6B665C;font-size:14px;">Hvis du ikke ba om dette, kan du se bort fra e-posten. Ingenting sendes før lenken er bekreftet.</p>
    ${medBunn("")}
  </body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return svar({ ok: false, feil: "Bruk skjemaet på kulturvarsling.no." }, 405);
  }
  if (!opphavTillatt(req.headers.get("origin"))) {
    return svar({ ok: false, feil: "Forespørselen ble avvist." }, 403);
  }

  const db = admin();
  const body = await req.json().catch(() => null);
  const felt = body && typeof body === "object" ? body as Record<string, unknown> : {};

  if (felt.handling === "bekreft") {
    const token = typeof felt.token === "string" ? felt.token : "";
    if (!erUuid(token)) return svar({ ok: false, feil: "Ugyldig bekreftelseslenke." }, 400);
    const { data, error } = await db.from("pamelding")
      .select("id, bekreftet_at, avmeldt_at, samtykke_gitt_at")
      .eq("bekreftelses_token", token);
    if (error) {
      console.error("bekreft les", error.message);
      return svar({ ok: false, feil: "Kunne ikke bekrefte påmeldingen. Prøv igjen." }, 500);
    }
    if (!data?.length) return svar({ ok: false, feil: "Lenken er ugyldig eller utløpt." }, 404);
    const utfall = data.map((rad) => ({ id: rad.id, utfall: bekreftelsesutfall(rad) }));
    if (utfall.every((rad) => rad.utfall === "avmeldt")) {
      return svar({
        ok: false,
        feil: "Du er meldt av. Denne lenken endrer ingenting. Meld deg på på nytt hvis du vil motta brevet.",
      }, 409);
    }
    const skalBekreftes = utfall.filter((rad) => rad.utfall === "bekreft").map((rad) => rad.id);
    if (!skalBekreftes.length) {
      return svar({ ok: true, melding: "Påmeldingen er allerede bekreftet." });
    }
    const skrevet = await db.from("pamelding")
      .update({ bekreftet_at: new Date().toISOString(), avmeldt_at: null })
      .in("id", skalBekreftes);
    const resultat = svarEtterSkriving(skrevet.error?.message ?? null);
    if (!resultat.ok) {
      console.error("bekreft skriv", resultat.feil);
      return svar({ ok: false, feil: "Kunne ikke lagre bekreftelsen. Ingenting er bekreftet." }, 500);
    }
    return svar({ ok: true, melding: "Påmeldingen er bekreftet. Du kan lukke denne siden." });
  }

  const validert = validerPamelding(body);
  if (!validert.ok) return svar({ ok: false, feil: validert.feil }, 400);
  if (validert.bot) {
    return svar({ ok: true, melding: "Sjekk e-posten din og klikk på bekreftelseslenken." });
  }

  const timeSiden = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const epostNokkel = `epost:${await sha256(validert.verdi.epost)}`;
  const ipNokkel = `ip:${await sha256(klientIp(req))}`;
  const [epostAntall, ipAntall] = await Promise.all([
    antallSiden(db, epostNokkel, timeSiden),
    antallSiden(db, ipNokkel, timeSiden),
  ]);
  if (epostAntall == null || ipAntall == null) {
    return svar({ ok: false, feil: "Påmeldingen er midlertidig utilgjengelig. Prøv igjen." }, 503);
  }
  if (erBlokkert(epostAntall, ipAntall)) {
    return svar({ ok: false, feil: "For mange forsøk. Prøv igjen senere." }, 429);
  }
  const { error: loggFeil } = await db.from("meld_pa_forsok").insert([
    { nokkel: epostNokkel },
    { nokkel: ipNokkel },
  ]);
  if (loggFeil) {
    console.error("rate-limit logg", loggFeil.message);
    return svar({ ok: false, feil: "Påmeldingen er midlertidig utilgjengelig. Prøv igjen." }, 503);
  }
  await db.from("meld_pa_forsok").delete()
    .lt("opprettet_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .then(() => undefined, () => undefined);

  const { data: treff, error: lesFeil } = await db.from("pamelding")
    .select("id, bekreftet_at, avmeldt_at, avmeldings_token")
    .eq("epost_normalisert", validert.verdi.epost);
  if (lesFeil) {
    console.error("pamelding les", lesFeil.message);
    return svar({ ok: false, feil: "Kunne ikke lagre påmeldingen. Prøv igjen." }, 500);
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
        console.error("token", tokenFeil.message);
        return svar({ ok: false, feil: "Kunne ikke sende e-posten. Ingenting er endret." }, 500);
      }
    }
    const sendt = await sendEpost(brevMedAvmelding(
      validert.verdi.epost,
      "Du er allerede påmeldt Kulturvarsling",
      medBunn("<p>Adressen er allerede bekreftet. Du trenger ikke gjøre noe mer.</p>"),
      `Adressen er allerede bekreftet. Du trenger ikke gjøre noe mer.\n\n${bunntekst(behandlingsansvarlig)}`,
      avToken,
    ));
    if (!sendt) {
      return svar({ ok: false, feil: "Du er allerede påmeldt, men e-posten kom ikke fram. Prøv igjen." }, 502);
    }
    return svar({ ok: true, melding: "Sjekk e-posten din. Adressen er allerede bekreftet." });
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
    bekreftelses_token: token,
  };

  if (!avToken) avToken = crypto.randomUUID();

  if (rader.length === 0) {
    const { error } = await db.from("pamelding").insert({
      ...felles,
      epost: validert.verdi.epost,
      avmeldings_token: avToken,
    });
    if (error) {
      console.error("pamelding insert", error.message);
      return svar({ ok: false, feil: "Kunne ikke lagre påmeldingen. Ingenting er registrert." }, 500);
    }
  } else {
    const { error } = await db.from("pamelding").update(felles).in("id", rader.map((rad) => rad.id));
    if (error) {
      console.error("pamelding update", error.message);
      return svar({ ok: false, feil: "Kunne ikke lagre påmeldingen. Ingenting er bekreftet." }, 500);
    }
    let skrevAvToken = rader.some((rad) => rad.avmeldings_token === avToken);
    for (const rad of rader) {
      if (rad.avmeldings_token) continue;
      const neste = skrevAvToken ? crypto.randomUUID() : avToken;
      skrevAvToken = true;
      const { error: tokenFeil } = await db.from("pamelding")
        .update({ avmeldings_token: neste })
        .eq("id", rad.id);
      if (tokenFeil) {
        console.error("token", tokenFeil.message);
        return svar({ ok: false, feil: "Kunne ikke lagre påmeldingen. Prøv igjen." }, 500);
      }
    }
  }

  const lenke = bekreftelsesSide(offentligUrl(), token);
  const sendt = await sendEpost(brevMedAvmelding(
    validert.verdi.epost,
    "Bekreft påmelding til Kulturvarsling",
    bekreftHtml(lenke),
    `Bekreft påmeldingen ved å åpne lenken:\n${lenke}\n\nIngenting sendes før lenken er bekreftet.\n\n${bunntekst(behandlingsansvarlig)}`,
    avToken,
  ));
  if (!sendt) {
    return svar({ ok: false, feil: "Vi fikk ikke sendt bekreftelses-e-posten. Prøv igjen." }, 502);
  }
  return svar({
    ok: true,
    melding: "Sjekk e-posten din og klikk på bekreftelseslenken. Du er ikke på listen før den er bekreftet.",
  });
});
