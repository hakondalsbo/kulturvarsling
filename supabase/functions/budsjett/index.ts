// Budsjettverktøy (VEIKART E4) — premium fagverktøy.
// Henter kommunens kulturøkonomi fra SSB KOSTRA (tabell 13135, verifisert),
// sammenligner med landssnittet og lar Claude tolke tallene i klartekst.
//
// POST {list:true}       → liste over kommuner {nr, navn} (for velgeren)
// POST {kommunenr:"1103"} → {kommune, aar, tall, landssnitt, tolkning}
//
// KOSTRA-region = rått kommunenummer (samme som varsler.kommunenr fra
// geo-taggingen). EAK = «Landet». Secrets: ANTHROPIC_API_KEY (finnes).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SSB = "https://data.ssb.no/api/v0/no/table/13135";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Nøkkeltall vi henter og viser (kode → kort etikett). Underområdene (allmenn
// kultur, bibliotek, kulturskole) avslører SKJULTE KUTT: totalen kan stige mens
// et enkelttilbud squeezes — det er nettopp det brukerne trenger å se.
const NØKKELTALL: Array<[string, string, string]> = [
  ["KOSdriftinnb0000", "Kultur totalt per innbygger", "kr"],
  ["KOSdriftkultur0000", "Andel av kommunebudsjettet", "%"],
  ["KOSdriftallmenni0000", "Allmenn kultur per innbygger", "kr"],
  ["KOSdriftbiblinnb0000", "Bibliotek per innbygger", "kr"],
  ["KOSmusikkandelba0000", "Barn i kulturskole", "%"],
];
const ÅR = ["2021", "2022", "2023", "2024", "2025"];

// ─── SSB-uttrekk → {contentsCode: {år: verdi}} ────────────────────────────────
async function hentKostra(region: string): Promise<Record<string, Record<string, number | null>>> {
  const res = await fetch(SSB, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: [
        { code: "KOKkommuneregion0000", selection: { filter: "item", values: [region] } },
        { code: "ContentsCode", selection: { filter: "item", values: NØKKELTALL.map((n) => n[0]) } },
        { code: "Tid", selection: { filter: "item", values: ÅR } },
      ],
      response: { format: "json-stat2" },
    }),
  });
  if (!res.ok) throw new Error(`SSB ${res.status}`);
  const j = await res.json();
  const contents = Object.keys(j.dimension.ContentsCode.category.index);
  const tid = Object.keys(j.dimension.Tid.category.index);
  const ut: Record<string, Record<string, number | null>> = {};
  contents.forEach((c, ci) => {
    ut[c] = {};
    tid.forEach((t, ti) => { ut[c][t] = j.value[ci * tid.length + ti] ?? null; });
  });
  return ut;
}

// ─── Kommuneliste fra metadata (kun gjeldende: har verdi i siste år) ──────────
async function hentKommuneListe(): Promise<Array<{ nr: string; navn: string }>> {
  const res = await fetch(SSB, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: [
        { code: "KOKkommuneregion0000", selection: { filter: "all", values: ["*"] } },
        { code: "ContentsCode", selection: { filter: "item", values: ["KOSdriftinnb0000"] } },
        { code: "Tid", selection: { filter: "item", values: ["2025"] } },
      ],
      response: { format: "json-stat2" },
    }),
  });
  if (!res.ok) throw new Error(`SSB ${res.status}`);
  const j = await res.json();
  const cat = j.dimension.KOKkommuneregion0000.category;
  const koder = Object.keys(cat.index);
  const liste: Array<{ nr: string; navn: string }> = [];
  koder.forEach((k) => {
    // Kun gjeldende kommuner: 4-sifret numerisk kode med en verdi i 2025.
    if (/^\d{4}$/.test(k) && j.value[cat.index[k]] != null) {
      liste.push({ nr: k, navn: cat.label[k] });
    }
  });
  liste.sort((a, b) => a.navn.localeCompare(b.navn, "no"));
  return liste;
}

