// Datogrense for vanlige kjøringer. Ingen nettverk.
//
// Filteret gjelder bare der datoen er kildens publiseringstid:
// regjeringen-rss, sametinget og einnsyn. Kulturdirektoratets rundedato,
// Bergens møtedato og Stortingets ventede saker (uten tidsstempel) er
// ikke det, og stoppes ikke her. Dedup på kilde-URL holder for dem.
// Stortingets saker har sist_oppdatert, men hele sesjonen er korpuset
// og URL-en er stabil, så de får heller ingen grense.
//
// Marginen er 72 timer under siste vellykkede hent-saker-kjøring.
// Cron er døgnlig. Én feilet natt, RSS som viser pubDate noen timer
// før elementet ligger i feeden, og 1–2 timer mellom UTC og
// Europe/Oslo, skal ikke kaste en sak som kom rett før forrige
// suksess. I tillegg har grensen et tak: den er aldri eldre enn nå
// minus 14 dager. Uten taket ble regjeringen-rss stående på siste
// suksess 11.08 helt til 20.10, og en pressemelding fra 21.09 slapp
// inn. 24 timer alene mister en lørdagssak hvis neste suksess er
// onsdag etter en feilet mandag.
//
// Vellykket er ok, ok_nye, ok_ingen_nye, tom, delvis og
// feil_manglende_frist. delvis teller fordi feeden ble lest; alarmen
// består, men vinduet skal ikke bli stående åpent. Bare rader med
// jobb hent-saker inngår. oppdater-frister skriver egne rader.
//
// Uten tidligere vellykket kjøring er ankeret «nå», så taket ikke
// åpner 14 dager med historikk på en kilde uten logg. Grensen blir
// nå minus 72 timer.
//
// Saker uten dato stoppes ikke. De telles. Unntak: et RSS-element
// uten pubDate (regjeringen-rss og sametinget) stoppes, for der er
// manglende dato nettopp det som gjorde gamle saker «nye».

import { kildeNokkel, kildePublisertIso } from "./logikk.ts";

export const KILDE_DATO_MARGIN_MS = 72 * 60 * 60 * 1000;

/** Grensen blir aldri eldre enn dette, selv om siste suksess er eldre. */
export const GRENSE_MAKS_ALDER_MS = 14 * 24 * 60 * 60 * 1000;

export const PUBLISERINGSKILDER = ["regjeringen-rss", "sametinget", "einnsyn"] as const;

/** RSS uten pubDate kan stoppes. Andre kilder uten dato beholdes. */
export const RSS_KILDER = ["regjeringen-rss", "sametinget"] as const;

export const VELLYKKEDE_KJORING_STATUSER = [
  "ok",
  "ok_nye",
  "ok_ingen_nye",
  "tom",
  "delvis",
  "feil_manglende_frist",
] as const;

export type Kjoeringstype = "vanlig" | "backfill";

export type KildeJobb = "hent-saker" | "oppdater-frister";

export type KjoertAvKilde = "supabase_cron" | "vercel_cron" | "manuell";

const PUBLISERING = new Set<string>(PUBLISERINGSKILDER);
const RSS = new Set<string>(RSS_KILDER);

export function grenseForKilde(
  sisteVellykket: string | null,
  nå: number,
  marginMs = KILDE_DATO_MARGIN_MS,
): number {
  const siste = sisteVellykket ? Date.parse(sisteVellykket) : Number.NaN;
  const anker = Number.isNaN(siste) ? nå : siste;
  const fraAnker = anker - marginMs;
  const tak = nå - GRENSE_MAKS_ALDER_MS;
  return Math.max(fraAnker, tak);
}

export type DatofilterItem = {
  adapter?: string | null;
  kilde_publisert?: string | null;
  publisert_dato?: string | null;
};

export type DatofilterUtfall<T> = {
  behold: T[];
  forGamle: T[];
  /** Uten dato, og beholdt. Telles, stoppes ikke. */
  utenDato: T[];
  /** RSS uten pubDate. Telles og stoppes. */
  stoppetUtenPubDate: T[];
};

/**
 * Vanlig kjøring: publiseringskilder eldre enn grensen hoppes over.
 * Lik grense beholdes. Backfill beholder alt. Andre adaptere beholdes
 * uansett dato.
 */
