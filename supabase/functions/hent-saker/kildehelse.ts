// Ren, testbar kildehelse for hent-saker — ingen nettverk, ingen Deno.
// Statussettet er Kildevakts krav. «tom» betyr ekte 0 råtreff, aldri en feil
// som er svelget og telt som tom liste.

import { erKulturRelevant, parseRssItems, type RssItem } from "./logikk.ts";

export const KILDE_STATUSER = [
  "ok_nye",
  "ok_ingen_nye",
  "tom",
  "delvis",
  "feil_http",
  "feil_timeout",
  "feil_parse",
  "feil_auth",
  "feil_nett",
  "feil_tomt_svar",
  "feil_manglende_frist",
] as const;

export type KildeStatus = (typeof KILDE_STATUSER)[number];

export type HenteFeilType = "http" | "timeout" | "parse" | "auth" | "nett";

export type HenteFeil = {
  type: HenteFeilType;
  httpStatus: number | null;
  melding: string;
  url: string | null;
};

export type AdapterUtfall = {
  items: any[];
  /** Treff fra kilden før nøkkelordfilter og før dedup. Lagres som antall_funnet. */
  raattAntall: number;
  /** Etter relevans-/rutinefilter, før dedup mot lagrede varsler. */
  antallEtterFilter: number;
  feil: HenteFeil[];
  forsok: number;
  vellykket: number;
  /** HTTP-status for vellykket kall, eller feilens status når kallet feilet. */
  httpStatus: number | null;
  /** Innholds-id → frist fra høringslisten, når den lot seg hente. */
  horingsfrister?: ReadonlyMap<string, string>;
};

export type KjoertAv = "supabase_cron" | "vercel_cron" | "manuell";

const FEIL_STATUS: Record<HenteFeilType, KildeStatus> = {
  http: "feil_http",
  timeout: "feil_timeout",
  parse: "feil_parse",
  auth: "feil_auth",
  nett: "feil_nett",
};

export function feilFraStatus(status: number, url: string | null): HenteFeil {
  if (status === 401 || status === 403) {
    return { type: "auth", httpStatus: status, melding: `HTTP ${status}`, url };
  }
  return { type: "http", httpStatus: status, melding: `HTTP ${status}`, url };
}

export function feilFraUnntak(e: unknown, url: string | null = null): HenteFeil {
  const navn = e instanceof Error ? e.name : "";
  const melding = e instanceof Error ? e.message : String(e);
  const lav = `${navn} ${melding}`.toLowerCase();
  if (
    navn === "TimeoutError" ||
    navn === "AbortError" ||
    lav.includes("timeout") ||
    lav.includes("timed out") ||
    lav.includes("aborted")
  ) {
    return { type: "timeout", httpStatus: null, melding, url };
  }
  if (
    e instanceof SyntaxError ||
    lav.includes("unexpected token") ||
    lav.includes("unexpected end of json")
  ) {
    return { type: "parse", httpStatus: null, melding, url };
  }
  return { type: "nett", httpStatus: null, melding, url };
}

export function uventetFormat(url: string, detalj: string): HenteFeil {
  return {
    type: "parse",
    httpStatus: 200,
    melding: `Uventet format: ${detalj}`,
    url,
  };
}

export function feilUtfall(feil: HenteFeil, forsok = 1): AdapterUtfall {
  return {
    items: [],
    raattAntall: 0,
    antallEtterFilter: 0,
    feil: [feil],
    forsok,
    vellykket: 0,
    httpStatus: feil.httpStatus,
  };
}

export function okUtfall(
  items: any[],
  raattAntall: number,
  antallEtterFilter: number,
  httpStatus: number | null = 200,
): AdapterUtfall {
  return {
    items,
    raattAntall,
    antallEtterFilter,
    feil: [],
    forsok: 1,
    vellykket: 1,
    httpStatus,
  };
}

/**
 * Stortingets JSON er som regel { saker_liste: [...] }. Noen svar (ett element,
 * eller XML-omslag) legger lista i saker_liste.sak. Tom liste er et ekte 0,
 * ikke en parsefeil — klassifiserKjøring avgjør om det er tom eller feil_tomt_svar.
 */
