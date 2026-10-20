// Regjeringen-RSS.
// Dokumentfeedene dekker alle departement. KUD-feeden
// https://www.regjeringen.no/no/dep/kud/rss/ er død (404/403) og er bevisst
// ikke med: i eldre kode avbrøt den ene feilen resten av adapteren.
//
// Tilskudd, KUD-nyheter og statsbudsjett-pakken ligger utenfor de fem
// dokumenttypene. De hentes fra RSS-generatoren med owner=545 (KUD).
// Tilleggsfeedene avgrenses til de siste 120 dagene så historiske
// høringer og budsjettrunder ikke tømmes inn.

import { samleRssSvar, type AdapterUtfall, type RssSvar } from "./kildehelse.ts";
import {
  erRegjeringenRelevant,
  innenInnhentingsvindu,
  parseRegjeringenFrist,
  skalHenteFristside,
  sideUrl,
  type RssItem,
} from "./logikk.ts";

const RSS = "https://www.regjeringen.no/no/rss/Rss/2581966/";
const KUD = "owner=545";

export type RegjeringenFeed = {
  url: string;
  instans: string;
  /** KUD-tillegg. Eldre enn innhentingsvinduet droppes. */
  vindu?: boolean;
};

export const REGJERINGEN_FEEDS: RegjeringenFeed[] = [
  {
    url: `${RSS}?documentType=dokumenter/h%C3%B8ringer`,
    instans: "Regjeringen – høring",
  },
  {
    url: `${RSS}?documentType=dokumenter/nouer`,
    instans: "Regjeringen – NOU",
  },
  {
    url: `${RSS}?documentType=dokumenter/meldinger`,
    instans: "Regjeringen – stortingsmelding",
  },
  {
    url: `${RSS}?documentType=dokumenter/proposisjoner`,
    instans: "Regjeringen – proposisjon",
  },
  // Spillemiddel-sporet: fordelingen av Norsk Tipping-overskuddet vedtas som
  // kgl.res. i statsråd. Denne MÅ hentes selv om en tidligere feed feiler.
  {
    url: `${RSS}?documentType=aktuelt/offisieltfrastatsr%C3%A5d`,
    instans: "Regjeringen – statsråd",
  },
  {
    url: `${RSS}?documentType=aktuelt/nyheter&${KUD}`,
    instans: "KUD – nyhet",
    vindu: true,
  },
  {
    url: `${RSS}?documentType=dokumenter/h%C3%B8ringer&${KUD}`,
    instans: "KUD – høring",
    vindu: true,
  },
  {
    url: `${RSS}?documentType=loverogregler/retningslinjer&${KUD}`,
    instans: "KUD – tilskudd",
    vindu: true,
  },
  {
    url: `${RSS}?topic=931/1437&${KUD}`,
    instans: "KUD – statsbudsjett",
    vindu: true,
  },
];

export type FeedHent = (url: string) => Promise<{ status: number; kropp: string }>;

/**
 * Henter hver feed for seg. Kast eller HTTP-feil på én feed logges som feil
 * og løkka fortsetter — senere feeder blir aldri droppet.
 */
export async function hentFeeder(
  feeds: Array<{ url: string; instans: string }>,
  hent: FeedHent,
): Promise<AdapterUtfall> {
  const svar: RssSvar[] = [];
  for (const feed of feeds) {
    try {
      const res = await hent(feed.url);
      const ok = res.status >= 200 && res.status < 300;
      svar.push({
        url: feed.url,
        instans: feed.instans,
        status: res.status,
        kropp: ok ? res.kropp : null,
      });
    } catch (e) {
      svar.push({
        url: feed.url,
        instans: feed.instans,
        status: null,
        kropp: null,
        unntak: e,
      });
    }
  }
  return samleRssSvar(svar);
}

export function filtrerRegjeringenItems<T extends RssItem>(
  items: T[],
  nå = Date.now(),
): T[] {
  const medVindu = new Set(
    REGJERINGEN_FEEDS.filter((f) => f.vindu).map((f) => f.instans),
  );
  return items.filter((item) =>
    !medVindu.has(item.instans) || innenInnhentingsvindu(item.publisert_dato, nå)
  );
}

export async function hentRegjeringenSide(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Kulturvarsling/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const body = await res.text();
    if (!body || /cf-mitigated|Just a moment/i.test(body.slice(0, 800))) return null;
    return body;
  } catch {
    return null;
  }
}

/** Henter HTML for hørings- og tilskuddssider og parser frist. */
export async function parseOgBerik(
  items: RssItem[],
  hent: (url: string) => Promise<string | null> = hentRegjeringenSide,
): Promise<RssItem[]> {
  const ut: RssItem[] = [];
  for (const item of items) {
    if (!skalHenteFristside(item)) {
      ut.push(item);
      continue;
    }
    const html = await hent(sideUrl(item.kilde));
    const frist = html ? parseRegjeringenFrist(html) : null;
    ut.push(frist ? { ...item, frist } : item);
  }
  return ut;
}

export async function hentRegjeringenRSS(nå = Date.now()): Promise<AdapterUtfall> {
  const utfall = await hentFeeder(REGJERINGEN_FEEDS, async (url) => {
    const res = await fetch(url, {
      headers: { "User-Agent": "Kulturvarsling/1.0" },
    });
    const kropp = res.ok ? await res.text() : "";
    return { status: res.status, kropp };
  });

  for (const f of utfall.feil) {
    console.error(
      `RSS-feed feilet: url=${f.url ?? "ukjent"} http_status=${f.httpStatus ?? "ingen"} melding=${f.melding}`,
    );
  }
  const items = filtrerRegjeringenItems(utfall.items, nå);
  for (const feed of REGJERINGEN_FEEDS) {
    if (utfall.feil.some((f) => f.url === feed.url)) continue;
    const n = utfall.items.filter((i) => i.instans === feed.instans).length;
    console.log(`RSS ${feed.url}: ${n} items hentet`);
  }
  return {
    ...utfall,
    items,
    raattAntall: utfall.raattAntall,
    antallEtterFilter: items.filter((i) =>
      erRegjeringenRelevant(i.tittel, i.sammendrag_raa)
    ).length,
  };
}
