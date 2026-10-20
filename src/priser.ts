// Samme beløp som stripe-checkout slår opp (99 kr/mnd og 790 kr/år).
// Beløpene skal ikke endres herfra — bare spar-prosenten utledes.

export const PREMIUM_MAANED_KR = 99;
export const PREMIUM_AAR_KR = 790;

/** Hvor mange prosent årlig koster mindre enn tolv måneder, avrundet til heltall. */
export function sparProsentArlig(maanedKr = PREMIUM_MAANED_KR, aarKr = PREMIUM_AAR_KR): number {
  const fullPris = maanedKr * 12;
  if (fullPris <= 0) return 0;
  return Math.round(((fullPris - aarKr) / fullPris) * 100);
}
