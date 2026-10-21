// Datogrense for vanlige kjøringer. Ingen nettverk.
//
// Marginen er 72 timer under siste vellykkede kjøring for kilden.
// Cron er døgnlig. Én feilet natt, pluss at RSS ofte viser pubDate
// noen timer før elementet ligger i feeden, og klokkeskew mellom
// UTC og Europe/Oslo (1–2 timer), skal ikke kaste en sak som kom
// rett før forrige suksess. 24 timer mister en lørdagssak hvis neste
// suksess er onsdag etter en feilet mandag: grensen er siste suksess
// minus marginen, ikke «nå». 72 timer dekker en mistet døgnkjøring
// og feed-etterslep uten å slippe gjennom en pressemelding fra juni.
//
// Uten tidligere vellykket kjøring er ankeret «nå». En kilde uten
// logg får dermed ikke hele historikken som nye varsler. Eldre
// innhenting krever modus "backfill".
//
// Element uten dato settes ikke inn i vanlig kjøring. Vi vet ikke
// om det er nytt, og 21.10-feilen var nettopp at ukjent alder ble
// behandlet som nytt. Stortingets ventede saker har bare månedsnavn
// og rammes av samme regel. De tas inn med modus "backfill".
// feil_manglende_frist teller som vellykket henting: feeden ble lest,
// alarmen gjelder tom frist, og grensen skal ikke bli stående åpen.

import { kildeNokkel, kildePublisertIso } from "./logikk.ts";

export const KILDE_DATO_MARGIN_MS = 72 * 60 * 60 * 1000;

export const VELLYKKEDE_KJORING_STATUSER = [
  "ok",
  "ok_nye",
  "ok_ingen_nye",
  "tom",
  "feil_manglende_frist",
] as const;

export type Kjoeringstype = "vanlig" | "backfill";

export type KjoertAvKilde = "supabase_cron" | "vercel_cron" | "manuell";

export function grenseForKilde(
  sisteVellykket: string | null,
  nå: number,
  marginMs = KILDE_DATO_MARGIN_MS,
): number {
  const siste = sisteVellykket ? Date.parse(sisteVellykket) : Number.NaN;
  const anker = Number.isNaN(siste) ? nå : siste;
  return anker - marginMs;
}

export type DatofilterItem = {
  adapter?: string | null;
  kilde_publisert?: string | null;
  publisert_dato?: string | null;
};

/**
 * Vanlig kjøring: eldre enn grensen hoppes over, og element uten dato
 * hoppes over. Backfill beholder alt. Lik grense beholdes (ikke «eldre»).
 */
export function filtrerNyeEtterKildedato<T extends DatofilterItem>(
  items: T[],
  opts: {
    modus: Kjoeringstype;
    sisteVellykket: ReadonlyMap<string, string | null>;
    nå?: number;
    marginMs?: number;
  },
): { behold: T[]; forGamle: T[]; utenDato: T[] } {
  if (opts.modus === "backfill") {
    return { behold: [...items], forGamle: [], utenDato: [] };
  }
  const nå = opts.nå ?? Date.now();
  const behold: T[] = [];
  const forGamle: T[] = [];
  const utenDato: T[] = [];
  for (const item of items) {
    const iso = kildePublisertIso(item);
    const ms = iso ? Date.parse(iso) : Number.NaN;
    if (!iso || Number.isNaN(ms)) {
      utenDato.push(item);
      continue;
    }
    const siste = opts.sisteVellykket.get(item.adapter ?? "") ?? null;
    if (ms < grenseForKilde(siste, nå, opts.marginMs)) forGamle.push(item);
    else behold.push(item);
  }
  return { behold, forGamle, utenDato };
}

/**
 * Fyll bare manglende kilde_publisert. manuelt_redigert røres ikke,
 * heller ikke når feltet er tomt. Allerede satt verdi beholdes.
 */
export function planleggKildePublisertBackfill(
  items: Array<{
    kilde?: string | null;
    kilde_publisert?: string | null;
    publisert_dato?: string | null;
  }>,
  eksisterende: Array<{
    id: string;
    kilde?: string | null;
    kilde_publisert?: string | null;
    manuelt_redigert?: boolean | null;
  }>,
): Array<{ id: string; kilde_publisert: string }> {
  const etter = new Map<string, (typeof eksisterende)[number]>();
  for (const rad of eksisterende) {
    const nokkel = kildeNokkel(rad.kilde);
    if (nokkel && !etter.has(nokkel)) etter.set(nokkel, rad);
  }
  const ut: Array<{ id: string; kilde_publisert: string }> = [];
  const sett = new Set<string>();
  for (const item of items) {
    const nokkel = kildeNokkel(item.kilde);
    if (!nokkel) continue;
    const rad = etter.get(nokkel);
    if (!rad || rad.manuelt_redigert || rad.kilde_publisert) continue;
    const iso = kildePublisertIso(item);
    if (!iso || sett.has(rad.id)) continue;
    sett.add(rad.id);
    ut.push({ id: rad.id, kilde_publisert: iso });
  }
  return ut;
}

export type KjoeringAvklaring = {
  kjoeringstype: Kjoeringstype;
  spesialBackfill: boolean;
  avvist: string | null;
};

/**
 * Backfill krever manuelt kall. pg_cron og vercel_cron avvises selv om
 * bodyen ber om det, så den daglige jobben ikke kan åpne historikkvinduet.
 */
export function avklarKjoering(input: {
  kjoertAv: KjoertAvKilde;
  modus: string | null;
  backfillKode: string | null;
  forventetBackfillKode: string;
}): KjoeringAvklaring {
  const berOmBackfill = input.modus === "backfill" || !!input.backfillKode;
  if (berOmBackfill && input.kjoertAv !== "manuell") {
    return {
      kjoeringstype: "vanlig",
      spesialBackfill: false,
      avvist: "Backfill kan ikke kjøres fra cron",
    };
  }
  if (input.backfillKode) {
    if (input.backfillKode !== input.forventetBackfillKode) {
      return { kjoeringstype: "vanlig", spesialBackfill: false, avvist: "Ukjent backfill" };
    }
    return { kjoeringstype: "backfill", spesialBackfill: true, avvist: null };
  }
  if (input.modus === "backfill") {
    return { kjoeringstype: "backfill", spesialBackfill: false, avvist: null };
  }
  if (input.modus) {
    return { kjoeringstype: "vanlig", spesialBackfill: false, avvist: "Ukjent modus" };
  }
  return { kjoeringstype: "vanlig", spesialBackfill: false, avvist: null };
}

export function byggKildeKjoringRad(input: {
  kildeId: string;
  status: string;
  antallFunnet: number;
  antallEtterFilter: number;
  antallNye: number;
  feilmelding: string | null;
  httpStatus: number | null;
  varighetMs: number;
  kjoertAv: string;
  kjoeringstype: Kjoeringstype;
}): Record<string, unknown> {
  return {
    kilde_id: input.kildeId,
    status: input.status,
    antall_funnet: input.antallFunnet,
    antall_etter_filter: input.antallEtterFilter,
    antall_nye: input.antallNye,
    feilmelding: input.feilmelding,
    http_status: input.httpStatus,
    varighet_ms: input.varighetMs,
    kjoert_av: input.kjoertAv,
    kjoeringstype: input.kjoeringstype,
  };
}
