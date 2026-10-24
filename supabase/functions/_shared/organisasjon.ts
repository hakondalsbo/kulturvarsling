// Samme tre verdier som public/organisasjon.js.
// Testen «organisasjon er lik i funksjoner og nettleser» holder dem like.
// Funksjonene importerer ikke filer utenfor supabase/functions.
export const behandlingsansvarlig = "Kulturvarsling AS";

export const orgnr = "936 282 881";
export const poststed = "Middelthuns gate 11 B, 0368 Oslo";

export const STANDARD_AVSENDER_EPOST = "nyhetsbrev@kulturvarsling.no";

/** Avsender med visningsnavnet fra konfigurasjonen. E-postdelen kan komme fra AVSENDER. */
export function avsender(navn: string, eksisterende?: string | null): string {
  const fraHemmelighet = eksisterende?.match(/<([^<>\s]+)>/)?.[1]
    ?? (eksisterende && /^[^\s<>]+@[^\s<>]+$/.test(eksisterende.trim())
      ? eksisterende.trim()
      : null);
  const epost = fraHemmelighet ?? STANDARD_AVSENDER_EPOST;
  const trygg = navn.replace(/["\r\n]/g, "").trim() || behandlingsansvarlig;
  return `"${trygg}" <${epost}>`;
}

/** Leser AVSENDER. Tom eller manglende verdi blir nyhetsbrev@kulturvarsling.no. */
export function lesAvsender(
  navn: string,
  miljo: { get(nokkel: string): string | undefined } | null | undefined,
): string {
  return avsender(navn, miljo?.get("AVSENDER"));
}

export function bunntekst(navn: string): string {
  return `Behandlingsansvarlig: ${navn}, org.nr. ${orgnr}, ${poststed}.`;
}
