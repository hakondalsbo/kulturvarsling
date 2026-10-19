// Regjeringen-RSS. Dokumentfeedene dekker alle departement, inkludert KUD.
// KUD-feeden https://www.regjeringen.no/no/dep/kud/rss/ er død (404/403) og
// er bevisst ikke med: i deployet kode avbrøt den ene feilen resten av
// adapteren, så statsråd-feeden etter den gikk tapt.

import { samleRssSvar, type AdapterUtfall, type RssSvar } from "./kildehelse.ts";

export const REGJERINGEN_FEEDS: Array<{ url: string; instans: string }> = [
  {
    url: "https://www.regjeringen.no/no/rss/Rss/2581966/?documentType=dokumenter/h%C3%B8ringer",
    instans: "Regjeringen – høring",
  },
  {
    url: "https://www.regjeringen.no/no/rss/Rss/2581966/?documentType=dokumenter/nouer",
    instans: "Regjeringen – NOU",
  },
  {
    url: "https://www.regjeringen.no/no/rss/Rss/2581966/?documentType=dokumenter/meldinger",
    instans: "Regjeringen – stortingsmelding",
  },
  {
    url: "https://www.regjeringen.no/no/rss/Rss/2581966/?documentType=dokumenter/proposisjoner",
    instans: "Regjeringen – proposisjon",
  },
  // Spillemiddel-sporet: fordelingen av Norsk Tipping-overskuddet vedtas som
  // kgl.res. i statsråd. Nøkkelordfilteret slipper gjennom møtene som nevner
  // kultur/spillemidler. Denne MÅ hentes selv om en tidligere feed feiler.
  {
    url: "https://www.regjeringen.no/no/rss/Rss/2581966/?documentType=aktuelt/offisieltfrastatsr%C3%A5d",
    instans: "Regjeringen – statsråd",
  },
];

export type FeedHent = (url: string) => Promise<{ status: number; kropp: string }>;

/**
 * Henter hver feed for seg. Kast eller HTTP-feil på én feed logges som feil
 * og løkka fortsetter — senere feeder (statsråd) blir aldri droppet.
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

export async function hentRegjeringenRSS(): Promise<AdapterUtfall> {
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
  for (const feed of REGJERINGEN_FEEDS) {
    if (utfall.feil.some((f) => f.url === feed.url)) continue;
    const n = utfall.items.filter((i) => i.instans === feed.instans).length;
    console.log(`RSS ${feed.url}: ${n} items hentet`);
  }
  return utfall;
}
