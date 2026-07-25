// Ren logikk for klartekst-funksjonen — holdes uten Deno-avhengigheter
// slik at den kan enhetstestes med `npm test` (node --test).

export type Profil = {
  fagfelt?: string[] | null;
  org_type?: string | null;
  fylke?: string | null;
};

export type KlartekstSvar = {
  hva_skjer: string;
  hvem_pavirkes: string;
  tall_belop: string | null;
  frist: string | null;
  hva_kan_du_gjore: string[];
};

// Normalisert cachenøkkel: samme profil skal alltid gi samme nøkkel,
// uavhengig av rekkefølge på fagfelt, store/små bokstaver og whitespace.
export function lagProfilNokkel(profil: Profil | null | undefined): string {
  const fagfelt = [
    ...new Set(
      (profil?.fagfelt ?? [])
        .map((f) => String(f).trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
  const org = (profil?.org_type ?? "").trim().toLowerCase() || "ukjent";
  const fylke = (profil?.fylke ?? "").trim().toLowerCase() || "hele-landet";
  return `${org}|${fagfelt.join(",") || "alle"}|${fylke}`;
}

// Claude 5-modeller kan returnere en thinking-blokk FØR tekstblokken —
// finn tekstblokken eksplisitt i stedet for å anta content[0].
export function trekkUtTekst(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const blokk = content.find(
    (b) => b && typeof b === "object" && (b as { type?: string }).type === "text",
  ) as { text?: string } | undefined;
  return blokk?.text ?? "";
}

// Parser Claudes svar: fjerner ev. markdown-gjerder, validerer feltene.
// Returnerer null hvis svaret ikke er brukbart (kalleren håndterer feilen).
export function parseKlartekstSvar(tekst: string): KlartekstSvar | null {
  const ren = tekst
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  if (!ren) return null;
  let rå: Record<string, unknown>;
  try {
    rå = JSON.parse(ren);
  } catch {
    return null;
  }
  if (typeof rå?.hva_skjer !== "string" || !rå.hva_skjer.trim()) return null;
  const tilStreng = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  return {
    hva_skjer: rå.hva_skjer.trim(),
    hvem_pavirkes: tilStreng(rå.hvem_pavirkes) ?? "",
    tall_belop: tilStreng(rå.tall_belop),
    frist: tilStreng(rå.frist),
    hva_kan_du_gjore: Array.isArray(rå.hva_kan_du_gjore)
      ? rå.hva_kan_du_gjore.map((h) => String(h).trim()).filter(Boolean)
      : [],
  };
}

// Prompten som gjør forvaltningsspråk → menneskespråk, forankret i profilen.
export function byggPrompt(
  sak: {
    tittel: string;
    sammendrag?: string | null;
    instans?: string | null;
    frist?: string | null;
    niva?: string | null;
    sted?: string | null;
  },
  profil: Profil | null | undefined,
): string {
  const fagfelt = (profil?.fagfelt ?? []).filter(Boolean);
  return `Du er ekspert på norsk kulturpolitikk og offentlig forvaltning. Forklar saken under i klartekst for en konkret kulturaktør — hverdagsspråk, ikke forvaltningsspråk. Skriv direkte til mottakeren («du/dere») og forankre svaret i mottakerens fagfelt og situasjon.

SAKEN:
Tittel: ${sak.tittel}
Instans: ${sak.instans ?? "ukjent"}
Nivå/sted: ${sak.niva ?? "ukjent"}${sak.sted ? ` / ${sak.sted}` : ""}
Frist: ${sak.frist ?? "ingen kjent frist"}
Sammendrag: ${sak.sammendrag?.slice(0, 1200) ?? "(mangler)"}

MOTTAKEREN:
Fagfelt: ${fagfelt.length ? fagfelt.join(", ") : "alle fagfelt"}
Organisasjonstype: ${profil?.org_type?.trim() || "ukjent"}
Fylke: ${profil?.fylke?.trim() || "hele landet"}

Vær konkret og ærlig: hvis saken bare indirekte berører mottakerens felt, si det. Ikke funn opp tall eller frister som ikke står i saken.

Svar BARE med gyldig JSON, ingen markdown:
{
  "hva_skjer": "én setning i klartekst om hva som faktisk skjer",
  "hvem_pavirkes": "1-2 setninger om hvem dette treffer, spesielt mottakerens fagfelt",
  "tall_belop": "konkrete tall/beløp fra saken, eller null hvis ingen",
  "frist": "hva mottakeren må rekke innen når, eller null hvis ingen frist",
  "hva_kan_du_gjore": ["2-4 konkrete handlinger mottakeren kan gjøre nå"]
}`;
}
