/** Felles fristlogikk for «Alle frister» og «Haster». Status alene gjør ikke en sak hastende. */

export type FristTilstand = "uten" | "passert" | "haster" | "snart" | "senere";

export function dagerTilFrist(frist: string | null | undefined, nå = new Date()): number | null {
  if (!frist) return null;
  const iso = String(frist).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const fristDag = new Date(`${iso}T12:00:00`);
  const iDag = new Date(nå.getFullYear(), nå.getMonth(), nå.getDate(), 12);
  return Math.round((fristDag.getTime() - iDag.getTime()) / 86400000);
}

export function fristTilstand(
  sak: { frist?: string | null; status?: string | null },
  nå = new Date(),
): FristTilstand {
  const dager = dagerTilFrist(sak.frist, nå);
  if (dager == null) return sak.status === "passert" ? "passert" : "uten";
  if (dager < 0 || sak.status === "passert") return "passert";
  if (dager <= 7) return "haster";
  if (dager <= 21) return "snart";
  return "senere";
}

export function erHasterSak(
  sak: { frist?: string | null; status?: string | null },
  nå = new Date(),
): boolean {
  return fristTilstand(sak, nå) === "haster";
}

export function fristEtikett(
  sak: { frist?: string | null; status?: string | null; dager?: number | null },
  nå = new Date(),
): string {
  const tilstand = fristTilstand(sak, nå);
  if (tilstand === "passert") return "Passert";
  if (tilstand === "uten") return "Ingen frist";
  const dager = dagerTilFrist(sak.frist, nå);
  if (dager === 0) return "I dag";
  if (dager === 1) return "1d igjen";
  return `${dager}d igjen`;
}