export function lesSakerListe(
  data: unknown,
): { saker: any[] } | { feil: string } {
  if (!data || typeof data !== "object") return { feil: "mangler rot-objekt" };
  const sl = (data as { saker_liste?: unknown }).saker_liste;
  if (Array.isArray(sl)) return { saker: sl };
  if (sl && typeof sl === "object") {
    const inner = (sl as { sak?: unknown }).sak;
    if (Array.isArray(inner)) return { saker: inner };
    if (inner && typeof inner === "object") return { saker: [inner] };
  }
  return { feil: "mangler saker_liste" };
}

/**
 * Eksporten ignorerer ukjente parametre (sesjon= i stedet for sesjonid=) og
 * svarer 200 med en annen sesjon. Når sesjon_id finnes og ikke matcher, er
 * svaret ikke et tomt treff.
 */
export function sesjonIdStemmer(data: unknown, sesjon: string): boolean {
  if (!data || typeof data !== "object") return false;
  const id = (data as { sesjon_id?: unknown }).sesjon_id;
  if (typeof id !== "string" || id === "") return true;
  return id === sesjon;
}

/** Leser kropp bare ved 2xx. Tom kropp er feil_parse, ikke et tomt treff. */
export async function lesTekstRespons(
  res: { ok: boolean; status: number; text(): Promise<string> },
  url: string,
): Promise<{ tekst: string } | { feil: HenteFeil }> {
  if (!res.ok) return { feil: feilFraStatus(res.status, url) };
  let tekst = "";
  try {
    tekst = await res.text();
  } catch (e) {
    return { feil: feilFraUnntak(e, url) };
  }
  if (!tekst.trim()) {
    return {
      feil: { type: "parse", httpStatus: res.status, melding: "Tom kropp", url },
    };
  }
  return { tekst };
}

const URL_I_TEKST = /https?:\/\/|www\.|\b[\w.-]+\.(?:no|com|org|net|sh)\b/i;

function erKortEgenTekst(melding: string): boolean {
  const m = melding.trim();
  return m.length > 0 && m.length <= 160 && !URL_I_TEKST.test(m) && !/[<>]/.test(m);
}

/**
 * Tekst som kan ligge i kilde_kjoringer. Tabellen er offentlig lesbar, så
 * eksterne URL-er og vilkårlige svartekster blir aldri med. Detaljer logges
 * med console.error hos kalleren.
 */
export function sanitertFeilmelding(f: HenteFeil): string {
  if ((f.type === "http" || f.type === "auth") && f.httpStatus != null) {
    return `HTTP ${f.httpStatus}`;
  }
  if (f.type === "timeout") return "Tidsavbrudd";
  if (f.type === "parse") {
    const m = f.melding.trim();
    if (m === "Tom kropp") return m;
    if (m.startsWith("Uventet format") && erKortEgenTekst(m)) return m;
    return "Uventet format";
  }
  const m = f.melding.trim();
  if (m === "Ingen kall ble forsøkt" || m === "Kilden svarte ikke") return m;
  if (/^\d+ av \d+ kall feilet$/.test(m)) return m;
  if (/^HTTP \d{3}$/.test(m)) return m;
  return "Innhentingen feilet. Kontroller kilden og adapteren.";
}

export function formaterFeil(feil: HenteFeil[]): string {
  return feil.map(sanitertFeilmelding).join("; ").slice(0, 2000);
}

export type AdapterDel = {
  items: any[];
  raattAntall: number;
  antallEtterFilter: number;
  /** null når delen ble ferdig uten feil. */
  feil: HenteFeil | null;
  httpStatus: number | null;
};

/** Slår sammen uavhengige delkall (f.eks. to stortingssesjoner) til ett utfall. */
export function slåSammenAdapterdeler(deler: AdapterDel[]): AdapterUtfall {
  const feil = deler.flatMap((d) => (d.feil ? [d.feil] : []));
  const suksessStatus = deler.find((d) => !d.feil && d.httpStatus != null)?.httpStatus ?? null;
  const feilStatus = feil.find((f) => f.httpStatus != null)?.httpStatus ?? null;
  return {
    items: deler.flatMap((d) => d.items),
    raattAntall: deler.reduce((s, d) => s + d.raattAntall, 0),
    antallEtterFilter: deler.reduce((s, d) => s + d.antallEtterFilter, 0),
    feil,
    forsok: deler.length,
    vellykket: deler.length - feil.length,
    httpStatus: feil.length > 0 ? (feilStatus ?? suksessStatus) : suksessStatus,
  };
}

