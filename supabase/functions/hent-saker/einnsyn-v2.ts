// eInnsyn v2. Kjører bare når EINNSYN_V2_AKTIV er nøyaktig "true".
//
// Digdir (servicedesk) 26.10.2026: det åpne søket på api.einnsyn.no krever
// ingen nøkkel. robots.txt gjelder søkemotorer. Vi omgår ikke 403, og vi
// følger ikke next til andre vertsnavn. Kjøringen er nattlig, i åtte bolker
// fra 01:00 UTC, atskilt fra hent-saker-daglig.
//
// Kallbudsjett mot api.einnsyn.no, målt 26.10.2026 etter organfilteret
// (43 enheter: 16 kommuner, 5 fylkeskommuner, 15 bydeler,
// Gamle Oslo bydelsutvalg, tre Stavanger bystyre, to kunstutvalg
// og Bystyrets sekretariat):
//   oppdagelse      5    /enhet?query=… (kommune har to sider)
//   søk           430    10 søkeord × 43 enheter, én side, siste 30 dager
//   geo            43    ett /enhet/{id} per treff-enhet, øvre anslag
//   sum           478    Brreg kommer i tillegg, inntil to kall per enhet
//
// Gratisplanen har veggklokke på 150 s, også for EdgeRuntime.waitUntil.
// Målt 26.10 fra Oslo: søk 0,73–1,46 s (serveren alene ~0,7 s),
// /enhet?query 1,05 s, /enhet/{id} 0,58 s. Estimatet bruker 1,0 s per søk
// pluss 400 ms pause, ikke 150 ms.
// Åtte bolker, høyst 5 enheter hver, én side per søk. Verste bolk er
// 5 + 50 + 5 = 60 eInnsyn-kall og om lag 82 s. Tre enheter venter til
// neste natt. Rotasjonen flytter dem, så de samme ikke alltid er sist.
// Søket stopper 85 s etter at forespørselen startet, lagrer det som er
// hentet, og skriver delvis. Claude (3 analyser, 1 klartekst) kjører etterpå
// og skal være inne før 150 s. Kall over taket lagres ikke. Dedup gjør
// samme bolk samme natt idempotent. En bolk som feiler, stopper ikke de andre.
// Absolutt tak: 600 kall mot api.einnsyn.no per kjøring. Hele natten er
// om lag 480 kall.
// 429 og 5xx: inntil 3 forsøk, eksponentiell backoff med jitter,
// Retry-After respekteres opp til 15 s. Lengre ventetid avbryter.

import {
  EINNSYN_USER_AGENT,
  EinnsynStopp,
  mapEInnsynItem,
  slåOppGeo,
  type EInnsynMoetesak,
} from "./einnsyn.ts";
import { byggKildeKjoringRad, type Kjoeringstype } from "./datofilter.ts";
import {
  feilFraStatus,
  feilFraUnntak,
  feilUtfall,
  lesTekstRespons,
  uventetFormat,
  type AdapterUtfall,
  type HenteFeil,
} from "./kildehelse.ts";
import { erKulturRelevant, erRenIdrett } from "./logikk.ts";

const API = "https://api.einnsyn.no";
/** Publisert kontrakt. Dokumentasjon og CI på main endrer ikke denne filen. */
export const EINNSYN_SPEC_FIL = "openapi/einnsyn.openapi.yml";
const SPEC_COMMITS =
  "https://api.github.com/repos/felleslosninger/einnsyn-api-spec/commits?path="
  + encodeURIComponent(EINNSYN_SPEC_FIL)
  + "&sha=main&per_page=1";

/**
 * Siste commit som endret openapi/einnsyn.openapi.yml, lest 26.10.2026.
 * Ikke HEAD på main (den var en CI-endring, 10f2b418…).
 */
export const EINNSYN_SPEC_KJENT_SHA = "cedf5edc8cb5ae27cff4b8e03c989af7928bd531";

export const EINNSYN_V2_SOKEORD = [
  "kultur",
  "idrett",
  "bibliotek",
  "museum",
  "kulturhus",
  "festival",
  "frivillig",
  "kunst",
  "musikk",
  "tilskudd",
] as const;

