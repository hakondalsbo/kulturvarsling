// eInnsyn v2. Kjører bare når EINNSYN_V2_AKTIV er nøyaktig "true".
//
// api.einnsyn.no/robots.txt sier Disallow: /. API-et er dokumentert, og
// dagens adapter bruker allerede ett søk. v2 skal ikke øke hentevolumet
// før Digdir har svart og flagget slås på med vilje. Av er standard.
// Vi følger ikke next til andre vertsnavn, og limit holdes på 50
// (OpenAPI-maks er 100).
//
// Forventet kall per kjøring med flagget PÅ, én side per søk
// (notatet 24.10.2026: 38 journalenheter):
//   oppdagelse     6     /enhet?query=…, limit 100
//   søk          380     10 søkeord × 38 enheter, limit 50, siste 30 dager
//   kulturutvalg   8     utvalg med «kultur» i navnet, uten søkeord
//   geo          114     38 × (1 /enhet + inntil 2 Brreg), cachet, uten taket på 25
//   sum          508
// Øvre tak når hvert søk bruker 3 sider: om lag 1 290. Absolutt stopp ved 1 500.
// Pause 400 ms mellom kall. Med flagget AV: 1 søk + maks 25 geo-oppslag, som før.
//
// 508 kall med pause kan vare lenger enn edge-funksjonens tidsgrense.
// Derfor blir flagget stående av til det er avklart.

import {
  mapEInnsynItem,
  slåOppGeo,
  type EInnsynMoetesak,
} from "./einnsyn.ts";
import {
  feilFraUnntak,
  feilUtfall,
  lesTekstRespons,
  uventetFormat,
  type AdapterUtfall,
  type HenteFeil,
} from "./kildehelse.ts";
import { erKulturRelevant, erRenIdrett } from "./logikk.ts";

const API = "https://api.einnsyn.no";

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
export const EINNSYN_V2_MAKS_KALL = 1500;
export const EINNSYN_V2_FORVENTET_ENHETER = 38;

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

/** 6 + 380 + 8 + 114 = 508 ved ett treffside og 38 enheter. */
export function forventetEinnsynV2Kall(antallEnheter = EINNSYN_V2_FORVENTET_ENHETER): {
  oppdagelse: number;
  sok: number;
  kulturUtvalg: number;
  geo: number;
  totalt: number;
} {
  const oppdagelse = 6;
  const sok = EINNSYN_V2_SOKEORD.length * antallEnheter;
  const kulturUtvalg = 8;
  const geo = antallEnheter * 3;
  return { oppdagelse, sok, kulturUtvalg, geo, totalt: oppdagelse + sok + kulturUtvalg + geo };
}

export function foldEinnsynNavn(navn: string): string {
  return navn.toLowerCase().replace(/å/g, "a").replace(/ø/g, "o").replace(/æ/g, "ae");
}

