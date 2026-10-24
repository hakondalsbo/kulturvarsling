import type { VarselHandling } from "./avis.tsx";
import { dagerTilFrist } from "./frist.ts";

/**
 * Skiller saker man kan gjøre noe med fra saker til orientering.
 * Når konsekvensfeltene fra PR #13 finnes og har nok sikkerhet, brukes de.
 * Ellers avledes merket fra frist og status, så kallstedene kan bli stående
 * når kolonnene kommer i prod.
 */

export const KONSEKVENS_VERDIER = [
  "kutt_innstramming",
  "stor_endring",
  "ny_mulighet",
  "til_orientering",
] as const;

export type Konsekvens = (typeof KONSEKVENS_VERDIER)[number];

export const KONSEKVENS_NAVN: Record<Konsekvens, string> = {
  kutt_innstramming: "Kutt og innstramming",
  stor_endring: "Stor endring for bransjen",
  ny_mulighet: "Ny mulighet",
  til_orientering: "Til orientering",
};

/** Samme vindu som i konsekvens-arbeidet: i dag og 21 dager frem. */
export const MOBILISER_DAGER = 21;

export type HandlingFilter = "alle" | "handling" | "orientering" | "mobiliser";

export type SakForVurdering = {
  konsekvens?: string | null;
  konsekvens_sikkerhet?: string | null;
  mobiliser_dato?: string | null;
  frist?: string | null;
  status?: string | null;
  tittel?: string | null;
  sammendrag?: string | null;
  /** public.varsler.handling. Null faller tilbake på frist eller høring. */
  handling?: VarselHandling | null;
};

export type Vurdering = {
  /** "felt" når varsler.handling er satt. Ellers konsekvens eller avledning. */
  kilde: "felt" | "konsekvens" | "avledet";
  handlingsrettet: boolean;
  mobiliserNaa: boolean;
  merke: string | null;
  konsekvens: Konsekvens | null;
};

const APEN_STATUS = new Set([
  "høring",
  "horing",
  "høyring",
  "åpen",
  "apen",
  "open",
  "aktiv",
]);

export function osloDato(nå: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(nå);
}

export function leggTilDager(iso: string, dager: number): string {
  const [år, mnd, dag] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(år, mnd - 1, dag + dager));
  return dt.toISOString().slice(0, 10);
}

export function gyldigIsoDato(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [år, mnd, dag] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(år, mnd - 1, dag));
  return dt.getUTCFullYear() === år && dt.getUTCMonth() === mnd - 1 && dt.getUTCDate() === dag;
}

export function erMobiliserNaa(dato: string | null | undefined, iDag: string): boolean {
  if (!dato || !gyldigIsoDato(dato) || !gyldigIsoDato(iDag)) return false;
  if (dato < iDag) return false;
  return dato <= leggTilDager(iDag, MOBILISER_DAGER);
}

export function erKonsekvens(verdi: unknown): verdi is Konsekvens {
  return typeof verdi === "string" && (KONSEKVENS_VERDIER as readonly string[]).includes(verdi);
}

/** Lav sikkerhet vises ikke, samme regel som i konsekvens-arbeidet. */
export function synligKonsekvens(sak: {
  konsekvens?: string | null;
  konsekvens_sikkerhet?: string | null;
}): Konsekvens | null {
  if (!erKonsekvens(sak.konsekvens)) return null;
  if (sak.konsekvens_sikkerhet === "lav") return null;
  return sak.konsekvens;
}

function erHoring(sak: SakForVurdering): boolean {
  const status = (sak.status || "").toLowerCase().trim();
  if (APEN_STATUS.has(status)) return true;
  const tekst = `${sak.tittel || ""} ${sak.sammendrag || ""}`.toLowerCase();
  return /høring|høyring|hoyring/.test(tekst);
}

function fristFremover(sak: SakForVurdering, nå: Date): boolean {
  if ((sak.status || "").toLowerCase() === "passert") return false;
  const dager = dagerTilFrist(sak.frist, nå);
  return dager != null && dager >= 0;
}

function isoFrist(sak: SakForVurdering): string | null {
  if (!sak.frist) return null;
  const iso = String(sak.frist).slice(0, 10);
  return gyldigIsoDato(iso) ? iso : null;
}

function handlingsmerke(mobiliserNaa: boolean, horing: boolean): string {
  if (mobiliserNaa) return "Mobiliser nå";
  if (horing) return "Høring";
  return "Frist";
}

export function vurderSak(sak: SakForVurdering, nå: Date = new Date()): Vurdering {
  const iDag = osloDato(nå);
  const synlig = synligKonsekvens(sak);
  const frem = fristFremover(sak, nå);
  const horing = erHoring(sak);
  const frist = isoFrist(sak);
  const eksplisitt = sak.mobiliser_dato && gyldigIsoDato(sak.mobiliser_dato) ? sak.mobiliser_dato : null;
  const dato = eksplisitt ?? (frem ? frist : null);
  const mobiliserNaa = erMobiliserNaa(dato, iDag);
  const kanGjores = mobiliserNaa || frem || horing;
  const felt = sak.handling === "handling_mulig" || sak.handling === "bare_orientering" ? sak.handling : null;

  if (felt === "bare_orientering") {
    return {
      kilde: "felt",
      handlingsrettet: false,
      mobiliserNaa: false,
      merke: synlig && synlig !== "til_orientering" ? KONSEKVENS_NAVN[synlig] : null,
      konsekvens: synlig,
    };
  }

  if (felt === "handling_mulig") {
    return {
      kilde: "felt",
      handlingsrettet: true,
      mobiliserNaa,
      merke: mobiliserNaa || horing || frem ? handlingsmerke(mobiliserNaa, horing) : "Du kan gjøre noe",
      konsekvens: synlig,
    };
  }

  if (synlig) {
    return {
      kilde: "konsekvens",
      handlingsrettet: kanGjores,
      mobiliserNaa: kanGjores && mobiliserNaa,
      merke: kanGjores
        ? handlingsmerke(mobiliserNaa, horing)
        : synlig === "til_orientering"
          ? null
          : KONSEKVENS_NAVN[synlig],
      konsekvens: synlig,
    };
  }

  return {
    kilde: "avledet",
    handlingsrettet: kanGjores,
    mobiliserNaa: kanGjores && mobiliserNaa,
    merke: kanGjores ? handlingsmerke(mobiliserNaa, horing) : null,
    konsekvens: null,
  };
}

/** Kutt med frist først, deretter mobiliser-vinduet, deretter andre frister. */
export function forsidePrioritet(sak: SakForVurdering, nå: Date = new Date()): number {
  const v = vurderSak(sak, nå);
  if (v.konsekvens === "kutt_innstramming" && v.handlingsrettet) return 0;
  if (v.mobiliserNaa) return 1;
  if (v.handlingsrettet) return 2;
  if (v.konsekvens === "kutt_innstramming") return 3;
  return 4;
}

export function matcherHandling(sak: SakForVurdering, filter: HandlingFilter, nå: Date = new Date()): boolean {
  if (filter === "alle") return true;
  const v = vurderSak(sak, nå);
  if (filter === "handling") return v.handlingsrettet;
  if (filter === "orientering") return !v.handlingsrettet;
  return v.mobiliserNaa;
}
