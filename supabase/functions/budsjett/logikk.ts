export const BUDSJETT_CACHE_VERSJON = "kostra-2021-2025-cofog-2020-2024-v2";
const UKE = 7 * 86400000;
export function lesBudsjettCache(verdi: unknown, nå = Date.now()): Record<string, unknown> | null {
  if (!verdi || typeof verdi !== "object") return null;
  const data = verdi as Record<string, unknown>;
  if (data._versjon !== BUDSJETT_CACHE_VERSJON || typeof data._hentet !== "number") return null;
  const alder = nå - data._hentet;
  // Uten AI-tolkning gjenbrukes tallene i fem minutter for å unngå feilkostnadsløkker.
  const levetid = data.tolkning ? UKE : 5 * 60000;
  if (alder < 0 || alder >= levetid || !Array.isArray(data.nøkkeltall)) return null;
  const svar = { ...data };
  delete svar._versjon;
  delete svar._hentet;
  return svar;
}
export function pakkBudsjettCache(svar: Record<string, unknown>, nå = Date.now()) {
  return { ...svar, _versjon: BUDSJETT_CACHE_VERSJON, _hentet: nå };
}
export function budsjettNokkel(body: Record<string, unknown>): string | null {
  if (body.nasjonalt === true) return "nasjonalt";
  if (typeof body.fylkesnr === "string" && /^(03|11|15|18|31|32|33|34|39|40|42|46|50|55|56)$/.test(body.fylkesnr)) return `fylke-${body.fylkesnr}`;
  if (body.fylkesnr !== undefined) return null;
  return typeof body.kommunenr === "string" && /^\d{4}$/.test(body.kommunenr) ? `kommune-${body.kommunenr}` : null;
}

export function summerTilgjengeligeTall(verdier: Array<number | null>): number | null {
  return verdier.length > 0 && verdier.every((v) => v !== null && Number.isFinite(v))
    ? verdier.reduce<number>((sum, verdi) => sum + (verdi as number), 0) : null;
}

export function parseBudsjettTolkning(verdi: unknown): Record<string, string> | null {
  if (!verdi || typeof verdi !== "object" || Array.isArray(verdi)) return null;
  const rå = verdi as Record<string, unknown>;
  const felter = ["overskrift", "hovedtall", "skjulte_kutt", "hva_betyr_det", "sporsmaal_til_politikerne"];
  if (felter.some((felt) => typeof rå[felt] !== "string" || !(rå[felt] as string).trim())) return null;
  return Object.fromEntries(felter.map((felt) => [felt, (rå[felt] as string).trim().slice(0, 2000)]));
}
