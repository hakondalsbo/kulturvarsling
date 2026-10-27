// Ren status for oppdater-frister. Ingen nettverk og ingen skriving.
// Fristen styrer når den er satt. Ellers brukes møtedato. Uten gyldig
// dato blir status normal. En nærmere dato gir aldri lavere status
// enn en dato lenger frem. Passert gjelder først når datoen er før i dag.

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
 * handling_mulig: 0–7 dager er kritisk, 8–21 er viktig, senere normal.
 * bare_orientering og null: 0–21 dager er viktig bare for kulturpolitikk,
 * ellers normal. Senere er normal. Nærmere dato senker ikke statusen.
 */
export function beregnFristStatus(rad: FristStatusInndata, idag: string): FristStatus {
  const dato = harDato(rad.frist) ? isoDato(rad.frist) : isoDato(rad.motedato);
  if (!dato) return "normal";
  if (dato < idag) return "passert";
  const om7 = addIsoDager(idag, 7);
  const om21 = addIsoDager(idag, 21);
  if (rad.handling === "handling_mulig") {
    if (dato <= om7) return "kritisk";
    if (dato <= om21) return "viktig";
    return "normal";
  }
  if (dato <= om21 && erTungtKulturpolitisk(rad.kategori)) return "viktig";
  return "normal";
}
