// Vern av redaktørens tekst. Backfill, klartekst, fristoppdatering og
// backfill-geografi skal bruke oppdaterVarsel før de skriver til varsler.
// Tittel, sammendrag og kategori låses når manuelt_redigert er satt.
// Frist og andre felt kan fortsatt fylles inn.

export const AVVIST_SAMMENDRAG = "Automatisk avvist av relevansfilteret";

export const DATASPILL_VARSEL_ID = "90a26730-e886-4a10-a1e5-a08aedaabd17";

const TEKSTFELT = ["tittel", "sammendrag", "kategori"] as const;

export type VarselVern = {
  id?: string;
  sammendrag?: string | null;
  manuelt_redigert?: boolean | null;
};

/**
 * Dataspillhøringen ble lagret upublisert med avvisningsteksten. Den ene
 * korreksjonen får skrive sammendrag selv om flagget alt er satt. Etterpå
 * gjelder vernet som vanlig.
 */
export function erDataspillKorreksjon(rad: VarselVern): boolean {
  return rad.id === DATASPILL_VARSEL_ID && rad.sammendrag === AVVIST_SAMMENDRAG;
}

export function oppdaterVarsel<T extends Record<string, unknown>>(
  eksisterende: VarselVern,
  endring: T,
): Partial<T> {
  if (!eksisterende.manuelt_redigert || erDataspillKorreksjon(eksisterende)) {
    return { ...endring };
  }
  const kopi: Record<string, unknown> = { ...endring };
  for (const felt of TEKSTFELT) delete kopi[felt];
  return kopi as Partial<T>;
}
