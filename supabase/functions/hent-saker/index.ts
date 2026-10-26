import { kallClaude } from "../_shared/claude.ts";
import { kildegrunnlag, loggUdokumenterteTall, publiseresEtterKontroll } from "../_shared/kildekontroll.ts";
import {
  genererGenerellKlartekst,
  lagreKlartekstCache,
  MAKS_KLARTEKST_PER_KJORING,
} from "../klartekst/generer.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import {
  byggSammendragPrompt,
  byggVarselRad,
  dedupEtterInnhold,
  dedupEtterKilde,
  erKulturRelevant,
  erKulturSak,
  erPortefoljesak,
  erRegjeringenHoring,
  erRegjeringenRelevant,
  finnHøringsfrist,
  innholdDedupNokkel,
  kategoriForEinnsyn,
  kategoriFraAdapter,
  kategoriFraTittel,
  kildeNokkel,
  parseStortingetDato,
  planleggEmneDedup,
  sakstypeFraSak,
  statusForSak,
  stortingsSesjoner,
} from "./logikk.ts";
import {
  VELLYKKEDE_KJORING_STATUSER,
  avklarKjoering,
  byggKildeKjoringRad,
  filtrerNyeEtterKildedato,
  planleggKildePublisertBackfill,
  tellDatofilter,
  type Kjoeringstype,
} from "./datofilter.ts";
import { geografiSomLagres, hentEInnsynKultursaker } from "./einnsyn.ts";
import {
  einnsynV2Aktiv,
  einnsynValg,
  hentEInnsynV2,
  lesKildeutvalg,
  skalKjoreKilde,
} from "./einnsyn-v2.ts";
import { hentBergenSaker } from "./bergen.ts";
import {
  hovedsakForHoring,
  hentStortingetHoringer,
  planleggHoringLagring,
  stortingSakIdFraUrl,
} from "./stortinget-horinger.ts";
import { hentKulturdirektoratetTildelinger } from "./kulturdirektoratet.ts";
import { hentSametingetSaker } from "./sametinget.ts";
import { hentRegjeringenRSS, parseOgBerik } from "./regjeringen.ts";
import { BACKFILL_KODE, kjorRegjeringenBackfill, planleggTommeHoringsfrister } from "./backfill.ts";
import {
  feilFraStatus,
  feilFraUnntak,
  feilUtfall,
  klassifiserKjøring,
  lesSakerListe,
  lesTekstRespons,
  medClaudeFeil,
  okUtfall,
  sesjonIdStemmer,
  slåSammenAdapterdeler,
  tidligAvslag,
  utledKjoertAv,
  uventetFormat,
  type AdapterDel,
  type AdapterUtfall,
  type KjoertAv,
} from "./kildehelse.ts";

// ─── Stortinget: kultursaker med høringsfrister ───────────────────────────────
// Komitéhøringer hentes i eget løp, stortinget-horinger, fra eksport/horinger
// (HTTP 200, verifisert 24.10.2026). eksport/horingsoversikt finnes ikke (404).
// Strategi for saker: hent ALLE saker for sesjonen (serverens komité-filter
// ignoreres uansett), filtrer klientside med erKulturSak, og slå opp
// eksport/sak per NY kultursak for å finne HOERFRIST. Detaljoppslag gjøres kun
// for saker vi ikke har fra før, så antall kall er lite etter første kjøring.
//
// Begge sesjonene (gjeldende + forrige, Europe/Oslo) blir ETT utfall.
// Feiler én, fortsetter den andre, og kjøringen klassifiseres som delvis.
//
// Stille tomme svar (fram til 20.10): endepunktet paginerer ikke — `side`
// ignoreres og hele sesjonen kommer i ett JSON-dokument. Et kall som henger
// eller får XML/feil sesjon_id skal ikke bli 0 råtreff. Tom liste med riktig
// sesjon_id er et ekte 0, og klassifiseres som feil_tomt_svar når kilden
// forventer treff.
const STORTING_TIMEOUT_MS = 25_000;

function tomStortingDel(feil: AdapterDel["feil"], httpStatus: number | null): AdapterDel {
  return { items: [], raattAntall: 0, antallEtterFilter: 0, feil, httpStatus };
}

