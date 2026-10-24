import { dagerTilFrist } from "../frist.ts";
import { vurderSak, type SakForVurdering } from "../handling.ts";
import { sakTrefferAbonnement, sokTrefferSak, type SakTreff } from "../preferanser.ts";

export type MinSak = SakTreff & SakForVurdering & {
  id: string | number;
  status?: string | null;
  kilde?: string | null;
  instans?: string | null;
  tittel?: string | null;
  sammendrag?: string | null;
  handling?: "handling_mulig" | "bare_orientering" | null;
};

export type MinValg = {
  fagfelt: string[];
  geografisk: string[];
  organ: string[];
  komiteer: string[];
  varslerAktive: boolean;
};

export type LagretSok = { id: string; navn: string; sporretekst: string };

export const TOMT_VALG: MinValg = {
  fagfelt: [],
  geografisk: [],
  organ: [],
  komiteer: [],
  varslerAktive: false,
};

export function harAvgrensning(valg: MinValg): boolean {
  return valg.fagfelt.length > 0
    || valg.geografisk.length > 0
    || valg.organ.length > 0
    || valg.komiteer.length > 0;
}

export function erMedIFeeden(sak: MinSak, valg: MinValg, fulgte: Array<string | number>, sok: LagretSok[]): boolean {
  if (fulgte.some((id) => String(id) === String(sak.id))) return true;
  if (sok.some((s) => sokTrefferSak(sak, s.sporretekst))) return true;
  if (!valg.varslerAktive) return false;
  return sakTrefferAbonnement(sak, valg.fagfelt, valg.geografisk, {
    organ: valg.organ,
    komiteer: valg.komiteer,
  });
}

function fristSort(a: MinSak, b: MinSak, nå: Date): number {
  const da = dagerTilFrist(a.frist, nå);
  const db = dagerTilFrist(b.frist, nå);
  const ra = da == null ? 10_000 : da;
  const rb = db == null ? 10_000 : db;
  if (ra !== rb) return ra - rb;
  return String(a.tittel || "").localeCompare(String(b.tittel || ""), "nb");
}

export type MinSideDeler = {
  mobiliser: MinSak[];
  handling: MinSak[];
  frister: MinSak[];
  strom: MinSak[];
  fulgte: MinSak[];
  alle: MinSak[];
};

/** Øverst mobiliser, handling mulig og frister. Strømmen er resten. Fulgte saker listes til slutt uansett. */
export function delMinSide(
  saker: MinSak[],
  valg: MinValg,
  fulgte: Array<string | number>,
  sok: LagretSok[],
  nå: Date,
): MinSideDeler {
  const alle = saker.filter((s) => erMedIFeeden(s, valg, fulgte, sok));
  const mobiliser = alle.filter((s) => vurderSak(s, nå).mobiliserNaa).sort((a, b) => fristSort(a, b, nå));
  const mobiliserId = new Set(mobiliser.map((s) => String(s.id)));
  const handling = alle
    .filter((s) => s.handling === "handling_mulig" && !mobiliserId.has(String(s.id)))
    .sort((a, b) => fristSort(a, b, nå));
  const vist = new Set([...mobiliserId, ...handling.map((s) => String(s.id))]);
  const frister = alle
    .filter((s) => {
      if (vist.has(String(s.id))) return false;
      const d = dagerTilFrist(s.frist, nå);
      return d != null && d >= 0;
    })
    .sort((a, b) => fristSort(a, b, nå));
  const topp = new Set([...vist, ...frister.map((s) => String(s.id))]);
  const strom = alle.filter((s) => !topp.has(String(s.id)));
  const fulgtListe = alle.filter((s) => fulgte.some((id) => String(id) === String(s.id)));
  return { mobiliser, handling, frister, strom, fulgte: fulgtListe, alle };
}

export function apentAbonnement(valg: MinValg): boolean {
  return valg.varslerAktive && !harAvgrensning(valg);
}
