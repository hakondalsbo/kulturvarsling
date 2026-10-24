/**
 * Visning av komitéhøringer. Fristene leses fra varselets sammendrag.
 * Følg-komité er av til personvernteksten er godkjent.
 */

export const FRIST_DELTA_LINJE = "Frist for å søke om å delta: ";
export const FRIST_INNSPILL_LINJE = "Frist for skriftlig innspill: ";

export const KOMITE_NAVN: Record<string, string> = {
  ARBSOS: "Arbeids- og sosialkomiteen",
  KOR: "Den særskilte komité for å behandle spesielle saker vedrørende korona-krisen",
  EOS: "Den særskilte komité for å behandle Særskilt melding fra EOS-utvalget (Dokument 7:2 (2020-2021))",
  UUFK: "Den utvidede utenriks- og forsvarskomité",
  ENERGI: "Energi- og miljøkomiteen",
  FAMKULT: "Familie- og kulturkomiteen",
  FINANS: "Finanskomiteen",
  FULLMAKT: "Fullmaktskomiteen",
  HELSEOMS: "Helse- og omsorgskomiteen",
  JUSTIS: "Justiskomiteen",
  KOMMFORV: "Kommunal- og forvaltningskomiteen",
  KONTROLL: "Kontroll- og konstitusjonskomiteen",
  NÆRING: "Næringskomiteen",
  SAM: "Samferdselskomiteen",
  PRES: "Stortingets presidentskap",
  UFO: "Utdannings- og forskningskomiteen",
  UFK: "Utenriks- og forsvarskomiteen",
  VALG: "Valgkomiteen",
};

const HORING_SIDE = "https://www.stortinget.no/no/Hva-skjer-pa-Stortinget/Horing/horing/?h=";
const HORING_SKJEMA = "https://www.stortinget.no/no/Hva-skjer-pa-Stortinget/Horing/skriv-skriftlig-innspill/?h=";

export function folgKomiteAktiv(): boolean {
  const env = (import.meta as { env?: { VITE_FOLG_KOMITE_AKTIV?: string } }).env;
  return env?.VITE_FOLG_KOMITE_AKTIV === "true";
}

export function komiteNavn(id: string | null | undefined): string {
  if (!id) return "";
  return KOMITE_NAVN[id] ?? id;
}

export function horingIdFraUrl(kilde: string | null | undefined): string | null {
  if (!kilde) return null;
  const m = kilde.match(/[?&]h=(\d+)/i);
  return m?.[1] ?? null;
}

export function erStortingetHoring(sak: {
  sakstype?: string | null;
  kilde?: string | null;
  tittel?: string | null;
} | null | undefined): boolean {
  if (!sak || !horingIdFraUrl(sak.kilde)) return false;
  if (sak.sakstype === "horing") return true;
  return (sak.tittel ?? "").startsWith("Høring:");
}

export function lesHoringLinjer(sammendrag: string | null | undefined): string[] {
  return (sammendrag ?? "")
    .split(/\r?\n/)
    .map((linje) => linje.trim())
    .filter(Boolean);
}

/** Skriftlig høring går til innspillsskjemaet. Uten det prefikset brukes høringssiden. */
export function horingKnappLenke(
  kilde: string | null | undefined,
  sammendrag: string | null | undefined,
): string | null {
  const id = horingIdFraUrl(kilde);
  if (!id) return null;
  const skriftlig = (sammendrag ?? "").trimStart().startsWith("Skriftlig høring");
  return (skriftlig ? HORING_SKJEMA : HORING_SIDE) + id;
}

export function komiteIdFraInstans(instans: string | null | undefined): string | null {
  const navn = (instans ?? "").replace(/,?\s*Stortinget\s*$/i, "").trim().toLowerCase();
  if (!navn) return null;
  for (const [id, label] of Object.entries(KOMITE_NAVN)) {
    if (label.toLowerCase() === navn) return id;
  }
  return null;
}

export function horingerOmSaken<T extends { id?: string; hovedsak_id?: string | null }>(
  sakId: string | null | undefined,
  saker: T[],
): T[] {
  if (!sakId) return [];
  return saker.filter((s) => s.hovedsak_id === sakId && s.id !== sakId);
}

/** Gjør ingenting når flagget er av, og spør ikke databasen. */
export async function lagreFulgteKomite(
  db: { from: (tabell: string) => any },
  brukerId: string,
  komiteId: string,
  skalFolge: boolean,
): Promise<boolean> {
  if (!folgKomiteAktiv()) return false;
  if (skalFolge) {
    const svar = await db.from("fulgte_komiteer").insert({ bruker_id: brukerId, komite_id: komiteId });
    return !svar?.error;
  }
  const svar = await db.from("fulgte_komiteer").delete().eq("bruker_id", brukerId).eq("komite_id", komiteId);
  return !svar?.error;
}

export const DEMO_SAK = {
  id: "demo-sak",
  tittel: "Statsbudsjettet 2027 (kapitler fordelt til familie- og kulturkomiteen)",
  sammendrag: "Saken behandles i familie- og kulturkomiteen.",
  instans: "Familie- og kulturkomiteen, Stortinget",
  kilde: "https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=200445",
  frist: "2026-10-28",
  kategori: "kulturpolitikk",
  nivå: "nasjonalt",
  niva: "nasjonalt",
  sted: "Stortinget",
  sakstype: "budsjett",
  handling: "handling_mulig" as const,
};

export const DEMO_SKRIFTLIG = {
  id: "demo-horing",
  hovedsak_id: "demo-sak",
  tittel: "Høring: Statsbudsjettet 2027 (kapitler fordelt til familie- og kulturkomiteen)",
  sammendrag: [
    "Skriftlig høring.",
    "Familie- og kulturkomiteen.",
    "Frist for skriftlig innspill: 28. oktober 2026 kl. 12.00.",
  ].join("\n"),
  instans: "Familie- og kulturkomiteen, Stortinget",
  kilde: "https://www.stortinget.no/no/Hva-skjer-pa-Stortinget/Horing/horing/?h=10005956",
  frist: "2026-10-28",
  kategori: "kulturpolitikk",
  nivå: "nasjonalt",
  niva: "nasjonalt",
  sted: "Stortinget",
  sakstype: "horing",
  handling: "handling_mulig" as const,
};

export const DEMO_MUNTLIG = {
  id: "demo-munn",
  hovedsak_id: "demo-sak",
  tittel: "Høring: Statsbudsjettet 2027 (kapitler fordelt til familie- og kulturkomiteen)",
  sammendrag: [
    "Muntlig høring.",
    "Familie- og kulturkomiteen.",
    "Frist for å søke om å delta: 12. oktober 2026 kl. 10.00.",
    "Frist for skriftlig innspill: 15. oktober 2026 kl. 10.00.",
  ].join("\n"),
  instans: "Familie- og kulturkomiteen, Stortinget",
  kilde: "https://www.stortinget.no/no/Hva-skjer-pa-Stortinget/Horing/horing/?h=10005961",
  frist: "2026-10-15",
  kategori: "kulturpolitikk",
  nivå: "nasjonalt",
  niva: "nasjonalt",
  sted: "Stortinget",
  sakstype: "horing",
  handling: "bare_orientering" as const,
};
