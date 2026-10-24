// Vern av redaktørfelt. Backfill, klartekst, fristoppdatering og
// backfill-geografi skal bruke oppdaterVarsel før de skriver til varsler.
// manuelt_redigert stenger tittel, sammendrag, kategori, frist, møtedato
// og status, også når feltet er tomt. kilde_id kan fortsatt fylles fra NULL
// i backfill-migrasjonen. Disse fem godkjente radene er stengt selv om
// flagget skulle mangle.

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

const REDAKTOR_FELT = ["tittel", "sammendrag", "kategori", "frist", "motedato", "status"] as const;

export type VarselVern = {
  id?: string;
  frist?: string | null;
  sammendrag?: string | null;
  manuelt_redigert?: boolean | null;
};

export function erRedaktorFeltLaast(id: string | null | undefined): boolean {
  return !!id && REDAKTOR_FELT_LAAS_SETT.has(id);
}

function erAutomatiskFeltStengt(rad: VarselVern): boolean {
  return erRedaktorFeltLaast(rad.id) || !!rad.manuelt_redigert;
}

/** Redaktørrad får ikke frist, heller ikke når feltet er tomt. */
export function skalSkriveFrist(rad: VarselVern): boolean {
  return !erAutomatiskFeltStengt(rad);
}

/** Redaktørrad får ikke møtedato, heller ikke når feltet er tomt. */
export function skalSkriveMotedato(rad: VarselVern): boolean {
  return !erAutomatiskFeltStengt(rad);
}

/** Deterministisk status gjelder bare rader redaktøren ikke har tatt. */
export function skalSkriveStatus(rad: VarselVern): boolean {
  return !erAutomatiskFeltStengt(rad);
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
  // Fase settes av varselredaktøren via sett_varsel_fase, aldri av jobb.
  delete kopi.fase;
  if (erRedaktorFeltLaast(eksisterende.id)) {
    for (const felt of REDAKTOR_FELT) delete kopi[felt];
    return kopi as Partial<T>;
  }
  if (!eksisterende.manuelt_redigert || erDataspillKorreksjon(eksisterende)) {
    return kopi as Partial<T>;
  }
  for (const felt of REDAKTOR_FELT) delete kopi[felt];
  return kopi as Partial<T>;
}
