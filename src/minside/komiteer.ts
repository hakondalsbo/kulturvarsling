export type Komite = { id: string; navn: string; needle: string };

/**
 * Instans-teksten på Stortinget-saker er «Familie- og kulturkomiteen, Stortinget».
 * Nålen må treffe den, og ikke et kommunalt utvalg som bare nevner finans.
 */
export const KOMITEER: Komite[] = [
  { id: "famkult", navn: "Familie- og kulturkomiteen", needle: "Familie- og kulturkomiteen" },
  { id: "finans", navn: "Finanskomiteen", needle: "Finanskomiteen" },
  { id: "naering", navn: "Næringskomiteen", needle: "Næringskomiteen" },
  { id: "utdanning", navn: "Utdannings- og forskningskomiteen", needle: "Utdannings- og forskningskomiteen" },
];

export const KOMITE_IDER = KOMITEER.map((k) => k.id);

export function komiteNavn(id: string): string {
  return KOMITEER.find((k) => k.id === id)?.navn ?? id;
}
