// Vern av redaktørfelt. Backfill, klartekst, fristoppdatering og
// backfill-geografi skal bruke oppdaterVarsel før de skriver til varsler.
// Tittel, sammendrag og kategori låses når manuelt_redigert er satt.
// Tom frist kan fylles på andre redaktørrader. Satt frist og status skal
// ikke overskrives. Disse fem godkjente radene får aldri ny tittel,
// sammendrag, kategori, frist eller status.

export const AVVIST_SAMMENDRAG = "Automatisk avvist av relevansfilteret";

export const DATASPILL_VARSEL_ID = "90a26730-e886-4a10-a1e5-a08aedaabd17";

/** Godkjent i prod. Ikke skriv tittel, sammendrag, kategori, frist eller status. */
export const REDAKTOR_FELT_LAAS = [
  "80653f79-b471-49ed-b7c3-e98a118531af",
  "1cf0dfd3-4fc8-4fc0-976f-d733db4b7aae",
  "de0dc5a6-fb44-4d5c-aebd-76b9ea10c085",
  "b70f9ea5-b8f2-4a1d-8c6a-2ccf1ec4bf8c",
  "90a26730-e886-4a10-a1e5-a08aedaabd17",
] as const;

const REDAKTOR_FELT_LAAS_SETT = new Set<string>(REDAKTOR_FELT_LAAS);

const TEKSTFELT = ["tittel", "sammendrag", "kategori"] as const;
const REDAKTOR_FELT = ["tittel", "sammendrag", "kategori", "frist", "status"] as const;

export type VarselVern = {
  id?: string;
  frist?: string | null;
  sammendrag?: string | null;
  manuelt_redigert?: boolean | null;
};

export function erRedaktorFeltLaast(id: string | null | undefined): boolean {
  return !!id && REDAKTOR_FELT_LAAS_SETT.has(id);
}

/** Satt frist på en redaktørrad overskrives ikke. De fem godkjente radene hoppes over helt. */
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
  const kopi: Record<string, unknown> = { ...endring };
  if (erRedaktorFeltLaast(eksisterende.id)) {
    for (const felt of REDAKTOR_FELT) delete kopi[felt];
    return kopi as Partial<T>;
  }
  if (!eksisterende.manuelt_redigert || erDataspillKorreksjon(eksisterende)) {
    return kopi as Partial<T>;
  }
  for (const felt of TEKSTFELT) delete kopi[felt];
  return kopi as Partial<T>;
}
