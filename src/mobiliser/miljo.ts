import { panelVises, signaturMottakAktiv, signaturVises, type MobiliserMiljo } from "./kjerne.ts";

export function lesMiljo(): MobiliserMiljo {
  return {
    vercelEnv: import.meta.env.VITE_VERCEL_ENV,
    signaturEksplisitt: import.meta.env.VITE_MOBILISERING_SIGNATUR_AKTIV,
    panelEksplisitt: import.meta.env.VITE_MOBILISER_PANEL_AKTIV,
    demo: import.meta.env.VITE_MOBILISER_DEMO,
  };
}

export function panelErSynlig(): boolean {
  return panelVises(lesMiljo());
}

export function signaturErSynlig(): boolean {
  return signaturVises(lesMiljo());
}

/** Samme krav som serveren. Preview åpner ikke skjemaet. */
export function signaturKanSigneres(): boolean {
  return signaturMottakAktiv(import.meta.env.VITE_MOBILISERING_SIGNATUR_AKTIV);
}

export function renSti(pathname: string): string {
  return pathname.split("?")[0].replace(/\/+$/, "") || "/";
}

export function erMobiliserSti(pathname: string): boolean {
  return renSti(pathname) === "/mobiliser";
}