async function hentEnStortingssesjon(
  sesjon: string,
  eksKilder: Set<string>,
): Promise<AdapterDel> {
  const url =
    `https://data.stortinget.no/eksport/saker?sesjonid=${encodeURIComponent(sesjon)}&format=json`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Kulturvarsling/1.0" },
      signal: AbortSignal.timeout(STORTING_TIMEOUT_MS),
    });
    const lest = await lesTekstRespons(res, url);
    if ("feil" in lest) {
      console.error(`Stortinget saker ${sesjon}: ${lest.feil.melding}`, url);
      return tomStortingDel(lest.feil, lest.feil.httpStatus);
    }
    if (lest.tekst.trimStart().startsWith("<")) {
      const feil = uventetFormat(url, "XML i stedet for JSON");
      console.error(`Stortinget saker ${sesjon}: ${feil.melding}`, url);
      return tomStortingDel(feil, res.status);
    }
    let data: unknown;
    try {
      data = JSON.parse(lest.tekst);
    } catch (e) {
      const feil = feilFraUnntak(e, url);
      console.error(`Stortinget saker parse ${sesjon}:`, e);
      return tomStortingDel(feil, res.status);
    }
    if (!sesjonIdStemmer(data, sesjon)) {
      const feil = uventetFormat(url, "sesjon_id stemmer ikke");
      console.error(`Stortinget saker ${sesjon}: ${feil.melding}`, url);
      return tomStortingDel(feil, res.status);
    }
    const liste = lesSakerListe(data);
    if ("feil" in liste) {
      const feil = uventetFormat(url, liste.feil);
      console.error(`Stortinget saker ${sesjon}: ${feil.melding}`, url);
      return tomStortingDel(feil, res.status);
    }
    const alleSaker: any[] = liste.saker;
    const kultursaker = alleSaker.filter(erKulturSak);
    console.log(
      `Stortinget (${sesjon}): ${alleSaker.length} saker totalt, ${kultursaker.length} kulturrelevante`,
    );

    const vurderes = kultursaker.filter((sak) => sak.tittel ?? sak.korttittel ?? "");
    const items: any[] = [];
    for (const sak of vurderes) {
      const tittel = sak.tittel ?? sak.korttittel ?? "";
      const kilde =
        `https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=${sak.id}`;
      const nokkel = kildeNokkel(kilde);
      if (nokkel && eksKilder.has(nokkel)) continue; // detaljoppslag kun for nye saker

      let frist: string | null = null;
      const detUrl =
        `https://data.stortinget.no/eksport/sak?sakid=${sak.id}&format=json`;
      try {
        const detRes = await fetch(detUrl, {
          headers: { Accept: "application/json", "User-Agent": "Kulturvarsling/1.0" },
          signal: AbortSignal.timeout(STORTING_TIMEOUT_MS),
        });
        if (!detRes.ok) {
          const feil = feilFraStatus(detRes.status, detUrl);
          console.error(`Detaljoppslag for sak ${sak.id} feilet: ${feil.melding}`, detUrl);
          return {
            items,
            raattAntall: alleSaker.length,
            antallEtterFilter: vurderes.length,
            feil,
            httpStatus: feil.httpStatus,
          };
        }
        frist = finnHøringsfrist(await detRes.json());
      } catch (e) {
        const feil = feilFraUnntak(e, detUrl);
        console.error(`Detaljoppslag for sak ${sak.id} feilet:`, e);
        return {
          items,
          raattAntall: alleSaker.length,
          antallEtterFilter: vurderes.length,
          feil,
          httpStatus: feil.httpStatus ?? res.status,
        };
      }

      items.push({
        tittel,
        instans: sak.komite?.navn
          ? `${sak.komite.navn}, Stortinget`
          : "Stortinget",
        kilde,
        frist,
        sammendrag_raa: sak.henvisning ?? "",
        kilde_id: `stortinget-sak-${sak.id}`,
        publisert_dato: parseStortingetDato(sak.sist_oppdatert_dato),
        // sist_oppdatert er ikke publiseringstid og brukes ikke som datogrense.
        kilde_publisert: null,
        forhåndsgodkjent: true, // valgt via komité/emne — skal ikke stoppes av nøkkelordfilteret
      });
    }
    return {
      items,
      raattAntall: alleSaker.length,
      antallEtterFilter: vurderes.length,
      feil: null,
      httpStatus: res.status,
    };
  } catch (e) {
    const feil = feilFraUnntak(e, url);
    console.error("Stortinget saker feil:", e);
    return tomStortingDel(feil, feil.httpStatus);
  }
}

async function hentStortingetSaker(eksKilder: Set<string>): Promise<AdapterUtfall> {
  const deler: AdapterDel[] = [];
  for (const sesjon of stortingsSesjoner()) {
    deler.push(await hentEnStortingssesjon(sesjon, eksKilder));
  }
  return slåSammenAdapterdeler(deler);
}

// ─── Stortinget: ventede saker (tidligvarsling) ───────────────────────────────
// Regjeringens VARSLEDE kommende proposisjoner/meldinger — lar oss varsle
// kulturfeltet FØR sakene fremmes for Stortinget. (Verifisert i kildekartet.)
async function hentVentedeSaker(): Promise<AdapterUtfall> {
  const url = "https://data.stortinget.no/eksport/ventedesaker?format=json";
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Kulturvarsling/1.0" },
      signal: AbortSignal.timeout(STORTING_TIMEOUT_MS),
    });
    const lest = await lesTekstRespons(res, url);
    if ("feil" in lest) {
      console.error(`Ventede saker: ${lest.feil.melding}`, url);
      return feilUtfall(lest.feil);
    }
    if (lest.tekst.trimStart().startsWith("<")) {
      const feil = uventetFormat(url, "XML i stedet for JSON");
      console.error(`Ventede saker: ${feil.melding}`, url);
      return feilUtfall(feil);
    }
    let data: unknown;
    try {
      data = JSON.parse(lest.tekst);
    } catch (e) {
      const feil = feilFraUnntak(e, url);
      console.error("Ventede saker parse:", e);
      return feilUtfall(feil);
    }
    const liste = lesSakerListe(data);
    if ("feil" in liste) {
      const feil = uventetFormat(url, liste.feil);
      console.error(`Ventede saker: ${feil.melding}`, url);
      return feilUtfall(feil);
    }
    const saker: any[] = liste.saker;
    const items: any[] = [];

    for (const sak of saker) {
      const departement: string = sak.departement ?? "";
      const tittel: string = sak.tittel ?? "";
      if (!tittel) continue;
      if (!/kultur/i.test(departement) && !erKulturRelevant(tittel)) continue;
      items.push({
        tittel: `Varslet sak: ${tittel}`,
        instans: departement || "Regjeringen",
        kilde: `https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/ventede-saker/#sak-${sak.id}`,
        frist: null,
        sammendrag_raa: `${sak.type ?? "Sak"} varslet fremmet i ${sak["måned"] ?? "kommende sesjon"}. ` + "Tidligvarsling: saken er ennå ikke fremmet for Stortinget.",
        kilde_id: `stortinget-ventet-${sak.id}`,
        forhåndsgodkjent: true,
      });
    }
    console.log(
      `Ventede saker: ${saker.length} totalt, ${items.length} kulturrelevante`,
    );
    return okUtfall(items, saker.length, items.length, res.status);
  } catch (e) {
    console.error("Ventede saker feil:", e);
    return feilUtfall(feilFraUnntak(e, url));
  }
}

// ─── Claude API: kategoriser og sammendrag ────────────────────────────────────
// Siste feilårsak eksponeres i responsen (siste_analyse_feil) for feilsøking.
let sisteAnalyseFeil: string | null = null;