export type TidligSvar =
  | { kind: "json"; status: 503 | 401 | 200; body: Record<string, string> }
  | { kind: "tekst"; status: 405; body: string };

/**
 * Første port i hent-saker. Hemmeligheten sjekkes før metode, så en GET uten
 * riktig x-cron-secret aldri blir helsesjekk.
 */
export function tidligAvslag(
  method: string,
  secret: string | undefined,
  header: string | null,
): TidligSvar | null {
  if (!secret) {
    return { kind: "json", status: 503, body: { feil: "Tjenesten er ikke konfigurert" } };
  }
  if (header !== secret) {
    return { kind: "json", status: 401, body: { feil: "Uautorisert" } };
  }
  if (method === "GET") {
    return { kind: "json", status: 200, body: { status: "ok" } };
  }
  if (method !== "POST") {
    return { kind: "tekst", status: 405, body: "Bruk POST" };
  }
  return null;
}

export type KjøringInndata = {
  raattAntall: number;
  antallNye: number;
  feil: HenteFeil[];
  forsok: number;
  vellykket: number;
  /** HTTP-status fra et vellykket kall. Feilstier bruker feilens egen status. */
  httpStatus?: number | null;
  /**
   * Kilder som normalt har et korpus (Stortinget-sesjonen, RSS, vedtak).
   * 0 råtreff der er feil_tomt_svar, ikke tom og ikke ok_ingen_nye.
   */
  forventerTreff?: boolean;
  /** Nye Regjeringen-høringer lagret uten frist. Gjør ellers grønn kjøring til alarm. */
  manglendeFrist?: number;
};

export type KjøringKlassifisering = {
  status: KildeStatus;
  httpStatus: number | null;
  feilmelding: string | null;
};

/**
 * Klassifiserer én kildekjøring.
 * Totalfeil kan aldri bli «tom» eller «ok_*» — det er Kildevakt-fellen.
 * Delvis (noe svarte, noe feilet) slår ut ok/tom selv om råtreff > 0.
 */
function medManglendeFrist(
  base: KjøringKlassifisering,
  antall: number | undefined,
): KjøringKlassifisering {
  if (!antall || antall <= 0) return base;
  const tekst = antall === 1 ? "1 høring uten frist" : `${antall} høringer uten frist`;
  if (base.status === "ok_nye" || base.status === "ok_ingen_nye" || base.status === "tom") {
    return {
      status: "feil_manglende_frist",
      httpStatus: base.httpStatus,
      feilmelding: tekst,
    };
  }
  return {
    ...base,
    feilmelding: base.feilmelding ? `${base.feilmelding}; ${tekst}`.slice(0, 2000) : tekst,
  };
}

export function klassifiserKjøring(p: KjøringInndata): KjøringKlassifisering {
  return medManglendeFrist(klassifiserKjøringUtenFrist(p), p.manglendeFrist);
}

function klassifiserKjøringUtenFrist(p: KjøringInndata): KjøringKlassifisering {
  const feil = p.feil ?? [];
  const vellykket = p.vellykket;
  const forsok = p.forsok;

  if (forsok <= 0 || (vellykket === 0 && feil.length === 0)) {
    const syntetisk: HenteFeil = feil[0] ?? {
      type: "nett",
      httpStatus: null,
      melding: forsok <= 0 ? "Ingen kall ble forsøkt" : "Kilden svarte ikke",
      url: null,
    };
    return {
      status: FEIL_STATUS[syntetisk.type],
      httpStatus: syntetisk.httpStatus,
      feilmelding: formaterFeil(feil.length ? feil : [syntetisk]),
    };
  }

  if (vellykket > 0 && (feil.length > 0 || vellykket < forsok)) {
    return {
      status: "delvis",
      httpStatus: feil.find((f) => f.httpStatus != null)?.httpStatus ?? null,
      feilmelding: formaterFeil(
        feil.length
          ? feil
          : [{
            type: "nett",
            httpStatus: null,
            melding: `${forsok - vellykket} av ${forsok} kall feilet`,
            url: null,
          }],
      ),
    };
  }

  if (vellykket === 0) {
    const primær = feil[0];
    return {
      status: FEIL_STATUS[primær.type],
      httpStatus: primær.httpStatus,
      feilmelding: formaterFeil(feil),
    };
  }

  const http = p.httpStatus ?? null;
  if (p.raattAntall <= 0) {
    if (p.forventerTreff) {
      return {
        status: "feil_tomt_svar",
        httpStatus: http,
        feilmelding: "Kilden svarte uten treff",
      };
    }
    return { status: "tom", httpStatus: http, feilmelding: null };
  }
  if (p.antallNye > 0) {
    return { status: "ok_nye", httpStatus: http, feilmelding: null };
  }
  return { status: "ok_ingen_nye", httpStatus: http, feilmelding: null };
}