export const EINNSYN_V2_OPPDAGELSE = ["kommune", "fylkeskommune", "bydel", "bystyre"] as const;
export const EINNSYN_V2_LIMIT = 50;
export const EINNSYN_V2_MAKS_SIDER = 3;
export const EINNSYN_V2_PAUSE_MS = 400;
/** Inkluderer første forsøk. Bare 429 og 5xx prøves på nytt. */
export const EINNSYN_V2_MAKS_FORSOK = 3;
export const EINNSYN_V2_BACKOFF_BASIS_MS = 500;
export const EINNSYN_V2_BACKOFF_TAK_MS = 8_000;
/** Retry-After over dette avbryter kjøringen i stedet for å sove. */
export const EINNSYN_V2_RETRY_AFTER_MAKS_MS = 15_000;
/** Hardt tak per kjøring mot api.einnsyn.no. Forventet bolk er 60, hel natt med bolker om lag 480. */
export const EINNSYN_V2_MAKS_KALL = 600;
export const EINNSYN_V2_FORVENTET_ENHETER = 43;
/** Åtte cron-kall fra 01:00 UTC, ti minutter mellom. */
export const EINNSYN_V2_BOLKER = 8;
/** 6 enheter blir over 90 s med målt svartid. 5 holder estimatet på om lag 82 s. */
export const EINNSYN_V2_BOLK_MAKS_ENHETER = 5;
/** Bolker følger ikke neste søkeside. Oppdagelse kan fortsatt ha flere sider. */
export const EINNSYN_V2_BOLK_MAKS_SIDER = 1;
/** Stopp nye søk så Claude får plass innenfor veggklokken på 150 s. */
export const EINNSYN_V2_BOLK_TIDSGRENSE_MS = 85_000;
/** Ikke start flere geo-kall etter dette, så analysen rekker å bli ferdig. */
export const EINNSYN_V2_GEO_TIDSGRENSE_MS = 110_000;
/** Målt 26.10. Brukes i estimatet, ikke 150 ms. */
export const EINNSYN_V2_SOK_SVAR_MS = 1_000;
export const EINNSYN_V2_OPPDAGELSE_SVAR_MS = 1_050;
export const EINNSYN_V2_GEO_SVAR_MS = 580;
/** Så Claude-analysen etter 85 s fortsatt er ferdig før 150 s. */
export const EINNSYN_V2_BOLK_MAKS_CLAUDE = 3;
export const EINNSYN_V2_BOLK_MAKS_KLARTEKST = 1;

export const HENT_SAKER_KILDER = [
  "stortinget-saker",
  "stortinget-horinger",
  "regjeringen-rss",
  "stortinget-ventede",
  "einnsyn",
  "bergen",
  "kulturdirektoratet",
  "sametinget",
] as const;

const KOMMUNER = [
  "oslo", "stavanger", "fredrikstad", "bodo", "arendal", "grimstad",
  "vennesla", "malvik", "risor", "tvedestrand", "froland", "hvaler",
  "gjerstad", "vegarshei", "amli", "rodoy",
];
const FYLKER = ["akershus", "buskerud", "vestland", "ostfold", "agder"];

export function einnsynV2Aktiv(
  les?: (navn: string) => string | undefined,
): boolean {
  const get = les ?? ((navn: string) => {
    const deno = (globalThis as {
      Deno?: { env?: { get?: (n: string) => string | undefined } };
    }).Deno;
    return deno?.env?.get?.(navn);
  });
  return get("EINNSYN_V2_AKTIV") === "true";
}

/**
 * Planestimat mot api.einnsyn.no. 5 + 430 + 0 + 43 = 478 ved 43 enheter.
 * Brreg er inntil to kall per enhet og inngår ikke i totalt eller i taket.
 */
export function forventetEinnsynV2Kall(antallEnheter = EINNSYN_V2_FORVENTET_ENHETER): {
  oppdagelse: number;
  sok: number;
  kulturUtvalg: number;
  geo: number;
  brreg: number;
  totalt: number;
} {
  const oppdagelse = 5;
  const sok = EINNSYN_V2_SOKEORD.length * antallEnheter;
  const kulturUtvalg = 0;
  const geo = antallEnheter;
  const brreg = antallEnheter * 2;
  return { oppdagelse, sok, kulturUtvalg, geo, brreg, totalt: oppdagelse + sok + kulturUtvalg + geo };
}

/** Hvor mange enheter som ikke får plass en natt, og derfor roteres inn neste natt. */
export function roteringssteg(
  antallOrgan: number,
  bolker = EINNSYN_V2_BOLKER,
  maks = EINNSYN_V2_BOLK_MAKS_ENHETER,
): number {
  const over = antallOrgan - bolker * maks;
  return over > 0 ? over : 1;
}

/** Døgnnummer i Europe/Oslo, ganger steget, så de utsatte enhetene kommer først neste natt. */
export function einnsynRotering(nå: number, antallOrgan: number): number {
  const dato = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nå));
  const [år, måned, dag] = dato.split("-").map(Number);
  const døgn = Math.floor(Date.UTC(år, måned - 1, dag) / 86_400_000);
  return døgn * roteringssteg(antallOrgan);
}

function kallTidMs(antall: number, svarMs: number): number {
  return antall * (svarMs + EINNSYN_V2_PAUSE_MS);
}

