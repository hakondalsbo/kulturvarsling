// Ukentlig nyhetsbrev: Claude leser ukens kultursaker og skriver redaksjonell
// analyse og innsikt. Sendes via Resend til påmeldte (pamelding-tabellen).
//
// Bruk:
//   POST {"test": true}            → genererer brevet og returnerer HTML (sender INGENTING)
//   POST {"til": "meg@epost.no"}   → sender kun til én adresse (testutsendelse)
//   POST {}                        → full utsendelse til alle påmeldte (ikke avmeldte)
//   GET  ?avmeld=EPOST&t=TOKEN     → avmelding (lenken i bunnen av hvert brev)
//
// Secrets: RESEND_API_KEY (fra resend.com), ANTHROPIC_API_KEY (finnes),
// valgfritt AVSENDER (default "Kulturvarsling <nyhetsbrev@kulturvarsling.no>").

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AVSENDER = Deno.env.get("AVSENDER") ??
  "Kulturvarsling <nyhetsbrev@kulturvarsling.no>";

// ─── Avmeldingstoken: HMAC-aktig hash av epost + hemmelighet ─────────────────
async function avmeldToken(epost: string, hemmelighet: string): Promise<string> {
  const data = new TextEncoder().encode(`${epost.toLowerCase()}:${hemmelighet}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
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
    // Claude 5-modeller kan returnere en thinking-blokk først — finn tekstblokken.
    const tekst = (data.content?.find((b: any) => b.type === "text")?.text ?? "{}")
      .replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(tekst);
  } catch (e) {
    console.error("Analyse-feil:", e);
    return null;
  }
}

// ─── E-post-HTML (enkel, e-postklient-vennlig) ────────────────────────────────
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

// ─── Hoved-handler ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const hemmelighet = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const url = new URL(req.url);

  // ── Avmelding via lenke ──
  const avmeldEpost = url.searchParams.get("avmeld");
  if (avmeldEpost) {
    const gyldig = (await avmeldToken(avmeldEpost, hemmelighet)) ===
      url.searchParams.get("t");
    if (!gyldig) return new Response("Ugyldig avmeldingslenke.", { status: 400 });
    await supabase.from("pamelding").update({ avmeldt: true })
      .eq("epost", avmeldEpost);
    return new Response(
      "<html><body style='font-family:sans-serif;text-align:center;padding:60px 20px;'><h2>Du er meldt av 👋</h2><p>Du mottar ikke flere nyhetsbrev fra Kulturvarsling.</p></body></html>",
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(JSON.stringify({ feil: "mangler ANTHROPIC_API_KEY" }), { status: 500 });
    }

    // ── Hent ukens datagrunnlag ──
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

    // ── Claude skriver analysen ──
    const analyse = await skrivAnalyse(anthropicKey, ukens ?? [], frister ?? []);
    if (!analyse) {
      return new Response(JSON.stringify({ feil: "Claude-analysen feilet — se logger" }), { status: 502 });
    }

    // ── Test-modus: returner HTML uten å sende ──
    if (body.test) {
      const html = byggHtml(analyse, frister ?? [], antallArkivert ?? 0, "#");
      return new Response(
        JSON.stringify({ emne: analyse.emne, html, analyse_raa: analyse, antall_ukens: ukens?.length ?? 0 }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Utsendelse via Resend ──
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ feil: "mangler RESEND_API_KEY — opprett gratis på resend.com" }), { status: 500 });
    }

    let mottakere: string[];
    if (body.til) {
      mottakere = [body.til];
    } else {
      const { data: påmeldte } = await supabase.from("pamelding")
        .select("epost").or("avmeldt.is.null,avmeldt.eq.false");
      mottakere = [...new Set((påmeldte ?? []).map((p: any) => p.epost).filter(Boolean))];
    }

    let sendt = 0;
    const feil: string[] = [];
    for (const epost of mottakere) {
      const token = await avmeldToken(epost, hemmelighet);
      const avmeldUrl =
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/nyhetsbrev?avmeld=${encodeURIComponent(epost)}&t=${token}`;
      const html = byggHtml(analyse, frister ?? [], antallArkivert ?? 0, avmeldUrl);
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: AVSENDER, to: epost, subject: analyse.emne, html }),
      });
      if (res.ok) sendt++;
      else feil.push(`${epost}: ${res.status} ${(await res.text()).slice(0, 100)}`);
      await new Promise((r) => setTimeout(r, 550)); // Resend: maks 2 kall/sek
    }

    const respons = { kjørt: new Date().toISOString(), emne: analyse.emne, mottakere: mottakere.length, sendt, feil: feil.length ? feil.slice(0, 5) : undefined };
    console.log("Nyhetsbrev:", respons);
    return new Response(JSON.stringify(respons), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Nyhetsbrev-feil:", e);
    return new Response(JSON.stringify({ feil: String(e) }), { status: 500 });
  }
});