export function filtrerNyeEtterKildedato<T extends DatofilterItem>(
  items: T[],
  opts: {
    modus: Kjoeringstype;
    sisteVellykket: ReadonlyMap<string, string | null>;
    nå?: number;
    marginMs?: number;
  },
): DatofilterUtfall<T> {
  if (opts.modus === "backfill") {
    return { behold: [...items], forGamle: [], utenDato: [], stoppetUtenPubDate: [] };
  }
  const nå = opts.nå ?? Date.now();
  const behold: T[] = [];
  const forGamle: T[] = [];
  const utenDato: T[] = [];
  const stoppetUtenPubDate: T[] = [];
  for (const item of items) {
    const adapter = item.adapter ?? "";
    const iso = kildePublisertIso(item);
    const ms = iso ? Date.parse(iso) : Number.NaN;
    const harDato = !!iso && !Number.isNaN(ms);
    if (!PUBLISERING.has(adapter)) {
      if (!harDato) utenDato.push(item);
      behold.push(item);
      continue;
    }
    if (!harDato) {
      if (RSS.has(adapter)) stoppetUtenPubDate.push(item);
      else {
        utenDato.push(item);
        behold.push(item);
      }
      continue;
    }
    const siste = opts.sisteVellykket.get(adapter) ?? null;
    if (ms < grenseForKilde(siste, nå, opts.marginMs)) forGamle.push(item);
    else behold.push(item);
  }
  return { behold, forGamle, utenDato, stoppetUtenPubDate };
}

export type DatofilterTall = {
  adapter: string;
  beholdt: number;
  stoppet: number;
  uten_dato: number;
};

/** Per adapter: beholdt, stoppet (for gammel eller RSS uten pubDate), og uten dato (beholdt eller stoppet). */
export function tellDatofilter<T extends DatofilterItem>(
  ut: DatofilterUtfall<T>,
): DatofilterTall[] {
  const per = new Map<string, DatofilterTall>();
  const rad = (adapter: string | null | undefined) => {
    const navn = adapter || "ukjent";
    let tall = per.get(navn);
    if (!tall) {
      tall = { adapter: navn, beholdt: 0, stoppet: 0, uten_dato: 0 };
      per.set(navn, tall);
    }
    return tall;
  };
  for (const item of ut.behold) rad(item.adapter).beholdt++;
  for (const item of ut.forGamle) rad(item.adapter).stoppet++;
  for (const item of ut.stoppetUtenPubDate) {
    const tall = rad(item.adapter);
    tall.stoppet++;
    tall.uten_dato++;
  }
  for (const item of ut.utenDato) rad(item.adapter).uten_dato++;
  return [...per.values()];
}

/**
 * Fyll bare manglende kilde_publisert der adapteren har satt et
 * tidsstempel. publisert_dato alene (møtedato, rundedato) skrives ikke.
 * manuelt_redigert røres ikke. Allerede satt verdi beholdes.
 */
export function planleggKildePublisertBackfill(
  items: Array<{
    kilde?: string | null;
    kilde_publisert?: string | null;
    /** Møtedato eller rundedato. Leses ikke. Bare et ekte tidsstempel fylles. */
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
    if (!item.kilde_publisert) continue;
    const nokkel = kildeNokkel(item.kilde);
    if (!nokkel) continue;
    const rad = etter.get(nokkel);
    if (!rad || rad.manuelt_redigert || rad.kilde_publisert) continue;
    const iso = kildePublisertIso({ kilde_publisert: item.kilde_publisert });
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
  jobb: KildeJobb;
  /** Frist- og møtedatoendringer. Ikke nye varsler. Bare oppdater-frister. */
  antallOppdatert?: number | null;
}): Record<string, unknown> {
  const fristjobb = input.jobb === "oppdater-frister";
  return {
    kilde_id: input.kildeId,
    status: input.status,
    antall_funnet: input.antallFunnet,
    antall_etter_filter: input.antallEtterFilter,
    antall_nye: fristjobb ? 0 : input.antallNye,
    antall_oppdatert: fristjobb ? (input.antallOppdatert ?? 0) : null,
    feilmelding: input.feilmelding,
    http_status: input.httpStatus,
    varighet_ms: input.varighetMs,
    kjoert_av: input.kjoertAv,
    kjoeringstype: input.kjoeringstype,
    jobb: input.jobb,
  };
}