async function analyserMedClaude(
  item: any,
  apiKey: string,
): Promise<{ analyse: any | null; httpStatus: number | null; parseFeil: boolean }> {
  try {
    const res = await kallClaude({
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: byggSammendragPrompt(item),
          },
        ],
      }),
    }, "hent-saker");

    if (!res.ok) {
      const kropp = await res.text().catch(() => "");
      sisteAnalyseFeil = `HTTP ${res.status}: ${kropp.slice(0, 200)}`;
      console.error("Claude API:", sisteAnalyseFeil);
      return { analyse: null, httpStatus: res.status, parseFeil: false };
    }
    let data: any;
    try {
      data = await res.json();
    } catch {
      sisteAnalyseFeil = `HTTP ${res.status}: ugyldig JSON`;
      console.error("Claude API:", sisteAnalyseFeil);
      return { analyse: null, httpStatus: res.status, parseFeil: true };
    }
    // Robust mot thinking-blokker (Claude 5): finn tekstblokken eksplisitt.
    const tekst = (data.content?.find((b: any) => b.type === "text")?.text ?? "{}")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    try {
      return { analyse: JSON.parse(tekst), httpStatus: res.status, parseFeil: false };
    } catch {
      sisteAnalyseFeil = `HTTP ${res.status}: ugyldig JSON`;
      console.error("Claude API:", sisteAnalyseFeil);
      return { analyse: null, httpStatus: res.status, parseFeil: true };
    }
  } catch (e) {
    sisteAnalyseFeil = `unntak: ${String(e).slice(0, 200)}`;
    console.error("Claude feil:", sisteAnalyseFeil);
    return { analyse: null, httpStatus: null, parseFeil: false };
  }
}

// ─── Claude-helsesjekk ────────────────────────────────────────────────────────
// Ett mikro-kall ved oppstart så responsen alltid viser OM og HVORFOR
// AI-laget eventuelt er nede — aldri mer stille Claude-svikt.
async function testClaude(apiKey: string | undefined): Promise<string> {
  if (!apiKey) return "mangler ANTHROPIC_API_KEY";
  try {
    const res = await kallClaude({
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8,
        messages: [{ role: "user", content: "Svar kun: ok" }],
      }),
    }, "hent-saker");
    if (res.ok) return "ok";
    const kropp = await res.text().catch(() => "");
    return `HTTP ${res.status}: ${kropp.slice(0, 200)}`;
  } catch (e) {
    return `nettverksfeil: ${String(e).slice(0, 150)}`;
  }
}

// Prod-jobben `hent-saker-daglig` poster { "utlost_av": "pg_cron" }.
// Historikk uten datogrense: { "modus": "backfill" }, bare manuelt.
// Engangs-backfill: { "backfill": "regjeringen-2026-10" }. Cron kan ikke sette noen av dem.
async function lesJobb(req: Request): Promise<{
  kjoertAv: KjoertAv;
  backfill: string | null;
  modus: string | null;
  kilder: string[] | null;
  kildeFeil: string | null;
}> {
  let data: { utlost_av?: unknown; backfill?: unknown; modus?: unknown; kilder?: unknown } = {};
  try {
    const tekst = await req.text();
    if (tekst.trim()) data = JSON.parse(tekst) ?? {};
  } catch {
    data = {};
  }
  const utvalg = lesKildeutvalg(data?.kilder);
  return {
    kjoertAv: utledKjoertAv({
      utlostAv: data?.utlost_av,
      headerUtlostAv: req.headers.get("x-utlost-av"),
      vercelCronHeader: req.headers.get("x-vercel-cron"),
    }),
    backfill: typeof data?.backfill === "string" && data.backfill.trim()
      ? data.backfill.trim()
      : null,
    modus: typeof data?.modus === "string" && data.modus.trim() ? data.modus.trim() : null,
    kilder: utvalg.kilder,
    kildeFeil: utvalg.feil,
  };
}

async function lesSisteVellykkede(
  supabase: { from: (t: string) => any },
  kilder: Map<string, { id: string }>,
): Promise<Map<string, string | null>> {
  const ut = new Map<string, string | null>();
  await Promise.all([...kilder.entries()].map(async ([adapter, meta]) => {
    const { data, error } = await supabase
      .from("kilde_kjoringer")
      .select("kjort")
      .eq("kilde_id", meta.id)
      .eq("jobb", "hent-saker")
      .in("status", [...VELLYKKEDE_KJORING_STATUSER])
      .order("kjort", { ascending: false })
      .limit(1);
    if (error) {
      console.error(`kilde_kjoringer siste suksess ${adapter}:`, error.message);
      ut.set(adapter, null);
      return;
    }
    const kjort = data?.[0]?.kjort;
    ut.set(adapter, typeof kjort === "string" ? kjort : null);
  }));
  return ut;
}

async function fyllTommeHoringsfrister(
  supabase: { from: (t: string) => any },
  frister: ReadonlyMap<string, string> | undefined,
): Promise<number> {
  if (!frister || frister.size === 0) return 0;
  const { data, error } = await supabase
    .from("varsler")
    .select("id, kilde, tittel, instans, sammendrag, frist, manuelt_redigert")
    .is("frist", null)
    .eq("manuelt_redigert", false)
    .ilike("kilde", "%regjeringen.no%");
  if (error) {
    console.error("Kunne ikke lese høringer uten frist");
    return 0;
  }
  const plan = planleggTommeHoringsfrister({ eksisterende: data ?? [], frister });
  let n = 0;
  for (const op of plan) {
    const { error: u } = await supabase
      .from("varsler")
      .update(op.felt)
      .eq("id", op.id)
      .eq("manuelt_redigert", false);
    if (u) console.error("Fristoppdatering feilet");
    else n++;
  }
  return n;
}

