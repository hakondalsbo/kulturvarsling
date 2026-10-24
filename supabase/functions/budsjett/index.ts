import { harPremium, reserverAiKvote } from "../_shared/tilgang.ts";
import { budsjettNokkel, lesBudsjettCache, pakkBudsjettCache, summerTilgjengeligeTall, parseBudsjettTolkning } from "./logikk.ts";
import { hentBearerToken } from "../klartekst/logikk.ts";
import { kallClaude } from "../_shared/claude.ts";
// Budsjettverktøy (VEIKART E4) — premium fagverktøy. Tre nivåer:
//   POST {kommunenr:"1103"} → SSB KOSTRA 13135 (kommune, per innbygger)
//   POST {fylkesnr:"11"}     → SSB KOSTRA 12264 (fylkeskommune, per innbygger)
//   POST {nasjonalt:true}    → SSB COFOG 10726 (statsforvaltningen, mill. kr)
//   POST {list:true}         → liste over kommuner {nr, navn} (for velgeren)
//
// Alle svar har samme form {nivå, navn, aar, nøkkeltall[], tolkning}.
// Underområdene avslører SKJULTE KUTT: totalen kan stige mens et enkelttilbud
// (bibliotek, kulturskole, investering) squeezes. Secrets: ANTHROPIC_API_KEY.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { corsHeadere } from "../_shared/cors.ts";

const API = "https://data.ssb.no/api/v0/no/table";
const ÅR = ["2021", "2022", "2023", "2024", "2025"];

// Kommune (13135) og fylke (12264): [SSB-kode, etikett, enhet].
const KOMMUNE_TALL: Array<[string, string, string]> = [
  ["KOSdriftinnb0000", "Kultur totalt per innbygger", "kr"],
  ["KOSdriftkultur0000", "Andel av kommunebudsjettet", "%"],
  ["KOSdriftallmenni0000", "Allmenn kultur per innbygger", "kr"],
  ["KOSdriftbiblinnb0000", "Bibliotek per innbygger", "kr"],
  ["KOSmusikkandelba0000", "Barn i kulturskole", "%"],
];
const FYLKE_TALL: Array<[string, string, string]> = [
  ["KOSdriftkulturin0000", "Kultur totalt per innbygger", "kr"],
  ["KOSnettodriftfyl0000", "Andel av fylkesbudsjettet", "%"],
  ["KOSdriftbiblinn0000", "Bibliotek per innbygger", "kr"],
  ["KOSdriftmuseerin0000", "Museer per innbygger", "kr"],
  ["KOSdriftkunstinn0000", "Kunstformidling per innbygger", "kr"],
];

