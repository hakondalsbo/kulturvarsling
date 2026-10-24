import { KULTURPOLITIKK_ID, KULTURPOLITIKK_VALGBART } from "./kulturpolitikk.ts";

export type Kategori = { id: string; label: string };

/** Samme grunnliste som menyen i App.tsx bruker når flagget er av. */
export const BASIS_KATEGORIER: Kategori[] = [
  { id: "scenekunst", label: "Scenekunst" },
  { id: "musikk", label: "Musikk" },
  { id: "dans", label: "Dans" },
  { id: "opera", label: "Opera" },
  { id: "litteratur", label: "Litteratur" },
  { id: "film", label: "Film og TV" },
  { id: "visuell", label: "Visuell kunst" },
  { id: "museer", label: "Museer" },
  { id: "spill", label: "Spill" },
  { id: "kulturarv", label: "Kulturarv og bygg" },
];

export function kategorierForMeny(valgbart = KULTURPOLITIKK_VALGBART): Kategori[] {
  if (!valgbart) return BASIS_KATEGORIER;
  return [...BASIS_KATEGORIER, { id: KULTURPOLITIKK_ID, label: "Kulturpolitikk" }];
}