async function kjørAdapter(
  navn: string,
  fn: () => Promise<AdapterUtfall>,
): Promise<{ navn: string; utfall: AdapterUtfall; varighetMs: number }> {
  const t = Date.now();
  try {
    const utfall = await fn();
    return { navn, utfall, varighetMs: Date.now() - t };
  } catch (e) {
    console.error(`${navn} krasjet utenfor adapteren:`, e);
    return {
      navn,
      utfall: feilUtfall(feilFraUnntak(e)),
      varighetMs: Date.now() - t,
    };
  }
}

function jsonSvar(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function edgeWaitUntil(): ((p: Promise<unknown>) => void) | null {
  const rt = (globalThis as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
  }).EdgeRuntime;
  return typeof rt?.waitUntil === "function" ? rt.waitUntil.bind(rt) : null;
}

// ON CONFLICT (kilde_nokkel) DO NOTHING. kilde_nokkel er generert og skal
// ikke sendes med. Duplikat i samme kjøring er allerede fjernet før innsetting.
async function lagreHoringOppfolging(
  supabase: { from: (t: string) => any },
  plan: ReturnType<typeof planleggHoringLagring>,
  driftFeil: string[],
): Promise<void> {
  for (const op of plan.varselOppdateringer) {
    const { error } = await supabase
      .from("varsler")
      .update(op.felt)
      .eq("id", op.id)
      .eq("manuelt_redigert", false);
    if (error) {
      console.error("høring varsel:", error.message);
      driftFeil.push(`Høring ${op.id}: ${error.message}`);
    }
  }
  for (const rad of plan.siderader) {
    const { error } = await supabase.from("stortinget_horinger").upsert(rad, { onConflict: "horing_id" });
    if (error) {
      console.error("stortinget_horinger:", error.message);
      driftFeil.push(`Høring ${rad.horing_id}: ${error.message}`);
    }
  }
  for (const a of plan.avlystTilRedaktor) {
    const melding = `Høring ${a.horing_id} er avlyst. Den er ikke avpublisert. Varselredaktøren må se på den.`;
    console.error(melding);
    driftFeil.push(melding);
  }
}

async function lagreVarsel(
  supabase: { from: (t: string) => any },
  rad: Record<string, unknown>,
): Promise<{ error: { message: string } | null; id: string | null }> {
  const { data, error } = await supabase.from("varsler").upsert(rad, {
    onConflict: "kilde_nokkel",
    ignoreDuplicates: true,
  }).select("id").maybeSingle();
  return {
    error: error as { message: string } | null,
    id: typeof data?.id === "string" ? data.id : null,
  };
}

// Klartekst etter innsetting, som på main etter #6. Feil her skal ikke velte
// resten av kjøringen. Over taket blir raden liggende uten generell klartekst
// til backfill-klartekst. Upubliserte koblinger kaller ikke denne.
async function skrivKlartekst(
  supabase: { from: (t: string) => any },
  varselId: string,
  item: any,
  sammendrag: string,
  niva: string,
  sted: string | null,
  apiKey: string,
): Promise<"ok" | "feil"> {
  try {
    const generert = await genererGenerellKlartekst({
      tittel: item.tittel,
      sammendrag,
      instans: item.instans,
      frist: item.frist ?? null,
      niva,
      sted,
    }, apiKey);
    if (!generert) return "feil";
    const cacheFeil = await lagreKlartekstCache(supabase, varselId, generert);
    if (cacheFeil) {
      console.error("klartekst_cache:", cacheFeil);
      return "feil";
    }
    return "ok";
  } catch (e) {
    console.error("Klartekst etter innsetting:", String(e).slice(0, 200));
    return "feil";
  }
}

