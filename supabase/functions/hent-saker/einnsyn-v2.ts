// eInnsyn v2. Kjører bare når EINNSYN_V2_AKTIV er nøyaktig "true".
//
// Digdir (servicedesk) 26.10.2026: det åpne søket på api.einnsyn.no krever
// ingen nøkkel. robots.txt gjelder søkemotorer. Vi omgår ikke 403, og vi
// følger ikke next til andre vertsnavn. Kjøringen er nattlig, én gang i
// døgnet, atskilt fra hent-saker-daglig.
//
// Kallbudsjett mot api.einnsyn.no, målt 26.10.2026 etter organfilteret
// (43 enheter: 16 kommuner, 5 fylkeskommuner, 15 bydeler,
// Gamle Oslo bydelsutvalg, tre Stavanger bystyre, to kunstutvalg
// og Bystyrets sekretariat):
//   oppdagelse      5    /enhet?query=… (kommune har to sider)
//   søk           430    10 søkeord × 43 enheter, én side, siste 30 dager
//   geo            43    ett /enhet/{id} per treff-enhet, øvre anslag
//   sum           478    Brreg kommer i tillegg, inntil to kall per enhet
// Pause 400 ms mellom kall (~2,5 kall/s). Med ~150 ms svar er veggtiden
// om lag 260 s. Det er under betalt plans veggklokke på 400 s, og over
// grensen på 150 s for å sende HTTP-svaret. Nattjobben svarer derfor
// med en gang og fortsetter i EdgeRuntime.waitUntil.
// Absolutt tak: 600 kall mot api.einnsyn.no per natt, inkludert nye
// forsøk. Da avbrytes kjøringen pent, og kilde_alarmer får en rad.
// 429 og 5xx: inntil 3 forsøk, eksponentiell backoff med jitter,
// Retry-After respekteres opp til 15 s. Lengre ventetid avbryter.

import {
  EINNSYN_USER_AGENT,
  EinnsynStopp,
  mapEInnsynItem,
  slåOppGeo,
  type EInnsynMoetesak,
} from "./einnsyn.ts";
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
const SPEC_COMMITS =
  "https://api.github.com/repos/felleslosninger/einnsyn-api-spec/commits/main";

/** Siste commit på main i einnsyn-api-spec, lest 26.10.2026. */
export const EINNSYN_SPEC_KJENT_SHA = "10f2b418fdbd7eb7cb523364a793549c37fff6fb";

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
/** Hardt tak per natt mot api.einnsyn.no. Forventet vanlig natt er 478. */
export const EINNSYN_V2_MAKS_KALL = 600;
export const EINNSYN_V2_FORVENTET_ENHETER = 43;

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
 * Planestimat. 5 + 430 + 0 + 129 = 564 ved 43 enheter, der geo teller
 * ett eInnsyn-kall og inntil to Brreg-kall. Taket på 600 gjelder bare
 * api.einnsyn.no.
 */
export function forventetEinnsynV2Kall(antallEnheter = EINNSYN_V2_FORVENTET_ENHETER): {
  oppdagelse: number;
  sok: number;
  kulturUtvalg: number;
  geo: number;
  totalt: number;
} {
  const oppdagelse = 5;
  const sok = EINNSYN_V2_SOKEORD.length * antallEnheter;
  const kulturUtvalg = 0;
  const geo = antallEnheter * 3;
  return { oppdagelse, sok, kulturUtvalg, geo, totalt: oppdagelse + sok + kulturUtvalg + geo };
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
      if (vente === "avbryt") throw new EinnsynStopp(feilFraStatus(429, url));
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
): Promise<{ items: unknown[]; feil: HenteFeil | null; status: number | null }> {
  const items: unknown[] = [];
  let url: string | null = forste;
  let status: number | null = null;
  const sett = new Set<string>();
  for (let side = 0; side < EINNSYN_V2_MAKS_SIDER && url; side++) {
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
    if (side === EINNSYN_V2_MAKS_SIDER - 1) {
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
    if (specShaAvviker(data?.sha)) return uventetFormat(API, "spec-commit avviker");
    return null;
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
}): Promise<AdapterUtfall> {
  const hent = opts?.hent ?? fetch;
  const ctx: Ctx = {
    kall: 0,
    hent,
    vent: opts?.pause ?? pause,
    pauseMs: opts?.pauseMs ?? EINNSYN_V2_PAUSE_MS,
    tilfeldig: opts?.tilfeldig ?? Math.random,
    nå: () => opts?.nå ?? Date.now(),
  };
  const fra = moetedatoFra(opts?.nå);
  const organ = new Map<string, Organ>();
  let httpStatus: number | null = null;
  const specFeil = (opts?.sjekkSpec ?? opts?.hent == null) ? await sjekkSpec(hent) : null;

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

  const saker = new Map<string, EInnsynMoetesak>();
  let stopp: HenteFeil | null = null;
  const enheter = [...organ.values()];
  const transport = pakkHent(ctx);

  const sok = async (url: string) => {
    const sider = await hentSider(url, ctx, "sok");
    httpStatus = sider.status ?? httpStatus;
    for (const item of sider.items) {
      if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
        const id = (item as { id: string }).id;
        if (!saker.has(id)) saker.set(id, item as EInnsynMoetesak);
      }
    }
    return sider.feil;
  };

  try {
    for (const enhet of enheter) {
      if (stopp) break;
      for (const ord of EINNSYN_V2_SOKEORD) {
        stopp = await sok(einnsynSokUrl({ enhetId: enhet.id, fra, ord }));
        if (stopp) break;
      }
      if (!stopp && erKulturutvalg(enhet.navn)) {
        stopp = await sok(einnsynSokUrl({ enhetId: enhet.id, fra }));
      }
    }
  } catch (e) {
    stopp = e instanceof EinnsynStopp ? e.feil : feilFraUnntak(e, API);
  }

  const geoMap = new Map<string, Awaited<ReturnType<typeof slåOppGeo>>>();
  if (!stopp) {
    const unike = [...new Set([...saker.values()].map((s) => s.journalenhet).filter(Boolean))] as string[];
    for (const id of unike) {
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
    `eInnsyn v2: kall=${ctx.kall}, organ=${organ.size}, møtesaker=${saker.size}, mappet=${items.length}`,
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