/**
 * Én sesjon etter UTC-dato. Kjøringen bruker stortingsSesjoner() i logikk.ts
 * (gjeldende + forrige sesjon, Europe/Oslo) og slår dem sammen til ett utfall.
 */
export function stortingsesjon(dato: Date = new Date()): string {
  const år = dato.getUTCFullYear();
  const startÅr = dato.getUTCMonth() >= 9 ? år : år - 1;
  return `${startÅr}-${startÅr + 1}`;
}

/**
 * Prod-jobben `hent-saker-daglig` (pg_cron, oppdatert 05.10) poster
 * `{ "utlost_av": "pg_cron" }`. Vercel Cron er fjernet; «vercel_cron» kjennes
 * igjen hvis headeren eller body-merket likevel dukker opp.
 */
export function utledKjoertAv(input: {
  utlostAv?: unknown;
  headerUtlostAv?: string | null;
  vercelCronHeader?: string | null;
}): KjoertAv {
  const merke = String(input.utlostAv ?? input.headerUtlostAv ?? "")
    .trim()
    .toLowerCase();
  if (merke === "pg_cron" || merke === "supabase_cron") return "supabase_cron";
  if (merke === "vercel_cron" || merke === "vercel") return "vercel_cron";
  if (input.vercelCronHeader) return "vercel_cron";
  return "manuell";
}

export type RssSvar = {
  url: string;
  instans: string;
  status: number | null;
  kropp: string | null;
  unntak?: unknown;
};

const RSS_MARKØR = /<(rss|feed)\b/i;

/**
 * Slår sammen uavhengige RSS-svar. En feilende feed blir en feilrad og
 * hopper videre — den fjerner aldri items fra feeder som svarte.
 */
export function samleRssSvar(
  svar: RssSvar[],
  opts: { forhandsGodkjent?: boolean } = {},
): AdapterUtfall {
  const items: RssItem[] = [];
  const feil: HenteFeil[] = [];
  let vellykket = 0;
  let suksessHttp: number | null = null;

  for (const s of svar) {
    if (s.unntak) {
      feil.push(feilFraUnntak(s.unntak, s.url));
      continue;
    }
    if (s.status == null || s.status < 200 || s.status >= 300) {
      feil.push(feilFraStatus(s.status ?? 0, s.url));
      continue;
    }
    const kropp = s.kropp ?? "";
    if (!kropp.trim()) {
      feil.push({
        type: "parse",
        httpStatus: s.status,
        melding: "Tom kropp",
        url: s.url,
      });
      continue;
    }
    if (!RSS_MARKØR.test(kropp)) {
      feil.push({
        type: "parse",
        httpStatus: s.status,
        melding: "Uventet format (ikke RSS)",
        url: s.url,
      });
      continue;
    }
    items.push(...parseRssItems(kropp, s.instans));
    if (suksessHttp == null && s.status != null) suksessHttp = s.status;
    vellykket++;
  }

  const antallEtterFilter = opts.forhandsGodkjent
    ? items.length
    : items.filter((i) => erKulturRelevant(i.tittel, i.sammendrag_raa)).length;

  const feilHttp = feil.find((f) => f.httpStatus != null)?.httpStatus ?? null;
  return {
    items,
    raattAntall: items.length,
    antallEtterFilter,
    feil,
    forsok: svar.length,
    vellykket,
    httpStatus: vellykket === 0 ? feilHttp : (feil.length > 0 ? (feilHttp ?? suksessHttp) : suksessHttp),
  };
}
