// Verdien styres av én linje i public/organisasjon.js.
import { behandlingsansvarlig, orgnr } from "../../../public/organisasjon.js";

export { behandlingsansvarlig, orgnr };

const POSTKASSE = "nyhetsbrev@kulturvarsling.no";

/** Avsender med visningsnavnet fra konfigurasjonen. E-postdelen kan komme fra AVSENDER. */
export function avsender(navn: string, eksisterende?: string | null): string {
  const fraHemmelighet = eksisterende?.match(/<([^<>\s]+)>/)?.[1]
    ?? (eksisterende && /^[^\s<>]+@[^\s<>]+$/.test(eksisterende.trim())
      ? eksisterende.trim()
      : null);
  const epost = fraHemmelighet ?? POSTKASSE;
  const trygg = navn.replace(/["\r\n]/g, "").trim() || behandlingsansvarlig;
  return `"${trygg}" <${epost}>`;
}

export function bunntekst(navn: string): string {
  return `Behandlingsansvarlig: ${navn}.`;
}
