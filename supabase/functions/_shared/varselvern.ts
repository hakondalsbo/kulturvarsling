// Vern av redaktørfelt. Backfill, klartekst, fristoppdatering og
// backfill-geografi skal bruke oppdaterVarsel før de skriver til varsler.
// Tittel, sammendrag og kategori låses når manuelt_redigert er satt.
// Tom frist kan fylles på andre redaktørrader. Satt frist og status skal
// ikke overskrives. De to godkjente radene under skrives aldri.

export const AVVIST_SAMMENDRAG = "Automatisk avvist av relevansfilteret";

export const DATASPILL_VARSEL_ID = "90a26730-e886-4a10-a1e5-a08aedaabd17";

/** Godkjent i prod 2026-10-20. Ikke skriv frist, status eller kategori. */
export const REDAKTOR_FELT_LAAS = [
  "80653f79-b471-49ed-b7c3-e98a118531af",
  "1cf0dfd3-4fc8-4fc0-976f-d733db4b7aae",
] as const;

const REDAKTOR_FELT_LAAS_SETT = new Set<string>(REDAKTOR_FELT_LAAS);

const TEKSTFELT = ["tittel", "sammendrag", "kategori"] as const;

export type VarselVern = {
  id?: string;
  frist?: string | null;
  sammendrag?: string | null;
  manuelt_redigert?: boolean | null;
};

export function erRedaktorFeltLaast(id: string | null | undefined): boolean {
  return !!id && REDAKTOR_FELT_LAAS_SETT.has(id);
}

/** Satt frist på en redaktørrad overskrives ikke. De to godkjente radene hoppes over helt. */
export function skalSkriveFrist(rad: VarselVern): boolean {
  if (erRedaktorFeltLaast(rad.id)) return false;
  if (rad.manuelt_redigert && rad.frist) return false;
  return true;
}

/** Deterministisk status gjelder bare rader redaktøren ikke har tatt. */
export function skalSkriveStatus(rad: VarselVern): boolean {
  if (erRedaktorFeltLaast(rad.id)) return false;
  if (rad.manuelt_redigert) return false;
  return true;
}

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