// ─── Generisk KOSTRA-uttrekk (kommune/fylke) ──────────────────────────────────
async function hentKostra(
  table: string, regionVar: string, region: string, koder: string[],
): Promise<Record<string, Record<string, number | null>>> {
  const res = await fetch(`${API}/${table}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: [
        { code: regionVar, selection: { filter: "item", values: [region] } },
        { code: "ContentsCode", selection: { filter: "item", values: koder } },
        { code: "Tid", selection: { filter: "item", values: ÅR } },
      ],
      response: { format: "json-stat2" },
    }),
  });
  if (!res.ok) throw new Error(`SSB ${table} ${res.status}`);
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

function byggNøkkeltall(tall: any, snitt: any, def: Array<[string, string, string]>) {
  return def.map(([kode, navn, enhet]) => ({
    kode, navn, enhet,
    serie: ÅR.map((å) => tall[kode]?.[å] ?? null),
    landssnitt: snitt ? (snitt[kode]?.[ÅR.filter((å) => tall[kode]?.[å] != null).slice(-1)[0]] ?? null) : null,
  }));
}

// ─── Nasjonalt: COFOG 10726, statsforvaltningen, formål 082 Kultur ────────────
async function hentNasjonalt() {
  const typer = [["Lonn", "Lønn"], ["VarerTjenester", "Varer og tjenester"], ["Investeringer", "Investeringer"]];
  const res = await fetch(`${API}/10726`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: [
        { code: "Sektor", selection: { filter: "item", values: ["6100"] } },
        { code: "Formaal", selection: { filter: "item", values: ["COF082"] } },
        { code: "ContentsCode", selection: { filter: "item", values: typer.map((t) => t[0]) } },
        { code: "Tid", selection: { filter: "item", values: ["2020", "2021", "2022", "2023", "2024"] } },
      ],
      response: { format: "json-stat2" },
    }),
  });
  if (!res.ok) throw new Error(`SSB 10726 ${res.status}`);
  const j = await res.json();
  const tid = Object.keys(j.dimension.Tid.category.index);
  const cc = Object.keys(j.dimension.ContentsCode.category.index);
  // Verdi per type per år; total = sum over typer.
  const perType: Record<string, Array<number | null>> = {};
  cc.forEach((c, ci) => { perType[c] = tid.map((_t, ti) => j.value[ci * tid.length + ti] ?? null); });
  const total = tid.map((_t, ti) => summerTilgjengeligeTall(cc.map((c) => perType[c][ti])));
  const nøkkeltall = [
    { kode: "total", navn: "Statlige kulturutgifter totalt", enhet: "mill kr", serie: total.map((v) => v === null ? null : Math.round(v)), landssnitt: null },
    ...typer.map(([kode, navn]) => ({
      kode, navn: navn + " (av dette)", enhet: "mill kr",
      serie: perType[kode].map((v) => v === null ? null : Math.round(v)), landssnitt: null,
    })),
  ];
  return { aar: tid, nøkkeltall };
}

// ─── Kommuneliste (for velgeren) ──────────────────────────────────────────────
async function hentKommuneListe(): Promise<Array<{ nr: string; navn: string }>> {
  const res = await fetch(`${API}/13135`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: [
        { code: "KOKkommuneregion0000", selection: { filter: "all", values: ["*"] } },
        { code: "ContentsCode", selection: { filter: "item", values: ["KOSdriftinnb0000"] } },
        { code: "Tid", selection: { filter: "item", values: ["2025"] } },
      ],
      response: { format: "json-stat2" },
    }),
  });
  if (!res.ok) throw new Error(`SSB 13135 ${res.status}`);
  const j = await res.json();
  const cat = j.dimension.KOKkommuneregion0000.category;
  const liste: Array<{ nr: string; navn: string }> = [];
  Object.keys(cat.index).forEach((k) => {
    if (/^\d{4}$/.test(k) && j.value[cat.index[k]] != null) liste.push({ nr: k, navn: cat.label[k] });
  });
  liste.sort((a, b) => a.navn.localeCompare(b.navn, "no"));
  return liste;
}

// ─── Claude tolker (nivå-tilpasset prompt) ────────────────────────────────────
async function tolkMedClaude(navn: string, nivå: string, aar: string[], nøkkeltall: any[], apiKey: string) {
  const linjer = nøkkeltall.map((n) => {
    const snitt = n.landssnitt != null ? ` (landssnitt ${n.landssnitt})` : "";
    return `${n.navn}: ${n.serie.map((v: unknown, i: number) => `${aar[i]}: ${v ?? "mangler"}`).join(" → ")} ${n.enhet}${snitt}`;
  }).join("\n");
  const nivåTekst = nivå === "nasjonalt"
    ? `Dette er STATENS kulturutgifter (COFOG). Tallene er nominelle mill. kr — Inflasjon er ikke oppgitt. Ikke kall en nominell endring et reelt kutt uten dokumentert prisjustering.`
    : `Kommuner/fylker fremhever gjerne at «kulturbudsjettet øker», mens enkelttilbud (bibliotek, museer, kulturskole) samtidig kuttes. Se forbi totalen.`;
  try {
    const res = await kallClaude({
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 2000, // Sonnet 5 tenke-tokens teller mot grensen
        messages: [{
          role: "user",
          content: `Du hjelper en travel kulturaktør å forstå ${navn} sin kulturøkonomi. Skill dokumenterte nominelle endringer fra tolkning. Manglende tall er ukjent, aldri null kroner. Inflasjon er ikke oppgitt; ikke konkluder med reelle kutt uten prisjustering. ${nivåTekst}

Tall (eldste → nyeste år):
${linjer}

Svar BARE med gyldig JSON, ingen markdown:
{
  "overskrift": "kort konklusjon i én setning — fremhev spriket hvis totalen og enkeltdelene spriker",
  "hovedtall": "hva brukes, og hvordan ligger det an (mot landssnitt / mot prisvekst) — i klartekst",
  "skjulte_kutt": "Nevn dokumenterte nominelle reduksjoner i enkeltdeler selv om totalen øker, med år og tall. Stillstand alene dokumenterer ikke et reelt kutt. Manglende tall: si at sammenligning ikke er mulig.",
  "hva_betyr_det": "hva dette betyr for kulturfeltet, konkret og nøkternt — ikke overdriv",
  "sporsmaal_til_politikerne": "ett skarpt, konkret spørsmål basert på tallene — helst om noe som kuttes"
}`,
        }],
      }),
    }, "budsjett");
    if (!res.ok) { console.error(`Claude HTTP ${res.status}`); return null; }
    const data = await res.json();
    const tekst = (data.content?.find((b: any) => b.type === "text")?.text ?? "{}")
      .replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    return parseBudsjettTolkning(JSON.parse(tekst));
  } catch (e) { console.error("Claude-tolkning feil:", e); return null; }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeadere(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Bruk POST", { status: 405, headers: cors });
  const json = (o: any, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ feil: "Ugyldig forespørsel" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const token = hentBearerToken(req.headers.get("authorization"));
    if (!token) return json({ feil: "Du må være innlogget" }, 401);
    const { data: auth, error: authFeil } = await supabase.auth.getUser(token);
    if (authFeil || !auth.user || auth.user.is_anonymous) return json({ feil: "Du må være innlogget" }, 401);
    const { data: profil, error: profilFeil } = await supabase.from("profiler").select("plan").eq("id", auth.user.id).maybeSingle();
    if (profilFeil) return json({ feil: "Kunne ikke kontrollere abonnementet akkurat nå" }, 503);
    if (!harPremium(profil)) return json({ feil: "Budsjettanalyse krever Premium" }, 403);
    if (body.list === true) return json({ kommuner: await hentKommuneListe() });
    const nøkkel = budsjettNokkel(body);
    if (!nøkkel) return json({ feil: "Velg et gyldig område" }, 400);
    const { data: cacheRad, error: cacheFeil } = await supabase.from("budsjett_cache")
      .select("data").eq("kommunenr", nøkkel).maybeSingle();
    if (cacheFeil) return json({ feil: "Kunne ikke hente budsjettanalysen akkurat nå" }, 503);
    const cachet = lesBudsjettCache(cacheRad?.data);
    if (cachet) return json({ ...cachet, cache: true });


    if (apiKey) {
      const kvote = await reserverAiKvote(supabase, auth.user.id, "budsjett", true);
      if (kvote !== "ok") return json({ feil: kvote === "grense" ? "Du har nådd grensen på 10 nye budsjettanalyser i dag. Lagrede analyser er fortsatt tilgjengelige." : "Kunne ikke kontrollere analysegrensen akkurat nå" }, kvote === "grense" ? 429 : 503);
    }
    // Bestem nivå + cache-nøkkel.
    let nivå: string, navn: string, aar: string[], nøkkeltall: any[], cacheKey: string;

    if (body.nasjonalt) {
      nivå = "nasjonalt"; navn = "Norge (staten)"; cacheKey = "nasjonalt";
      const n = await hentNasjonalt(); aar = n.aar; nøkkeltall = n.nøkkeltall;
    } else if (body.fylkesnr) {
      const fnr = String(body.fylkesnr).replace(/\D/g, "").slice(0, 2);
      if (fnr.length !== 2) return json({ feil: "Ugyldig fylkesnr" }, 400);
      nivå = "fylke"; cacheKey = `fylke-${fnr}`;
      const region = fnr + "00";
      const [tall, snitt] = await Promise.all([
        hentKostra("12264", "KOKfylkesregion0000", region, FYLKE_TALL.map((n) => n[0])),
        hentKostra("12264", "KOKfylkesregion0000", "EAFK", FYLKE_TALL.map((n) => n[0])),
      ]);
      navn = ({ "03": "Oslo", "11": "Rogaland", "15": "Møre og Romsdal", "18": "Nordland", "31": "Østfold", "32": "Akershus", "33": "Buskerud", "34": "Innlandet", "39": "Vestfold", "40": "Telemark", "42": "Agder", "46": "Vestland", "50": "Trøndelag", "55": "Troms", "56": "Finnmark" } as any)[fnr] ?? `Fylke ${fnr}`;
      navn += " fylkeskommune";
      aar = ÅR; nøkkeltall = byggNøkkeltall(tall, snitt, FYLKE_TALL);
    } else {
      const knr = String(body.kommunenr ?? "").replace(/\D/g, "");
      if (!/^\d{4}$/.test(knr)) return json({ feil: "Ugyldig kommunenr" }, 400);
      nivå = "kommune"; cacheKey = `kommune-${knr}`;
      const [tall, snitt] = await Promise.all([
        hentKostra("13135", "KOKkommuneregion0000", knr, KOMMUNE_TALL.map((n) => n[0])),
        hentKostra("13135", "KOKkommuneregion0000", "EAK", KOMMUNE_TALL.map((n) => n[0])),
      ]);
      const liste = await hentKommuneListe();
      navn = liste.find((k) => k.nr === knr)?.navn ?? `Kommune ${knr}`;
      aar = ÅR; nøkkeltall = byggNøkkeltall(tall, snitt, KOMMUNE_TALL);
    }

    const tolkning = apiKey ? await tolkMedClaude(navn, nivå, aar, nøkkeltall, apiKey) : null;
    const svar = { nivå, kommune: navn, aar, nøkkeltall, tolkning };
    await supabase.from("budsjett_cache").upsert({ kommunenr: cacheKey, data: pakkBudsjettCache(svar) }).then(({ error }) => { if (error) console.error("Budsjett cache-lagring feilet"); });
    return json(svar);
  } catch (e) {
    console.error("Budsjett-feil:", e);
    return json({ feil: "Kunne ikke hente budsjettdata akkurat nå" }, 500);
  }
});