/**
 * Verste bolk ved målt svartid. Oppdagelse gjentas. Søk er én side.
 * 5 enheter: 5×1,45 s + 50×1,4 s + 5×0,98 s = 82,15 s, under 90 s.
 */
export function forventetEinnsynV2BolkKall(antallEnheter = EINNSYN_V2_FORVENTET_ENHETER): {
  bolker: number;
  enheter: number;
  oppdagelse: number;
  sok: number;
  geo: number;
  brreg: number;
  einnsyn: number;
  varighetMs: number;
  dekket: number;
  utsatt: number;
  nattKall: number;
  claude: number;
  klartekst: number;
} {
  const enheter = Math.min(
    EINNSYN_V2_BOLK_MAKS_ENHETER,
    Math.ceil(antallEnheter / EINNSYN_V2_BOLKER),
  );
  const oppdagelse = 5;
  const sok = EINNSYN_V2_SOKEORD.length * enheter;
  const geo = enheter;
  const dekket = Math.min(antallEnheter, EINNSYN_V2_BOLKER * EINNSYN_V2_BOLK_MAKS_ENHETER);
  const nattKall = oppdagelse * EINNSYN_V2_BOLKER
    + EINNSYN_V2_SOKEORD.length * dekket
    + dekket;
  return {
    bolker: EINNSYN_V2_BOLKER,
    enheter,
    oppdagelse,
    sok,
    geo,
    brreg: enheter * 2,
    einnsyn: oppdagelse + sok + geo,
    varighetMs: kallTidMs(oppdagelse, EINNSYN_V2_OPPDAGELSE_SVAR_MS)
      + kallTidMs(sok, EINNSYN_V2_SOK_SVAR_MS)
      + kallTidMs(geo, EINNSYN_V2_GEO_SVAR_MS),
    dekket,
    utsatt: Math.max(0, antallEnheter - dekket),
    nattKall,
    claude: EINNSYN_V2_BOLK_MAKS_CLAUDE,
    klartekst: EINNSYN_V2_BOLK_MAKS_KLARTEKST,
  };
}

/**
 * Åtte bolker, høyst fem enheter. Listen roteres før den deles, så de
 * som falt utenfor eller ble sist, ikke er de samme neste natt.
 * Samme rotering og samme liste gir samme bolk.
 */
