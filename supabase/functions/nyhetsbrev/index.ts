// Ukentlig nyhetsbrev: Claude leser ukens kultursaker og skriver redaksjonell
// analyse og innsikt. Sendes via Resend.
//
// IKKE DEPLOY denne funksjonen før live-kilden (v5, 25.07.2026) er hentet og
// sammenlignet. Bundle-en lot seg ikke laste ned. En deploy overskriver det
// som kjører, også hvis live-koden har avveket fra denne filen.
//
// Tilgang: header x-nyhetsbrev-nokkel må matche hemmeligheten NYHETSBREV_NOKKEL.
// Anon-nøkkelen er ikke nok, selv om gatewayen godtar den som JWT.
//
//   POST {"test": true}                 → HTML, sender ingenting
//   POST {"til": "meg@epost.no"}        → én testadresse (krever hemmeligheten)
//   POST {"bekreft": "send"}            → bare bekreftede, samtykkende, ikke avmeldte
//   GET  ?avmeld=...                    → skriver ingenting (avmelding er /avmeld)
//
// Secrets: NYHETSBREV_NOKKEL, RESEND_API_KEY, ANTHROPIC_API_KEY,
// valgfritt AVSENDER og OFFENTLIG_URL.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  avmeldingsFunksjon,
  avmeldingsSide,
  filtrerMottakere,
  hemmeligheterStemmer,
  listUnsubscribeHeaders,
  normaliserEpost,
  utsendelsesModus,
  type Pameldingsrad,
} from "../_shared/samtykke.ts";

const AVSENDER = Deno.env.get("AVSENDER") ??
  "Kulturvarsling <nyhetsbrev@kulturvarsling.no>";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function offentligUrl(): string {
  return (Deno.env.get("OFFENTLIG_URL") ?? "https://www.kulturvarsling.no").replace(/\/$/, "");
}

// ─── Claude skriver den redaksjonelle analysen ────────────────────────────────
async function skrivAnalyse(
  apiKey: string,
  ukens: any[],
  frister: any[],
): Promise<any | null> {
  const saksliste = ukens.map((v) =>
    `- [${v.kategori}/${v.niva}] ${v.tittel} (${v.instans})${v.frist ? ` FRIST ${v.frist}` : ""}: ${(v.sammendrag ?? "").slice(0, 200)}`
  ).join("\n");
  const fristliste = frister.map((v) =>
    `- ${v.frist}: ${v.tittel} (${v.instans})`
  ).join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 2500,
        messages: [{
          role: "user",
          content: `Du er redaktør for Kulturvarsling.no sitt ukentlige nyhetsbrev til norske kulturaktører (kunstnere, kulturinstitusjoner, organisasjoner). Skriv innsiktsfullt, konkret og engasjert — aldri byråkratisk. Du hjelper travle kulturfolk å forstå hva som ANGÅR DEM.

UKENS NYE SAKER (${ukens.length} stk):
${saksliste || "(ingen nye saker denne uken)"}

KOMMENDE FRISTER (neste 14 dager):
${fristliste || "(ingen)"}

Svar BARE med gyldig JSON, ingen markdown:
{
  "emne": "kort, fengende emnelinje for e-posten",
  "ingress": "2-4 setninger: ukens store bilde — hva bør kulturfeltet merke seg, og hvorfor? Trekk linjer og se mønstre på tvers av sakene.",
  "hovedsaker": [
    { "tittel": "sakens tittel", "analyse": "2-3 setninger: hva skjer, hvem påvirkes, og hva bør man gjøre. Konkret og handlingsrettet." }
  ],
  "sluttord": "1-2 setninger: oppløftende eller skjerpende avslutning"
}
Velg de 3-5 VIKTIGSTE sakene som hovedsaker (mest inngripende for kulturfeltet). Er det færre enn 3 saker totalt, bruk de som finnes.`,
        }],
      }),
    });
    if (!res.ok) {
      console.error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const tekst = (data.content?.find((b: any) => b.type === "text")?.text ?? "{}")
      .replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(tekst);
  } catch (e) {
    console.error("Analyse-feil:", e);
    return null;
  }
}

