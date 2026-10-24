import { synligeStotte, type StottetInnspill } from "./kjerne.ts";

export { synligeStotte };
export type { StottetInnspill };

/** Leser svaret fra edge-funksjonen mine-innspill. Ukjent form blir en tom liste. E-post tas ikke med. */
export function stotteFraSvar(svar: unknown): StottetInnspill[] {
  if (!svar || typeof svar !== "object") return [];
  const rader = (svar as { innspill?: unknown }).innspill;
  if (!Array.isArray(rader)) return [];
  const ut: StottetInnspill[] = [];
  for (const rad of rader) {
    if (!rad || typeof rad !== "object") continue;
    const felt = rad as Record<string, unknown>;
    if (typeof felt.innspillId !== "string" || typeof felt.tittel !== "string") continue;
    ut.push({
      innspillId: felt.innspillId,
      tittel: felt.tittel,
      sakId: typeof felt.sakId === "string" ? felt.sakId : null,
      bekreftet: felt.bekreftet === true,
      trukket: felt.trukket === true,
    });
  }
  return ut;
}