export function organerIBolk<T extends { id: string }>(
  organ: readonly T[],
  bolk: number,
  opts?: { antall?: number; rotering?: number; maksPerBolk?: number },
): T[] {
  const antall = opts?.antall ?? EINNSYN_V2_BOLKER;
  const maks = opts?.maksPerBolk ?? EINNSYN_V2_BOLK_MAKS_ENHETER;
  const sortert = [...organ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = sortert.length;
  const rot = n === 0 ? 0 : (((opts?.rotering ?? 0) % n) + n) % n;
  const rotert = sortert.slice(rot).concat(sortert.slice(0, rot));
  const vindu = rotert.slice(0, antall * maks);
  return vindu.filter((_, i) => i % antall === bolk - 1);
}

export function lesBolk(verdi: unknown): { bolk: number | null; feil: string | null } {
  if (verdi == null) return { bolk: null, feil: null };
  if (typeof verdi !== "number" || !Number.isInteger(verdi) || verdi < 1 || verdi > EINNSYN_V2_BOLKER) {
    return { bolk: null, feil: "Ukjent bolk" };
  }
  return { bolk: verdi, feil: null };
}

export function tidsgrenseFeil(ferdig: number, planlagt: number): HenteFeil {
  return {
    type: "timeout",
    httpStatus: null,
    melding: `Tidsgrense: ${ferdig} av ${planlagt} enheter`,
    url: null,
  };
}

/**
 * Rad i funksjonsflagg vinner. Mangler raden, eller lesingen feiler,
 * brukes hemmeligheten EINNSYN_V2_AKTIV.
 */
export function einnsynV2ErPa(fraDb: boolean | null, hemmelighet: boolean): boolean {
  return fraDb == null ? hemmelighet : fraDb;
}

export async function lesEinnsynV2FraDb(
  supabase: { from: (tabell: string) => any },
): Promise<boolean | null> {
  try {
    const { data, error } = await supabase
      .from("funksjonsflagg")
      .select("aktiv")
      .eq("nokkel", "einnsyn_v2")
      .maybeSingle();
    if (error) {
      console.error("funksjonsflagg einnsyn_v2:", error.message);
      return null;
    }
    if (!data) return null;
    return data.aktiv === true;
  } catch (e) {
    console.error("funksjonsflagg einnsyn_v2:", String(e).slice(0, 200));
    return null;
  }
}

/** Rad når workeren dør før den vanlige kilde_kjoringer-raden er skrevet. */
export function avbruddsKjoringRad(input: {
  kildeId: string;
  bolk: number | null;
  varighetMs: number;
  kjoertAv: string;
  kjoeringstype: Kjoeringstype;
}): Record<string, unknown> {
  const ekstra = input.bolk == null ? "" : ` Bolk ${input.bolk}.`;
  return byggKildeKjoringRad({
    kildeId: input.kildeId,
    status: "feil_timeout",
    antallFunnet: 0,
    antallEtterFilter: 0,
    antallNye: 0,
    feilmelding: `Kjøringen ble avbrutt før den var ferdig.${ekstra}`,
    httpStatus: null,
    varighetMs: Math.max(0, input.varighetMs),
    kjoertAv: input.kjoertAv,
    kjoeringstype: input.kjoeringstype,
    jobb: "hent-saker",
  });
}

export function lesKildeutvalg(verdi: unknown): { kilder: string[] | null; feil: string | null } {
  if (verdi == null) return { kilder: null, feil: null };
  if (!Array.isArray(verdi) || verdi.length === 0) return { kilder: null, feil: "Ukjent kilde" };
  const kilder: string[] = [];
  for (const rad of verdi) {
    if (typeof rad !== "string" || !HENT_SAKER_KILDER.includes(rad as (typeof HENT_SAKER_KILDER)[number])) {
      return { kilder: null, feil: "Ukjent kilde" };
    }
    kilder.push(rad);
  }
  return { kilder, feil: null };
}

/**
 * Full kjøring med flagget på hopper over eInnsyn. Den nattlige jobben
 * sender bare einnsyn og kjører v2. Med flagget av gjør nattjobben ingenting,
 * og den vanlige kjøringen fortsetter med v1.
 */
export function einnsynValg(opts: { kilder: readonly string[] | null; v2: boolean }): "v1" | "v2" | "hopp over" {
  const nevnt = opts.kilder == null || opts.kilder.includes("einnsyn");
  if (!nevnt) return "hopp over";
  const bareEinnsyn = !!opts.kilder && opts.kilder.length === 1 && opts.kilder[0] === "einnsyn";
  if (opts.v2) return opts.kilder == null ? "hopp over" : "v2";
  if (bareEinnsyn) return "hopp over";
  return "v1";
}

export function skalKjoreKilde(navn: string, kilder: readonly string[] | null): boolean {
  return kilder == null || kilder.includes(navn);
}

export function foldEinnsynNavn(navn: string): string {
  return navn.toLowerCase().replace(/å/g, "a").replace(/ø/g, "o").replace(/æ/g, "ae");
}

function somOrd(hay: string, needle: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${needle}(?:[^a-z0-9]|$)`).test(hay);
}

/**
 * 16 kommuner og 5 fylker som publiserer møter, pluss Oslos bydeler,
 * bystyre og byrådsavdeling. Historiske journalenheter og nemnder som
 * ikke publiserer møter, er ute. Viken og statlige organ er ute.
 */
export function erEinnsynV2Organ(navn: string | null | undefined): boolean {
  if (!navn?.trim()) return false;
  const f = foldEinnsynNavn(navn);
  if (somOrd(f, "viken")) return false;
  if (/departement|direktorat|universitet|sykehus/.test(f)) return false;
  if (/\bfor \d{4}\b/.test(f) || /\(\s*\d{4}/.test(f) || /\b\d{4}\s*-\s*\d{4}\b/.test(f)) return false;
  if (/klagenemnd|karanteneutvalg|arbeidsmiljoutvalg|arbeidsgruppe|eiendom fkf/.test(f)) return false;
  if (/^bydel\b/.test(f.trim())) return true;
  if (/bystyrets sekretariat/.test(f)) return true;
  const kommune = KOMMUNER.some((k) => somOrd(f, k));
  const fylke = FYLKER.some((k) => somOrd(f, k));
  if (kommune && /kommune|bystyre|byrad|bydel/.test(f)) return true;
  if (fylke && /fylkeskommune|fylkesting|fylkesrad/.test(f)) return true;
  if ((kommune || fylke) && /\bkultur\b/.test(f)) return true;
  return false;
}

export function erKulturutvalg(navn: string | null | undefined): boolean {
  return !!navn && /\bkultur\b/i.test(navn) && erEinnsynV2Organ(navn);
}

/** Idrett alene er ikke forhåndsgodkjent. Kultur i organ-navnet er det. */
export function v2ForhandsGodkjent(tittel: string, organ: string): boolean {
  if (erRenIdrett(tittel, organ)) return false;
  if (erKulturRelevant(tittel)) return true;
  return /\bkultur\b/i.test(organ);
}

export function moetedatoFra(nå = Date.now(), dager = 30): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nå - dager * 86400000));
}

/** Bare https://api.einnsyn.no/search og /enhet, og limit høyst 100. */
export function tryggEinnsynUrl(raw: string, basis = API): string | null {
  let url: URL;
  try {
    url = new URL(raw, basis);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "api.einnsyn.no") return null;
  if (url.pathname !== "/search" && url.pathname !== "/enhet" && !url.pathname.startsWith("/enhet/")) {
    return null;
  }
  const limit = url.searchParams.get("limit");
  if (limit != null && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100)) return null;
  return url.toString();
}

export function einnsynSokUrl(opts: {
  enhetId: string;
  fra: string;
  ord?: string;
  limit?: number;
}): string {
  const limit = Math.min(Math.max(1, opts.limit ?? EINNSYN_V2_LIMIT), 100);
  const q = new URLSearchParams();
  if (opts.ord) q.set("query", opts.ord);
  q.set("entity", "Moetesak");
  q.set("administrativEnhet", opts.enhetId);
  q.set("moetedatoFrom", opts.fra);
  q.set("sortBy", "publisertDato");
  q.set("sortOrder", "desc");
  q.set("limit", String(limit));
  return `${API}/search?${q.toString()}`;
}

export type EinnsynListe =
  | { ok: true; items: unknown[]; next: string | null }
  | { ok: false; detalj: string };

/** Feltene vi leser. Tom liste er gyldig. Treff uten de feltene er ikke 0 treff. */
export function validerEinnsynListe(data: unknown, slag: "sok" | "enhet"): EinnsynListe {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, detalj: "mangler objekt" };
  const rot = data as { items?: unknown; next?: unknown };
  if (!Array.isArray(rot.items)) return { ok: false, detalj: "mangler items" };
  const next = typeof rot.next === "string" && rot.next ? rot.next : null;
  if (rot.items.length === 0) return { ok: true, items: rot.items, next };
  const gyldig = rot.items.some((item) => {
    if (!item || typeof item !== "object") return false;
    const rad = item as { id?: unknown; navn?: unknown; offentligTittel?: unknown };
    if (typeof rad.id !== "string" || !rad.id) return false;
    if (slag === "enhet") return typeof rad.navn === "string" && !!rad.navn;
    return typeof rad.offentligTittel === "string" && !!rad.offentligTittel;
  });
  if (!gyldig) {
    return {
      ok: false,
      detalj: slag === "enhet" ? "enhet mangler id og navn" : "moetesak mangler id og offentligTittel",
    };
  }
  return { ok: true, items: rot.items, next };
}

/**
 * Ventetid før nytt forsøk. Retry-After (sekunder eller HTTP-dato) vinner.
 * Over 15 sekunder avbrytes kjøringen. Uten header: eksponentiell backoff
 * med jitter mellom 50 og 100 prosent.
 */
export function ventetidMs(opts: {
  forsok: number;
  retryAfter: string | null;
  nå?: number;
  tilfeldig?: () => number;
}): number | "avbryt" {
  const header = opts.retryAfter?.trim() ?? "";
  if (header) {
    let ms: number | null = null;
    if (/^\d+(\.\d+)?$/.test(header)) ms = Number(header) * 1000;
    else {
      const dato = Date.parse(header);
      if (!Number.isNaN(dato)) ms = dato - (opts.nå ?? Date.now());
    }
    if (ms != null && Number.isFinite(ms)) {
      if (ms > EINNSYN_V2_RETRY_AFTER_MAKS_MS) return "avbryt";
      return Math.max(0, Math.round(ms));
    }
  }
  const exp = Math.min(
    EINNSYN_V2_BACKOFF_TAK_MS,
    EINNSYN_V2_BACKOFF_BASIS_MS * 2 ** Math.max(0, opts.forsok - 1),
  );
  const rnd = opts.tilfeldig ?? Math.random;
  return Math.round(exp * (0.5 + rnd() * 0.5));
}

export function specShaAvviker(sha: unknown, kjent = EINNSYN_SPEC_KJENT_SHA): boolean {
  return typeof sha === "string" && sha.length > 0 && sha !== kjent;
}

type Hent = typeof fetch;

type Ctx = {
  kall: number;
  hent: Hent;
  vent: (ms: number) => Promise<void>;
  pauseMs: number;
  tilfeldig: () => number;
  nå: () => number;
};

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function erListeSti(pathname: string): boolean {
  return pathname === "/search" || pathname === "/enhet";
}

async function kallEinnsyn(url: string, ctx: Ctx, medPause: boolean): Promise<Response> {
  if (ctx.kall >= EINNSYN_V2_MAKS_KALL) {
    throw new EinnsynStopp(uventetFormat(url, "kallgrense"));
  }
  if (medPause && ctx.kall > 0 && ctx.pauseMs > 0) await ctx.vent(ctx.pauseMs);
  ctx.kall++;
  let sist: Response | null = null;
  let retryAfter: string | null = null;
  for (let forsok = 1; forsok <= EINNSYN_V2_MAKS_FORSOK; forsok++) {
    if (forsok > 1) {
      const vente = ventetidMs({
        forsok: forsok - 1,
        retryAfter,
        nå: ctx.nå(),
        tilfeldig: ctx.tilfeldig,
      });
      if (vente === "avbryt") throw new EinnsynStopp(feilFraStatus(sist?.status ?? 429, url));
      if (vente > 0) await ctx.vent(vente);
      if (ctx.kall >= EINNSYN_V2_MAKS_KALL) throw new EinnsynStopp(uventetFormat(url, "kallgrense"));
      ctx.kall++;
    }
    let res: Response;
    try {
      res = await ctx.hent(url, {
        headers: { Accept: "application/json", "User-Agent": EINNSYN_USER_AGENT },
      });
    } catch (e) {
      throw new EinnsynStopp(feilFraUnntak(e, url));
    }
    sist = res;
    const sti = new URL(url).pathname;
    if (res.status === 404 || res.status === 410) {
      if (erListeSti(sti)) throw new EinnsynStopp(feilFraStatus(res.status, url));
      return res;
    }
    if (res.status === 429 || res.status >= 500) {
      if (forsok < EINNSYN_V2_MAKS_FORSOK) {
        retryAfter = res.headers?.get?.("retry-after") ?? null;
        continue;
      }
      throw new EinnsynStopp(feilFraStatus(res.status, url));
    }
    return res;
  }
  throw new EinnsynStopp(feilFraStatus(sist?.status ?? 500, url));
}

function pakkHent(ctx: Ctx): Hent {
  return (async (input: Parameters<Hent>[0], init?: Parameters<Hent>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      host = "";
    }
    if (host !== "api.einnsyn.no") return ctx.hent(input, init);
    const trygg = tryggEinnsynUrl(url);
    if (!trygg) throw new EinnsynStopp(uventetFormat(url, "kall utenfor api.einnsyn.no"));
    return kallEinnsyn(trygg, ctx, true);
  }) as Hent;
}

type Side = { items: unknown[]; next: string | null; status: number };

async function lesSide(
  url: string,
  ctx: Ctx,
  slag: "sok" | "enhet",
): Promise<{ side: Side } | { feil: HenteFeil }> {
  let res: Response;
  try {
    res = await kallEinnsyn(url, ctx, true);
  } catch (e) {
    if (e instanceof EinnsynStopp) return { feil: e.feil };
    return { feil: feilFraUnntak(e, url) };
  }
  const lest = await lesTekstRespons(res, url);
  if ("feil" in lest) return { feil: lest.feil };
  try {
    const data = JSON.parse(lest.tekst);
    const validert = validerEinnsynListe(data, slag);
    if (!validert.ok) return { feil: uventetFormat(url, validert.detalj) };
    return { side: { items: validert.items, next: validert.next, status: res.status } };
  } catch (e) {
    return { feil: feilFraUnntak(e, url) };
  }
}

async function hentSider(
  forste: string,
  ctx: Ctx,
  slag: "sok" | "enhet",
  maksSider = EINNSYN_V2_MAKS_SIDER,
): Promise<{ items: unknown[]; feil: HenteFeil | null; status: number | null }> {
  const items: unknown[] = [];
  let url: string | null = forste;
  let status: number | null = null;
  const sett = new Set<string>();
  for (let side = 0; side < maksSider && url; side++) {
    const trygg = tryggEinnsynUrl(url);
    if (!trygg) return { items, feil: uventetFormat(url, "neste side utenfor api.einnsyn.no"), status };
    if (sett.has(trygg)) return { items, feil: uventetFormat(trygg, "neste side peker på seg selv"), status };
    sett.add(trygg);
    const lest = await lesSide(trygg, ctx, slag);
    if ("feil" in lest) return { items, feil: lest.feil, status };
    status = lest.side.status;
    items.push(...lest.side.items);
    if (!lest.side.next || lest.side.items.length < EINNSYN_V2_LIMIT) {
      return { items, feil: null, status };
    }
    const neste = tryggEinnsynUrl(lest.side.next);
    if (!neste) return { items, feil: uventetFormat(trygg, "neste side utenfor api.einnsyn.no"), status };
    if (side === maksSider - 1) {
      if (maksSider === EINNSYN_V2_BOLK_MAKS_SIDER) return { items, feil: null, status };
      return { items, feil: uventetFormat(trygg, "sidegrense"), status };
    }
    url = neste;
  }
  return { items, feil: null, status };
}

type Organ = { id: string; navn: string };

function lesOrgan(item: unknown): Organ | null {
  if (!item || typeof item !== "object") return null;
  const rad = item as { id?: unknown; navn?: unknown };
  const id = typeof rad.id === "string" ? rad.id : "";
  const navn = typeof rad.navn === "string" ? rad.navn : "";
  if (!id || !navn) return null;
  return { id, navn };
}

async function sjekkSpec(hent: Hent): Promise<HenteFeil | null> {
  try {
    const res = await hent(SPEC_COMMITS, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": EINNSYN_USER_AGENT,
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Liste filtrert på spec-filen. HEAD på main, og et objekt med sha,
    // er ikke et avvik: dokumentasjonscommits skal ikke gi delvis-alarm.
    const sha = Array.isArray(data) ? data[0]?.sha : null;
    if (!specShaAvviker(sha)) return null;
    console.warn(`eInnsyn spec-fil ${EINNSYN_SPEC_FIL} avviker fra pin: ${sha}`);
    return uventetFormat(API, "spec-commit avviker");
  } catch {
    return null;
  }
}

export async function hentEInnsynV2(opts?: {
  hent?: Hent;
  pause?: (ms: number) => Promise<void>;
  pauseMs?: number;
  nå?: number;
  tilfeldig?: () => number;
  sjekkSpec?: boolean;
  /** 1–8. Uten bolk søkes alle organ, som i testene. */
  bolk?: number;
  /** Når forespørselen startet. Tidsgrensen i bolk-modus regnes herfra. */
  startetMs?: number;
  klokke?: () => number;
  tidsgrenseMs?: number;
  /** Direkte forskyvning av organlisten. Uten verdi brukes Oslo-døgnet. */
  rotering?: number;
}): Promise<AdapterUtfall> {
  const hent = opts?.hent ?? fetch;
  const klokke = opts?.klokke ?? Date.now;
  const ctx: Ctx = {
    kall: 0,
    hent,
    vent: opts?.pause ?? pause,
    pauseMs: opts?.pauseMs ?? EINNSYN_V2_PAUSE_MS,
    tilfeldig: opts?.tilfeldig ?? Math.random,
    nå: () => opts?.nå ?? klokke(),
  };
  const fra = moetedatoFra(opts?.nå);
  const organ = new Map<string, Organ>();
  let httpStatus: number | null = null;
  const bolkKjoring = opts?.bolk != null;
  const specPa = opts?.sjekkSpec ?? (opts?.hent == null && (!bolkKjoring || opts.bolk === 1));
  const specFeil = specPa ? await sjekkSpec(hent) : null;
  const startet = opts?.startetMs ?? klokke();
  const sokGrense = bolkKjoring ? (opts?.tidsgrenseMs ?? EINNSYN_V2_BOLK_TIDSGRENSE_MS) : (opts?.tidsgrenseMs ?? null);
  const overTid = (grense: number | null) => grense != null && klokke() - startet >= grense;

  try {
    for (const sporring of EINNSYN_V2_OPPDAGELSE) {
      const url = `${API}/enhet?query=${encodeURIComponent(sporring)}&limit=100`;
      const sider = await hentSider(url, ctx, "enhet");
      httpStatus = sider.status ?? httpStatus;
      for (const item of sider.items) {
        const enhet = lesOrgan(item);
        if (enhet && erEinnsynV2Organ(enhet.navn)) organ.set(enhet.id, enhet);
      }
      if (sider.feil) {
        console.error(`eInnsyn v2 oppdagelse: ${sider.feil.melding}`);
        if (organ.size === 0) return feilUtfall(sider.feil, ctx.kall || 1);
        return {
          items: [],
          raattAntall: 0,
          antallEtterFilter: 0,
          feil: [sider.feil],
          forsok: ctx.kall,
          vellykket: Math.max(0, ctx.kall - 1),
          httpStatus: sider.feil.httpStatus ?? httpStatus,
        };
      }
    }
  } catch (e) {
    const feil = e instanceof EinnsynStopp ? e.feil : feilFraUnntak(e, API);
    console.error(`eInnsyn v2 oppdagelse: ${feil.melding}`);
    return feilUtfall(feil, ctx.kall || 1);
  }

  if (organ.size === 0 && ctx.kall > 0) {
    return feilUtfall(uventetFormat(API, "fant ingen organ"), ctx.kall);
  }

  const oppdagetAntall = organ.size;
  if (opts?.bolk != null) {
    const rotering = opts.rotering ?? einnsynRotering(opts?.nå ?? startet, oppdagetAntall);
    const valgt = organerIBolk([...organ.values()], opts.bolk, { rotering });
    organ.clear();
    for (const enhet of valgt) organ.set(enhet.id, enhet);
  }

  const saker = new Map<string, EInnsynMoetesak>();
  let stopp: HenteFeil | null = null;
  const enheter = [...organ.values()];
  const transport = pakkHent(ctx);

  const maksSok = bolkKjoring ? EINNSYN_V2_BOLK_MAKS_SIDER : EINNSYN_V2_MAKS_SIDER;
  const sok = async (url: string) => {
    const sider = await hentSider(url, ctx, "sok", maksSok);
    httpStatus = sider.status ?? httpStatus;
    for (const item of sider.items) {
      if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
        const id = (item as { id: string }).id;
        if (!saker.has(id)) saker.set(id, item as EInnsynMoetesak);
      }
    }
    return sider.feil;
  };

  let ferdigEnheter = 0;
  try {
    for (const enhet of enheter) {
      if (stopp) break;
      if (overTid(sokGrense)) {
        stopp = tidsgrenseFeil(ferdigEnheter, enheter.length);
        break;
      }
      for (const ord of EINNSYN_V2_SOKEORD) {
        if (overTid(sokGrense)) {
          stopp = tidsgrenseFeil(ferdigEnheter, enheter.length);
          break;
        }
        stopp = await sok(einnsynSokUrl({ enhetId: enhet.id, fra, ord }));
        if (stopp) break;
      }
      if (!stopp && erKulturutvalg(enhet.navn)) {
        if (overTid(sokGrense)) stopp = tidsgrenseFeil(ferdigEnheter, enheter.length);
        else stopp = await sok(einnsynSokUrl({ enhetId: enhet.id, fra }));
      }
      if (stopp) break;
      ferdigEnheter++;
    }
  } catch (e) {
    stopp = e instanceof EinnsynStopp ? e.feil : feilFraUnntak(e, API);
  }

  const geoMap = new Map<string, Awaited<ReturnType<typeof slåOppGeo>>>();
  if (!stopp) {
    const unike = [...new Set([...saker.values()].map((s) => s.journalenhet).filter(Boolean))] as string[];
    for (const id of unike) {
      if (bolkKjoring && overTid(EINNSYN_V2_GEO_TIDSGRENSE_MS)) break;
      if (ctx.kall >= EINNSYN_V2_MAKS_KALL) {
        stopp = uventetFormat(`${API}/enhet/${id}`, "kallgrense");
        break;
      }
      try {
        geoMap.set(id, await slåOppGeo(id, transport));
        const kjent = organ.get(id);
        const geo = geoMap.get(id);
        if (geo && kjent?.navn && !geo.navn) geo.navn = kjent.navn;
      } catch (e) {
        if (e instanceof EinnsynStopp) {
          stopp = e.feil;
          break;
        }
        console.error(`eInnsyn v2 geo ${id}:`, e);
        const kjent = organ.get(id);
        geoMap.set(id, kjent ? { navn: kjent.navn } : {});
      }
    }
  }

  const items: any[] = [];
  for (const sak of saker.values()) {
    const kjent = sak.journalenhet ? organ.get(sak.journalenhet) : undefined;
    const geo = sak.journalenhet ? geoMap.get(sak.journalenhet) : undefined;
    const medNavn = geo?.navn || kjent?.navn
      ? { ...geo, navn: geo?.navn || kjent?.navn }
      : geo;
    const mappet = mapEInnsynItem(sak, medNavn);
    if (!mappet) continue;
    mappet.forhåndsgodkjent = v2ForhandsGodkjent(mappet.tittel, mappet.instans);
    items.push(mappet);
  }

  const feil = [stopp, specFeil].filter((f): f is HenteFeil => !!f);
  console.log(
    `eInnsyn v2: bolk=${opts?.bolk ?? "-"}, oppdaget=${oppdagetAntall}, organ=${organ.size}, ferdig=${ferdigEnheter}, kall=${ctx.kall}, møtesaker=${saker.size}, mappet=${items.length}`,
  );
  if (ctx.kall === 0) return feilUtfall(feil[0] ?? uventetFormat(API, "ingen kall"), 1);
  if (items.length === 0 && feil[0] && saker.size === 0 && organ.size === 0) {
    return feilUtfall(feil[0], ctx.kall);
  }
  return {
    items,
    raattAntall: saker.size,
    antallEtterFilter: items.length,
    feil,
    forsok: ctx.kall,
    vellykket: feil.length ? Math.max(0, ctx.kall - 1) : ctx.kall,
    httpStatus: feil[0]?.httpStatus ?? httpStatus,
  };
}