function byggHtml(
  analyse: any,
  frister: any[],
  antallArkivert: number,
  avmeldUrl: string,
): string {
  const rød = "#8C1C13", bg = "#F6F3EF", tekst = "#2A2320", grå = "#6B5E57";
  const hovedsaker = (analyse.hovedsaker ?? []).map((s: any) => `
    <div style="background:#fff;border:1px solid #E5DDD5;border-radius:12px;padding:18px 20px;margin-bottom:14px;">
      <div style="font-weight:700;font-size:16px;color:${tekst};margin-bottom:6px;">${s.tittel}</div>
      <div style="font-size:14px;color:${grå};line-height:1.6;">${s.analyse}</div>
    </div>`).join("");
  const fristRader = frister.map((v) => `
    <tr><td style="padding:6px 10px;font-weight:700;color:${rød};white-space:nowrap;font-size:13px;">${v.frist}</td>
    <td style="padding:6px 10px;font-size:13px;color:${tekst};"><a href="${v.kilde}" style="color:${tekst};">${v.tittel}</a> <span style="color:${grå};">(${v.instans})</span></td></tr>`).join("");

  return `<!doctype html><html lang="no"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;padding:0;background:${bg};font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:620px;margin:0 auto;padding:28px 18px;">
    <div style="text-align:center;margin-bottom:22px;">
      <div style="font-size:26px;font-weight:800;color:${rød};">Kulturvarsling</div>
      <div style="font-size:12px;color:${grå};letter-spacing:.08em;text-transform:uppercase;">Ukens kulturpolitiske innsikt</div>
    </div>
    <div style="background:#fff;border-radius:14px;padding:22px 24px;margin-bottom:18px;border-left:4px solid ${rød};">
      <div style="font-size:15px;color:${tekst};line-height:1.7;">${analyse.ingress}</div>
    </div>
    <div style="font-size:13px;font-weight:700;color:${grå};text-transform:uppercase;letter-spacing:.06em;margin:22px 0 10px;">Ukens viktigste saker</div>
    ${hovedsaker}
    ${frister.length ? `
    <div style="font-size:13px;font-weight:700;color:${grå};text-transform:uppercase;letter-spacing:.06em;margin:22px 0 10px;">⏰ Frister du ikke må sove på</div>
    <table style="width:100%;background:#fff;border-radius:12px;border:1px solid #E5DDD5;border-collapse:separate;padding:8px;">${fristRader}</table>` : ""}
    <div style="font-size:14px;color:${tekst};line-height:1.7;margin:22px 4px;font-style:italic;">${analyse.sluttord ?? ""}</div>
    <div style="text-align:center;margin-top:26px;">
      <a href="https://www.kulturvarsling.no/app" style="background:${rød};color:#fff;padding:12px 26px;border-radius:99px;text-decoration:none;font-size:14px;font-weight:700;">Se alle sakene i appen →</a>
    </div>
    <div style="text-align:center;font-size:11px;color:${grå};margin-top:30px;line-height:1.7;">
      Du får denne fordi du meldte deg på Kulturvarsling.${antallArkivert ? ` ${antallArkivert} saker ble arkivert til historikken denne uken.` : ""}<br/>
      <a href="${avmeldUrl}" style="color:${grå};">Meld meg av nyhetsbrevet</a>
    </div>
  </div></body></html>`;
}