function somOrd(hay: string, needle: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${needle}(?:[^a-z0-9]|$)`).test(hay);
}

/**
 * 16 kommuner og 5 fylker som publiserer møter, pluss Oslos bydeler,
 * bystyre og byrådsavdeling. Viken og statlige organ er ute.
 */
export function erEinnsynV2Organ(navn: string | null | undefined): boolean {
  if (!navn?.trim()) return false;
  const f = foldEinnsynNavn(navn);
  if (somOrd(f, "viken")) return false;
  if (/departement|direktorat|universitet|sykehus/.test(f)) return false;
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
  if (url.pathname !== "/search" && url.pathname !== "/enhet") return null;
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

type Hent = typeof fetch;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Side = { items: any[]; next: string | null; status: number };

async function lesSide(url: string, hent: Hent): Promise<{ side: Side } | { feil: HenteFeil }> {
  let res: Response;
  try {
    res = await hent(url, {
      headers: { Accept: "application/json", "User-Agent": "Kulturvarsling/1.0" },
    });
  } catch (e) {
    return { feil: feilFraUnntak(e, url) };
  }
  const lest = await lesTekstRespons(res, url);
  if ("feil" in lest) return { feil: lest.feil };
  try {
    const data = JSON.parse(lest.tekst);
    if (!Array.isArray(data?.items)) return { feil: uventetFormat(url, "mangler items") };
    const next = typeof data.next === "string" && data.next ? data.next : null;
    return { side: { items: data.items, next, status: res.status } };
  } catch (e) {
    return { feil: feilFraUnntak(e, url) };
  }
}

async function hentSider(
  forste: string,
  ctx: { kall: number; hent: Hent; vent: (ms: number) => Promise<void>; pauseMs: number },
): Promise<{ items: any[]; feil: HenteFeil | null; status: number | null }> {
  const items: any[] = [];
  let url: string | null = forste;
  let status: number | null = null;
  const sett = new Set<string>();
  for (let side = 0; side < EINNSYN_V2_MAKS_SIDER && url; side++) {
    if (ctx.kall >= EINNSYN_V2_MAKS_KALL) {
      return { items, feil: uventetFormat(url, "kallgrense"), status };
    }
    if (ctx.kall > 0 && ctx.pauseMs > 0) await ctx.vent(ctx.pauseMs);
    const trygg = tryggEinnsynUrl(url);
    if (!trygg) return { items, feil: uventetFormat(url, "neste side utenfor api.einnsyn.no"), status };
    if (sett.has(trygg)) return { items, feil: uventetFormat(trygg, "neste side peker på seg selv"), status };
    sett.add(trygg);
    ctx.kall++;
    const lest = await lesSide(trygg, ctx.hent);
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

export async function hentEInnsynV2(opts?: {
  hent?: Hent;
  pause?: (ms: number) => Promise<void>;
  pauseMs?: number;
  nå?: number;
}): Promise<AdapterUtfall> {
  const hent = opts?.hent ?? fetch;
  const ctx = {
    kall: 0,
    hent,
    vent: opts?.pause ?? pause,
    pauseMs: opts?.pauseMs ?? EINNSYN_V2_PAUSE_MS,
  };
  const fra = moetedatoFra(opts?.nå);
  const organ = new Map<string, Organ>();
  let httpStatus: number | null = null;

  for (const sporring of EINNSYN_V2_OPPDAGELSE) {
    const url = `${API}/enhet?query=${encodeURIComponent(sporring)}&limit=100`;
    const sider = await hentSider(url, ctx);
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

  if (organ.size === 0 && ctx.kall > 0) {
    return feilUtfall(uventetFormat(API, "fant ingen organ"), ctx.kall);
  }

  const saker = new Map<string, EInnsynMoetesak>();
  let stopp: HenteFeil | null = null;
  const enheter = [...organ.values()];

  const sok = async (url: string) => {
    const sider = await hentSider(url, ctx);
    httpStatus = sider.status ?? httpStatus;
    for (const item of sider.items) {
      if (item && typeof item === "object" && typeof item.id === "string" && !saker.has(item.id)) {
        saker.set(item.id, item as EInnsynMoetesak);
      }
    }
    return sider.feil;
  };

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

  const geoFeil = stopp;
  const geoMap = new Map<string, Awaited<ReturnType<typeof slåOppGeo>>>();
  if (!geoFeil) {
    const unike = [...new Set([...saker.values()].map((s) => s.journalenhet).filter(Boolean))] as string[];
    for (const id of unike) {
      if (ctx.kall >= EINNSYN_V2_MAKS_KALL) {
        stopp = uventetFormat(`${API}/enhet/${id}`, "kallgrense");
        break;
      }
      if (ctx.kall > 0 && ctx.pauseMs > 0) await ctx.vent(ctx.pauseMs);
      ctx.kall++;
      try {
        geoMap.set(id, await slåOppGeo(id, hent));
        const kjent = organ.get(id);
        const geo = geoMap.get(id);
        if (geo && kjent?.navn && !geo.navn) geo.navn = kjent.navn;
      } catch (e) {
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

  const feil = stopp ? [stopp] : [];
  console.log(
    `eInnsyn v2: kall=${ctx.kall}, organ=${organ.size}, møtesaker=${saker.size}, mappet=${items.length}`,
  );
  if (ctx.kall === 0) return feilUtfall(uventetFormat(API, "ingen kall"), 1);
  if (items.length === 0 && feil[0] && ctx.kall > 0 && saker.size === 0 && organ.size === 0) {
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
