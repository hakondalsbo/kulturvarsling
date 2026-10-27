// Ren status for oppdater-frister. Ingen nettverk og ingen skriving.
// Fristen styrer når den er satt. Ellers brukes møtedato. Uten begge
// blir status normal. Vinduene er de samme kalenderdagene som før:
// passert før i dag, 0–7 dager, 8–21 dager, og lenger frem.

import { addIsoDager } from "../hent-saker/frister.ts";

export type FristStatus = "kritisk" | "viktig" | "normal" | "passert";

export type FristStatusInndata = {
  frist?: string | null;
  motedato?: string | null;
  handling?: string | null;
  kategori?: string | null;
};

/**
 * Tungt kulturpolitisk betyr kulturpolitikk, ikke et fag.
 *
 * KATEGORIER er scenekunst, musikk, dans, opera, litteratur, film,
 * visuell, museer, spill, kulturarv og kulturpolitikk. De ti første
 * er fagområder. kulturpolitikk er samlekategorien for tilskudd,
 * budsjett og økonomiplan uten ett navngitt fag, og for ordninger
 * som spenner over flere fag. Kulturarv er et fag («Kulturarv og bygg»),
 * på linje med museer, og er ikke med.
 */
export const TUNGT_KULTURPOLITISKE_KATEGORIER = ["kulturpolitikk"] as const;

export function erTungtKulturpolitisk(kategori: string | null | undefined): boolean {
  return !!kategori && (TUNGT_KULTURPOLITISKE_KATEGORIER as readonly string[]).includes(kategori);
}

function harDato(verdi: string | null | undefined): boolean {
  return verdi != null && String(verdi).trim() !== "";
}

function isoDato(verdi: string | null | undefined): string | null {
  if (!harDato(verdi)) return null;
  const iso = String(verdi).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

/**
 * Status for én rad. Kaller ikke filteret manuelt_redigert; det ligger
 * i jobben og skal ikke endres.
 *
 * kritisk krever handling_mulig og at den styrende datoen er i dag
 * eller innen 7 dager (samme grense som lte i dag + 7).
 * Innen det vinduet er bare_orientering, null og annen handling
 * høyst normal. Unntaket er tungt kulturpolitisk kategori, som blir viktig.
 * Passert og vinduene etter dag 7 er uendret.
 */
export function beregnFristStatus(rad: FristStatusInndata, idag: string): FristStatus {
  const dato = harDato(rad.frist) ? isoDato(rad.frist) : isoDato(rad.motedato);
  if (!dato) return "normal";
  if (dato < idag) return "passert";
  const om7 = addIsoDager(idag, 7);
  if (dato <= om7) {
    if (rad.handling === "handling_mulig") return "kritisk";
    if (erTungtKulturpolitisk(rad.kategori)) return "viktig";
    return "normal";
  }
  if (dato <= addIsoDager(idag, 21)) return "viktig";
  return "normal";
}