type Mottaker = { id: number | null; epost: string; avmeldings_token: string | null };

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.searchParams.has("avmeld") || url.searchParams.has("t")) {
    return new Response(
      "Ingenting er endret. Avmelding skjer ikke i denne funksjonen. Bruk lenken i brevet, eller skriv til personvern@kulturvarsling.no.",
      { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  if (!hemmeligheterStemmer(
    req.headers.get("x-nyhetsbrev-nokkel"),
    Deno.env.get("NYHETSBREV_NOKKEL"),
  )) {
    return json({ feil: "Ikke autorisert" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const modus = utsendelsesModus(body);
    if (modus === "avvist") {
      return json({
        feil: "Utsendelse avvist. Ingenting er sendt.",
        hint: 'Test: {"test":true}. Én adresse: {"til":"..."}. Alle kvalifiserte: {"bekreft":"send"}.',
      }, 400);
    }

    let mottakere: Mottaker[] = [];
    if (modus === "alle") {
      const { data, error } = await supabase.from("pamelding")
        .select("id, epost, avmeldings_token, samtykke_gitt_at, bekreftet_at, avmeldt_at");
      if (error) {
        console.error("mottakere", error.message);
        return json({ feil: "Kunne ikke lese mottakere. Ingenting er sendt." }, 500);
      }
      mottakere = filtrerMottakere((data ?? []) as Pameldingsrad[]);
      if (mottakere.length === 0) {
        return json({
          sendt: 0,
          mottakere: 0,
          merknad: "Ingen bekreftede, samtykkende mottakere. Ingenting er sendt.",
        });
      }
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return json({ feil: "mangler ANTHROPIC_API_KEY" }, 500);

    const enUkeSiden = new Date(Date.now() - 7 * 86400000).toISOString();
    const idag = new Date().toISOString().split("T")[0];
    const om14dager = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];

    const { data: ukens } = await supabase.from("varsler")
      .select("tittel, sammendrag, kategori, niva, instans, frist, kilde")
      .eq("publisert", true).gte("opprettet", enUkeSiden)
      .order("opprettet", { ascending: false }).limit(40);
    const { data: frister } = await supabase.from("varsler")
      .select("tittel, instans, frist, kilde")
      .eq("publisert", true).gte("frist", idag).lte("frist", om14dager)
      .order("frist", { ascending: true }).limit(10);
    const { count: antallArkivert } = await supabase.from("varsler")
      .select("id", { count: "exact", head: true })
      .eq("publisert", true).lt("frist", idag).gte("frist", enUkeSiden.split("T")[0]);

    const analyse = await skrivAnalyse(anthropicKey, ukens ?? [], frister ?? []);
    if (!analyse) return json({ feil: "Claude-analysen feilet — se logger" }, 502);

    if (modus === "test") {
      const html = byggHtml(analyse, frister ?? [], antallArkivert ?? 0, "#");
      return json({ emne: analyse.emne, html, antall_ukens: ukens?.length ?? 0 });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ feil: "mangler RESEND_API_KEY. Ingenting er sendt." }, 500);

    if (modus === "en") {
      const epost = normaliserEpost(String(body.til));
      const { data, error } = await supabase.from("pamelding")
        .select("id, epost, avmeldings_token, samtykke_gitt_at, bekreftet_at, avmeldt_at")
        .eq("epost_normalisert", epost);
      if (error) {
        console.error("en mottaker", error.message);
        return json({ feil: "Kunne ikke lese mottakeren. Ingenting er sendt." }, 500);
      }
      mottakere = filtrerMottakere((data ?? []) as Pameldingsrad[]);
      if (mottakere.length === 0) {
        return json({
          sendt: 0,
          merknad: "Adressen er ikke bekreftet, samtykkende og aktiv. Ingenting er sendt.",
        }, 409);
      }
    }

    const utsendelseId = crypto.randomUUID();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    let sendt = 0;
    const feil: string[] = [];
    for (const mottaker of mottakere) {
      const token = mottaker.avmeldings_token;
      const side = token ? avmeldingsSide(offentligUrl(), token) : "mailto:personvern@kulturvarsling.no";
      const html = byggHtml(analyse, frister ?? [], antallArkivert ?? 0, side);
      const text = `${analyse.emne}\n\nMeld deg av: ${side}`;
      const hoder = token
        ? listUnsubscribeHeaders(avmeldingsFunksjon(supabaseUrl, token))
        : { "List-Unsubscribe": "<mailto:avmelding@kulturvarsling.no?subject=avmeld>" };
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: AVSENDER,
          to: mottaker.epost,
          subject: analyse.emne,
          html,
          text,
          headers: hoder,
        }),
      });
      const svarTekst = await res.text();
      let resendId: string | null = null;
      try { resendId = JSON.parse(svarTekst).id ?? null; } catch { /* tomt */ }
      if (res.ok) sendt++;
      else feil.push(`${mottaker.id ?? "test"}: ${res.status}`);

      const { error: loggFeil } = await supabase.from("nyhetsbrev_utsendelser").insert({
        utsendelse_id: utsendelseId,
        pamelding_id: mottaker.id,
        resend_id: resendId,
        status: res.ok ? "sendt" : "feilet",
      });
      if (loggFeil) feil.push(`${mottaker.id ?? "test"}: logg`);
      await new Promise((r) => setTimeout(r, 550));
    }

    const respons = {
      kjørt: new Date().toISOString(),
      emne: analyse.emne,
      utsendelse_id: utsendelseId,
      mottakere: mottakere.length,
      sendt,
      feil: feil.length ? feil.slice(0, 5) : undefined,
    };
    console.log("Nyhetsbrev:", respons);
    return json(respons);
  } catch (e) {
    console.error("Nyhetsbrev-feil:", e);
    return json({ feil: String(e) }, 500);
  }
});