// ─── Claude tolker tallene ────────────────────────────────────────────────────
async function tolkMedClaude(
  kommune: string, tall: any, landssnitt: any, apiKey: string,
): Promise<any | null> {
  const oppsummer = (data: any) => NØKKELTALL.map(([kode, navn, enhet]) => {
    const serie = ÅR.map((å) => data[kode]?.[å]).filter((v: any) => v != null);
    const siste = serie[serie.length - 1], førre = serie[serie.length - 2];
    return `${navn}: ${siste ?? "—"} ${enhet}${førre != null ? ` (i fjor ${førre})` : ""}`;
  }).join("; ");
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        // Sonnet 5 tenker adaptivt, og tenke-tokens teller mot max_tokens —
        // gi rom nok til både tenking og JSON-svaret (900 ga tomt svar).
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: `Du hjelper en travel kulturaktør å forstå ${kommune} kommunes kulturøkonomi — og å OPPDAGE SKJULTE KUTT. Kommuner fremhever gjerne at «kulturbudsjettet øker», mens enkelttilbud (bibliotek, kulturskole, allmenn kultur) samtidig kuttes. Din jobb er å se forbi totalen og finne hva som faktisk skjer med de konkrete tilbudene. Bruk KOSTRA-tall (SSB), flere år.

${kommune} (eldste → nyeste år): ${oppsummer(tall)}
Landssnittet: ${oppsummer(landssnitt)}

Svar BARE med gyldig JSON, ingen markdown:
{
  "overskrift": "kort konklusjon i én setning — fremhev spriket hvis totalen og enkelttilbudene spriker",
  "hovedtall": "hva bruker kommunen totalt per innbygger, mot landssnittet — i klartekst",
  "skjulte_kutt": "SE ETTER: stiger/er stabil totalen mens bibliotek, kulturskole eller allmenn kultur går ned? Nevn konkret hvilke tilbud som squeezes, med tall. Hvis ingen skjulte kutt: si det ærlig.",
  "hva_betyr_det": "hva dette betyr for kulturfeltet i kommunen, konkret og nøkternt — ikke overdriv",
  "sporsmaal_til_politikerne": "ett skarpt, konkret spørsmål en kulturaktør kan stille lokalpolitikerne — helst om et konkret tilbud som kuttes"
}`,
        }],
      }),
    });
    if (!res.ok) { console.error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`); return null; }
    const data = await res.json();
    const tekst = (data.content?.find((b: any) => b.type === "text")?.text ?? "{}")
      .replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(tekst);
  } catch (e) { console.error("Claude-tolkning feil:", e); return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (o: any, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));

    if (body.list) {
      const liste = await hentKommuneListe();
      return json({ kommuner: liste });
    }

    const kommunenr = String(body.kommunenr ?? "").replace(/\D/g, "");
    if (!/^\d{4}$/.test(kommunenr)) return json({ feil: "Ugyldig kommunenr" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Cache per kommune (tallene endres årlig — cache er trygt lenge).
    const { data: cachet } = await supabase.from("budsjett_cache")
      .select("data").eq("kommunenr", kommunenr).maybeSingle();
    if (cachet?.data) return json({ ...cachet.data, cache: true });

    const [tall, landssnitt] = await Promise.all([hentKostra(kommunenr), hentKostra("EAK")]);
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const listeRes = await hentKommuneListe();
    const kommune = listeRes.find((k) => k.nr === kommunenr)?.navn ?? `Kommune ${kommunenr}`;
    const tolkning = apiKey ? await tolkMedClaude(kommune, tall, landssnitt, apiKey) : null;

    const svar = {
      kommune, kommunenr, aar: ÅR,
      nøkkeltall: NØKKELTALL.map(([kode, navn, enhet]) => ({
        kode, navn, enhet,
        serie: ÅR.map((å) => tall[kode]?.[å] ?? null),
        landssnitt: landssnitt[kode]?.[ÅR[ÅR.length - 1]] ?? null,
      })),
      tolkning,
    };
    // Lagre i cache (feiler stille hvis tabellen ikke finnes ennå).
    await supabase.from("budsjett_cache").upsert({ kommunenr, data: svar }).then(
      () => {}, () => {});
    return json(svar);
  } catch (e) {
    console.error("Budsjett-feil:", e);
    return json({ feil: String(e) }, 500);
  }
});