// ─── Hoved-handler ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Plattformens JWT-kontroll beholdes. Separat cron-hemmelighet gir tilgang til jobben.
  const tidlig = tidligAvslag(
    req.method,
    Deno.env.get("HENT_SAKER_CRON_SECRET"),
    req.headers.get("x-cron-secret"),
  );
  if (tidlig) {
    if (tidlig.status === 503) {
      console.error("Kritisk konfigurasjonsfeil: HENT_SAKER_CRON_SECRET mangler");
    }
    if (tidlig.kind === "tekst") return new Response(tidlig.body, { status: tidlig.status });
    return jsonSvar(tidlig.body, tidlig.status);
  }

  try {
    const jobb = await lesJobb(req);
    if (jobb.kildeFeil) return jsonSvar({ feil: jobb.kildeFeil }, 400);
    const kjoertAv = jobb.kjoertAv;
    const avklart = avklarKjoering({
      kjoertAv,
      modus: jobb.modus,
      backfillKode: jobb.backfill,
      forventetBackfillKode: BACKFILL_KODE,
    });
    if (avklart.avvist) return jsonSvar({ feil: avklart.avvist }, 400);
    const valg = einnsynValg({ kilder: jobb.kilder, v2: einnsynV2Aktiv() });
    if (valg === "hopp over" && jobb.kilder?.length === 1 && jobb.kilder[0] === "einnsyn") {
      return jsonSvar({
        hoppet_over: "einnsyn",
        grunn: "EINNSYN_V2_AKTIV er ikke true",
      });
    }
    const kjoeringstype: Kjoeringstype = avklart.kjoeringstype;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    if (avklart.spesialBackfill) {
      const resultat = await kjorRegjeringenBackfill(supabase);
      console.log("Backfill:", resultat);
      return jsonSvar(resultat, resultat.feil && !resultat.backfill ? 503 : 200);
    }
    const arbeid = async () => {
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

    // Hent eksisterende kilder for deduplicering. Feil her avbryter før innhenting.
    // id og sammendrag trengs av emne-dedup. frist trengs av innholdsnøkkelen.
    const { data: eks, error: eksFeil } = await supabase
      .from("varsler")
      .select("id, kilde, instans, tittel, frist, sammendrag, kilde_publisert, manuelt_redigert");
    if (eksFeil) {
      return jsonSvar({ feil: "Eksisterende saker kunne ikke hentes. Ingen innhenting startet." }, 503);
    }
    const eksKilder = new Set(
      (eks ?? [])
        .map((v: any) => kildeNokkel(v.kilde))
        .filter((n: string | null): n is string => !!n),
    );
    const eksInnhold = new Set(
      (eks ?? [])
        .map((v: any) => innholdDedupNokkel(v))
        .filter((n: string | null): n is string => !!n),
    );

    // Kilderegisteret: kobler kjøringslogg til kilde (ARKITEKTUR §1.4)
    const { data: kilderRows, error: registerFeil } = await supabase
      .from("kilder")
      .select("id, adapter, forventer_treff")
      .eq("aktiv", true);
    if (registerFeil) {
      return jsonSvar({ feil: "Kilderegisteret kunne ikke hentes. Ingen innhenting startet." }, 503);
    }
    const claudeStatus = await testClaude(anthropicKey);
    if (claudeStatus !== "ok") console.error("Claude-helsesjekk:", claudeStatus);
    const kilderMap = new Map<string, { id: string; forventerTreff: boolean }>(
      (kilderRows ?? []).map((r: any) => [
        r.adapter,
        { id: r.id, forventerTreff: r.forventer_treff === true },
      ]),
    );
    const sisteVellykket = kjoeringstype === "backfill"
      ? new Map<string, string | null>()
      : await lesSisteVellykkede(supabase, kilderMap);

    // Hent fra valgte kilder parallelt. Én adapter som kaster, stopper ikke de andre.
    // Morgenkjøring med v2 på hopper over eInnsyn. Nattjobben sender bare einnsyn og kjører v2.
    const alleAdaptere: Array<[string, () => Promise<AdapterUtfall>]> = [
      ["stortinget-saker", () => hentStortingetSaker(eksKilder)],
      ["stortinget-horinger", () => hentStortingetHoringer()],
      ["regjeringen-rss", () => hentRegjeringenRSS()],
      ["stortinget-ventede", () => hentVentedeSaker()],
      ["einnsyn", () => valg === "v2" ? hentEInnsynV2() : hentEInnsynKultursaker()],
      ["bergen", () => hentBergenSaker()],
      ["kulturdirektoratet", () => hentKulturdirektoratetTildelinger()],
      ["sametinget", () => hentSametingetSaker()],
    ];
    const kjøringer = await Promise.all(
      alleAdaptere
        .filter(([navn]) => skalKjoreKilde(navn, jobb.kilder) && !(navn === "einnsyn" && valg === "hopp over"))
        .map(([navn, fn]) => kjørAdapter(navn, fn)),
    );

    const alle = kjøringer.flatMap((k) =>
      k.utfall.items.map((i) => ({
        ...i,
        adapter: k.navn,
        portefolje: erPortefoljesak(i.tittel ?? "", i.sammendrag_raa ?? ""),
      }))
    );

    // Filtrer bort duplikater og ikke-relevante.
    // Saker valgt via komité/emne (forhåndsgodkjent) hopper over nøkkelordfilteret —
    // en sak om åndsverkloven mangler f.eks. ordet «kultur» i tittelen.
    // Regjeringen bruker eget filter: departementsnavnet alene er ikke treff,
    // mens KUD-porteføljen (medier, spill, budsjett, stipend, kulturbygg) er det.
    const kandidater = alle.filter((item) => {
      if (!item.kilde) return false;
      if (item.adapter === "regjeringen-rss") {
        return erRegjeringenRelevant(item.tittel, item.sammendrag_raa ?? "");
      }
      return item.forhåndsgodkjent || erKulturRelevant(item.tittel, item.sammendrag_raa);
    });
    // Samme normaliserte URL to ganger i én kjøring (to sesjoner, eller samme
    // sak to ganger) blir én rad. Det var slik p=200362 og p=200367 ble doblet.
    // URL først, deretter samme instans, tittel og frist. Emne-laget kobler
    // nyhet og tale til høringen når titlene er ulike. Eksisterende rader
    // oppdateres ikke her.
    // Publiseringskilder: eldre enn siste hent-saker-suksess minus 72 timer,
    // og aldri eldre enn 14 dager. RSS uten pubDate hoppes over. Andre
    // kilder og saker uten dato beholdes. Backfill beholder alt.
    const datoFilter = filtrerNyeEtterKildedato(kandidater, {
      modus: kjoeringstype,
      sisteVellykket,
    });
    const datoTall = tellDatofilter(datoFilter);
    if (datoFilter.forGamle.length || datoFilter.stoppetUtenPubDate.length || datoFilter.utenDato.length) {
      console.log(
        `Datofilter (${kjoeringstype}): hoppet over ${datoFilter.forGamle.length} gamle og ${datoFilter.stoppetUtenPubDate.length} RSS uten pubDate, ${datoFilter.utenDato.length} uten dato beholdt`,
        datoTall,
      );
    }
    const etterUrl = dedupEtterKilde(datoFilter.behold, eksKilder);
    const etterInnhold = dedupEtterInnhold(etterUrl, eksInnhold);
    const emnePlan = planleggEmneDedup(etterInnhold, eks ?? []);
    const horingFraEmne = emnePlan.koblinger
      .filter((k) => k.item.adapter === "stortinget-horinger")
      .map((k) => k.item);
    const emneKoblinger = emnePlan.koblinger.filter((k) => k.item.adapter !== "stortinget-horinger");
    const nye = [...emnePlan.behold, ...horingFraEmne];

    console.log(
      `Totalt hentet: ${alle.length}, nye og relevante: ${nye.length}, samme sak: ${emneKoblinger.length}`,
    );

    let antallLagret = 0;
    const lagretPerAdapter = new Map<string, number>();
    const horingUtenFrist = new Map<string, number>();
    const idEtterKilde = new Map<string, string>();
    const driftFeil: string[] = [];
    const varsletManglendeKilde = new Set<string>();
    const merkManglendeKilde = (adapter: string | undefined, kildeId: unknown) => {
      if (kildeId != null || !adapter || varsletManglendeKilde.has(adapter)) return;
      varsletManglendeKilde.add(adapter);
      driftFeil.push(`${adapter}: ingen kilde_id i kilderegisteret`);
    };

    const stortingSakVarsel = new Map<string, string>();
    for (const rad of eks ?? []) {
      const pid = stortingSakIdFraUrl(rad.kilde);
      if (pid && rad.id) stortingSakVarsel.set(pid, rad.id);
    }

    const datoPlan = planleggKildePublisertBackfill(alle, eks ?? []);
    for (const op of datoPlan) {
      const { error: datoFeil } = await supabase
        .from("varsler")
        .update({ kilde_publisert: op.kilde_publisert })
        .eq("id", op.id)
        .eq("manuelt_redigert", false)
        .is("kilde_publisert", null);
      if (datoFeil) console.error("kilde_publisert:", datoFeil.message);
    }

    const regjeringen = kjøringer.find((k) => k.navn === "regjeringen-rss");
    const fyltFrist = await fyllTommeHoringsfrister(
      supabase,
      regjeringen?.utfall.horingsfrister,
    );
    if (fyltFrist > 0) console.log(`Satte manglende høringsfrist på ${fyltFrist} saker`);

    // Kostnads- OG ressurstak: maks antall saker som AI-vurderes per kjøring.
    // Overskytende utsettes til neste kjøring (dedup slår ikke inn — de er ikke
    // lagret). 25 holder kjøringen på ~1 min — trygt under Supabase-workerens
    // regnekvote (80 ga WORKER_RESOURCE_LIMIT/546) og under Claude API-ets
    // rate-grense for nye kontoer (50 kall/min).
    // kallClaude har allerede ett kontrollert nytt forsøk. Ikke legg på et til.
    const MAKS_CLAUDE_SAKER = 25;
    let claudeSaker = 0;
    const claudeUtsatt = new Map<string, number>();
    let claudeHttp: number | null = null;
    let claudeParseFeil = false;
    const helsesjekkFeilet = !!anthropicKey && claudeStatus !== "ok";
    let claudeFeilet = helsesjekkFeilet;
    if (helsesjekkFeilet) {
      const treff = /^HTTP (\d{3})\b/.exec(claudeStatus);
      claudeHttp = treff ? Number(treff[1]) : null;
    }
    let antallAvvist = 0;
    let klartekstForsok = 0;
    let klartekstLagret = 0;
    let klartekstFeilet = 0;
    let klartekstUtsatt = 0;

    for (const item of nye) {
      if (item.adapter === "regjeringen-rss") {
        const [beriket] = await parseOgBerik([item]);
        if (beriket?.frist) item.frist = beriket.frist;
      }
      let kategori = item.portefolje
        ? kategoriFraTittel(item.tittel, item.sammendrag_raa ?? "")
        : "scenekunst";
      let niva = item.niva ?? "nasjonalt";
      let analyseNiva: string | null = null;
      let status = statusForSak(item.frist, item.motedato);
      let sammendrag = item.sammendrag_raa?.slice(0, 400) || item.tittel;

      // Bruk Claude for bedre analyse hvis API-nøkkel er satt
      if (anthropicKey) {
        if (claudeSaker >= MAKS_CLAUDE_SAKER) {
          driftFeil.push(`${item.tittel.slice(0, 60)}: utsatt (kostnadstak per kjøring)`);
          continue;
        }
        claudeSaker++;
        if (claudeFeilet) {
          claudeUtsatt.set(item.adapter, (claudeUtsatt.get(item.adapter) ?? 0) + 1);
          driftFeil.push(`${item.tittel.slice(0, 60)}: Claude-analyse utilgjengelig, utsatt`);
          continue;
        }
        const svar = await analyserMedClaude(item, anthropicKey);
        const analyse = svar.analyse;
        if (!analyse) {
          // Claude utilgjengelig (rate-limit e.l.): IKKE lagre ufiltrert.
          // Saken er ikke i varsler ennå, så dedup stopper den ikke — den
          // blir vurdert på nytt ved neste kjøring i stedet.
          claudeFeilet = true;
          claudeHttp = svar.httpStatus;
          claudeParseFeil = svar.parseFeil;
          claudeUtsatt.set(item.adapter, (claudeUtsatt.get(item.adapter) ?? 0) + 1);
          driftFeil.push(`${item.tittel.slice(0, 60)}: Claude-analyse utilgjengelig, utsatt`);
          continue;
        }
        if (!analyse.relevant && !item.portefolje) {
          // Husk avvisningen: lagres som UPUBLISERT rad (appen viser kun
          // publisert=true), så samme sak aldri koster en ny AI-vurdering —
          // dedup via kilde-URL stopper den ved neste kjøring.
          // Porteføljesaker publiseres i grenen over. Avvisninger lagres
          // upublisert, med kilde_id, så samme sak ikke vurderes på nytt.
          const avvistGeo = item.adapter === "einnsyn"
            ? geografiSomLagres(item, analyse.niva)
            : { niva: analyse.niva ?? "nasjonalt", sted: "Norge" };
          const avvistRad = byggVarselRad(item, {
            publisert: false,
            kategori: kategoriFraAdapter(item.kategori, analyse.kategori ?? "kulturpolitikk"),
            niva: avvistGeo.niva,
            status: "normal",
            sammendrag: "Automatisk avvist av relevansfilteret",
            sted: avvistGeo.sted,
          }, kilderMap);
          if (!avvistRad) {
            driftFeil.push(`${item.tittel.slice(0, 60)}: mangler kilde-URL`);
            continue;
          }
          merkManglendeKilde(item.adapter, avvistRad.kilde_id);
          if (item.adapter === "stortinget-horinger") {
            avvistRad.sakstype = "horing";
            if (item.handling === "handling_mulig" || item.handling === "bare_orientering") {
              avvistRad.handling = item.handling;
            }
          }
          const avvist = await lagreVarsel(supabase, avvistRad);
          if (!avvist.error) {
            antallAvvist++;
            const nokkel = kildeNokkel(item.kilde);
            if (nokkel) {
              eksKilder.add(nokkel);
              if (item.adapter === "stortinget-horinger" && avvist.id) {
                idEtterKilde.set(nokkel, avvist.id);
              }
            }
            const innhold = innholdDedupNokkel(item);
            if (innhold) eksInnhold.add(innhold);
          }
          continue;
        }
        if (analyse.relevant) {
          kategori = analyse.kategori ?? kategori;
          analyseNiva = analyse.niva ?? null;
          // Adaptere som VET nivået sitt (f.eks. Bergen = kommune) overstyres ikke
          if (!item.niva) niva = analyse.niva ?? niva;
          sammendrag = analyse.sammendrag || sammendrag;
        } else if (analyse.kategori) {
          kategori = analyse.kategori;
        }
        // Status gjettes ikke. Uten frist og uten møtedato forblir den normal.
        status = statusForSak(item.frist, item.motedato);
      }

      // Claude har ingen tilskudds-/budsjettkategori og lander lokale
      // økonomisaker på kulturarv eller visuell. Tittelen avgjør.
      let sted: string | null = item.sted ?? null;
      if (item.adapter === "einnsyn") {
        kategori = kategoriForEinnsyn(item.tittel, kategori);
        const geo = geografiSomLagres(item, analyseNiva ?? niva);
        niva = geo.niva;
        sted = geo.sted;
      }
      // Ordningskoden setter kategorien. Modellen får ikke overstyre den.
      kategori = kategoriFraAdapter(item.kategori, kategori);

      if (item.adapter === "stortinget-horinger" && typeof item.sammendrag_raa === "string") {
        sammendrag = item.sammendrag_raa.slice(0, 2000);
      }

      // Tall og årstall som ikke står i kilden logges. Raden lagres likevel,
      // men upublisert, så en redaktør ser den før den blir synlig.
      // Eksisterende rader, også manuelt_redigert, skrives ikke om (ignoreDuplicates).
      const tallavvik = loggUdokumenterteTall(
        "hent-saker",
        sammendrag,
        kildegrunnlag([item.tittel, item.sammendrag_raa, item.instans, item.frist]),
        typeof item.kilde === "string" ? item.kilde : "",
      );
      const publisert = publiseresEtterKontroll(tallavvik);

      item.sakstype = item.sakstype ?? sakstypeFraSak(item);
      const rad = byggVarselRad(item, {
        publisert,
        kategori,
        niva,
        status,
        sammendrag,
        sted: sted ?? (niva === "nasjonalt" ? "Nasjonalt" : "Norge"),
      }, kilderMap);
      if (!rad) {
        driftFeil.push(`${item.tittel.slice(0, 60)}: mangler kilde-URL`);
        continue;
      }
      if (item.adapter === "stortinget-horinger") {
        rad.sakstype = "horing";
        if (item.handling === "handling_mulig" || item.handling === "bare_orientering") {
          rad.handling = item.handling;
        }
        const hoved = hovedsakForHoring(item.sakIder, stortingSakVarsel);
        if (hoved) rad.hovedsak_id = hoved;
      }
      merkManglendeKilde(item.adapter, rad.kilde_id);
      const lagret = await lagreVarsel(supabase, rad);

      if (lagret.error) {
        driftFeil.push(`${item.tittel}: ${lagret.error.message}`);
      } else {
        antallLagret++;
        lagretPerAdapter.set(
          item.adapter,
          (lagretPerAdapter.get(item.adapter) ?? 0) + 1,
        );
        const nokkel = kildeNokkel(item.kilde);
        if (nokkel) {
          eksKilder.add(nokkel);
          if (lagret.id) {
            idEtterKilde.set(nokkel, lagret.id);
            const pid = stortingSakIdFraUrl(item.kilde);
            if (pid && item.adapter === "stortinget-saker") stortingSakVarsel.set(pid, lagret.id);
          }
        }
        const innhold = innholdDedupNokkel(item);
        if (innhold) eksInnhold.add(innhold);
        if (
          item.adapter === "regjeringen-rss" &&
          erRegjeringenHoring(item) &&
          !item.frist
        ) {
          horingUtenFrist.set(item.adapter, (horingUtenFrist.get(item.adapter) ?? 0) + 1);
        }
        // Klartekst fra #6, bare på publisert innsetting. Upubliserte rader
        // og koblinger bruker ikke Sonnet-kvoten.
        if (publisert && anthropicKey && lagret.id) {
          if (klartekstForsok >= MAKS_KLARTEKST_PER_KJORING) {
            klartekstUtsatt++;
          } else {
            klartekstForsok++;
            const utfall = await skrivKlartekst(
              supabase,
              lagret.id,
              item,
              sammendrag,
              niva,
              (rad.sted as string | null) ?? null,
              anthropicKey,
            );
            if (utfall === "ok") klartekstLagret++;
            else {
              klartekstFeilet++;
              driftFeil.push(`${item.tittel.slice(0, 60)}: klartekst utilgjengelig`);
            }
          }
        }
      }
    }

    for (const kobling of emneKoblinger) {
      const item = kobling.item;
      const hovedNokkel = kildeNokkel(kobling.hovedKilde);
      const hovedsakId = kobling.hovedsakId ?? (hovedNokkel ? idEtterKilde.get(hovedNokkel) ?? null : null);
      item.sakstype = item.sakstype ?? sakstypeFraSak(item);
      const rad = byggVarselRad(item, {
        publisert: false,
        kategori: kategoriFraAdapter(
          item.kategori,
          kategoriFraTittel(item.tittel, item.sammendrag_raa ?? ""),
        ),
        niva: item.niva ?? "nasjonalt",
        status: statusForSak(item.frist, item.motedato),
        sammendrag: "Samme sak som en allerede registrert høring eller pressemelding.",
        sted: item.sted ?? "Nasjonalt",
      }, kilderMap);
      if (!rad) {
        driftFeil.push(`${item.tittel.slice(0, 60)}: mangler kilde-URL`);
        continue;
      }
      rad.hovedsak_id = hovedsakId;
      rad.sakstype = item.sakstype;
      merkManglendeKilde(item.adapter, rad.kilde_id);
      const koblet = await lagreVarsel(supabase, rad);
      if (koblet.error) driftFeil.push(`${item.tittel}: ${koblet.error.message}`);
      else {
        const nokkel = kildeNokkel(item.kilde);
        if (nokkel) eksKilder.add(nokkel);
        const innhold = innholdDedupNokkel(item);
        if (innhold) eksInnhold.add(innhold);
      }
    }

    const horingUtfall = kjøringer.find((k) => k.navn === "stortinget-horinger")?.utfall;
    const sakEtterNytt = new Map(stortingSakVarsel);
    for (const [nokkel, id] of idEtterKilde) {
      const pid = stortingSakIdFraUrl(nokkel);
      if (pid && !sakEtterNytt.has(pid)) sakEtterNytt.set(pid, id);
    }
    const horingPlan = planleggHoringLagring({
      items: alle.filter((i) => i.adapter === "stortinget-horinger"),
      avlyste: horingUtfall?.avlysteHoringer,
      eksisterende: eks ?? [],
      nyeIder: [...idEtterKilde.entries()].map(([kilde, id]) => ({ kilde, id })),
      saker: [...sakEtterNytt.entries()].map(([stortingSakId, varselId]) => ({ stortingSakId, varselId })),
    });
    await lagreHoringOppfolging(supabase, horingPlan, driftFeil);

    // Kjøringslogg per kilde. antall_funnet = råtreff før filter/dedup.
    // «tom» bare når en kilde som kan være tom svarte OK med 0 råtreff.
    // Kilder med forventer_treff får feil_tomt_svar i stedet. http_status
    // lagres også når kallet gikk bra. feilmelding er saniteret.
    const kildeStatus = [];
    const kildeFeil: string[] = [];
    for (const k of kjøringer) {
      const antallNye = lagretPerAdapter.get(k.navn) ?? 0;
      const meta = kilderMap.get(k.navn);
      const klass = medClaudeFeil(klassifiserKjøring({
        raattAntall: k.utfall.raattAntall,
        antallNye,
        feil: k.utfall.feil,
        forsok: k.utfall.forsok,
        vellykket: k.utfall.vellykket,
        httpStatus: k.utfall.httpStatus,
        forventerTreff: meta?.forventerTreff ?? false,
        manglendeFrist: horingUtenFrist.get(k.navn) ?? 0,
      }), {
        feilet: claudeFeilet,
        httpStatus: claudeHttp,
        utsatte: claudeUtsatt.get(k.navn) ?? 0,
        parseFeil: claudeParseFeil,
      });
      kildeStatus.push({
        adapter: k.navn,
        status: klass.status,
        raatt_antall: k.utfall.raattAntall,
        antall_etter_filter: k.utfall.antallEtterFilter,
        antall_nye: antallNye,
        http_status: klass.httpStatus,
        feilmelding: klass.feilmelding,
        varighet_ms: k.varighetMs,
      });
      if (
        (klass.status.startsWith("feil_") || klass.status === "delvis") &&
        klass.feilmelding
      ) {
        kildeFeil.push(`${k.navn}: ${klass.feilmelding}`);
      }
      const kildeId = meta?.id;
      if (!kildeId) {
        console.error(`Ingen rad i kilder for adapter ${k.navn} — kjøring logges ikke`);
        continue;
      }
      const { error: loggFeil } = await supabase.from("kilde_kjoringer").insert(
        byggKildeKjoringRad({
          kildeId,
          status: klass.status,
          antallFunnet: k.utfall.raattAntall,
          antallEtterFilter: k.utfall.antallEtterFilter,
          antallNye,
          feilmelding: klass.feilmelding,
          httpStatus: klass.httpStatus,
          varighetMs: k.varighetMs,
          kjoertAv,
          kjoeringstype,
          jobb: "hent-saker",
        }),
      );
      if (loggFeil) console.error(`kilde_kjoringer ${k.navn}:`, loggFeil.message);
      await supabase
        .from("kilder")
        .update({ sist_hentet: new Date().toISOString(), sist_status: klass.status })
        .eq("id", kildeId);
    }

    const feil = [...kildeFeil, ...driftFeil];
    const respons = {
      kjørt: new Date().toISOString(),
      kjoert_av: kjoertAv,
      kjoeringstype,
      hoppet_over_gamle: datoFilter.forGamle.length,
      hoppet_over_uten_pubdate: datoFilter.stoppetUtenPubDate.length,
      uten_dato: datoFilter.utenDato.length,
      datofilter: datoTall,
      claude_status: claudeStatus,
      siste_analyse_feil: sisteAnalyseFeil ?? undefined,
      hentet_totalt: alle.length,
      nye_og_relevante: nye.length,
      lagret: antallLagret,
      avvist_av_filter: antallAvvist,
      klartekst_lagret: klartekstLagret,
      klartekst_feilet: klartekstFeilet || undefined,
      klartekst_utsatt: klartekstUtsatt || undefined,
      feil: feil.length > 0 ? feil.slice(0, 10) : undefined,
      kilde_status: kildeStatus,
    };

    console.log("Ferdig:", respons);
    return jsonSvar(respons);
    };
    const vent = edgeWaitUntil();
    if (valg === "v2" && vent) {
      vent(arbeid().catch((e) => {
        console.error("Kritisk feil i bakgrunn:", e);
      }));
      return jsonSvar({
        startet: true,
        bakgrunn: true,
        kilder: jobb.kilder,
        kjoert_av: kjoertAv,
        kjørt: new Date().toISOString(),
      });
    }
    return await arbeid();
  } catch (e) {
    console.error("Kritisk feil:", e);
    return jsonSvar({ feil: String(e) }, 500);
  }
});
