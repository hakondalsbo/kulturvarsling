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
  };
}

export function okUtfall(
  items: any[],
  raattAntall: number,
  antallEtterFilter: number,
): AdapterUtfall {
  return {
    items,
    raattAntall,
    antallEtterFilter,
    feil: [],
    forsok: 1,
    vellykket: 1,
  };
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

export function formaterFeil(feil: HenteFeil[]): string {
  return feil
    .map((f) => {
      const sted = f.url ?? "kilden";
      const status = f.httpStatus != null ? ` HTTP ${f.httpStatus}` : "";
      return `${sted}${status}: ${f.melding}`;
    })
    .join("; ")
    .slice(0, 2000);
}

export type KjøringInndata = {
  raattAntall: number;
  antallNye: number;
  feil: HenteFeil[];
  forsok: number;
  vellykket: number;
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
export function klassifiserKjøring(p: KjøringInndata): KjøringKlassifisering {
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

  if (p.raattAntall <= 0) {
    return { status: "tom", httpStatus: null, feilmelding: null };
  }
  if (p.antallNye > 0) {
    return { status: "ok_nye", httpStatus: null, feilmelding: null };
  }
  return { status: "ok_ingen_nye", httpStatus: null, feilmelding: null };
}

/**
 * Stortingssesjonen løper 1. oktober–30. september.
 * Kalenderdagen leses i UTC. Nattlig cron kjører 06:00 UTC, som er morgen
 * i Norge, så UTC-datoen er den norske datoen når jobben går.
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
    vellykket++;
  }

  const antallEtterFilter = opts.forhandsGodkjent
    ? items.length
    : items.filter((i) => erKulturRelevant(i.tittel, i.sammendrag_raa)).length;

  return {
    items,
    raattAntall: items.length,
    antallEtterFilter,
    feil,
    forsok: svar.length,
    vellykket,
  };
}
