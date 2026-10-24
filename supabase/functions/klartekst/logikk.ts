// Ren logikk for klartekst-funksjonen — holdes uten Deno-avhengigheter
// slik at den kan enhetstestes med `npm test` (node --test).

import { ordningsforklaring } from "../_shared/ordningskoder.ts";

export type Profil = {
  fagfelt: string[];
  org_type: string | null;
  fylkesnr: string | null;
  fylke: string | null;
};

const TILLATTE_FAGFELT = new Set([
  "scenekunst",
  "musikk",
  "dans",
  "opera",
  "litteratur",
  "film",
  "visuell",
  "museer",
  "spill",
  "kulturarv",
]);

const TILLATTE_ORG_TYPER = new Set([
  "organisasjon",
  "kunstner",
  "institusjon",
  "annet",
]);

const FYLKER: Record<string, string> = {
  "03": "Oslo",
  "11": "Rogaland",
  "15": "Møre og Romsdal",
  "18": "Nordland",
  "31": "Østfold",
  "32": "Akershus",
  "33": "Buskerud",
  "34": "Innlandet",
  "39": "Vestfold",
  "40": "Telemark",
  "42": "Agder",
  "46": "Vestland",
  "50": "Trøndelag",
  "55": "Troms",
  "56": "Finnmark",
};

const FYLKESNR_FRA_NAVN = new Map(
  Object.entries(FYLKER).map(([nr, navn]) => [navn.toLowerCase(), nr]),
);

function kortTekst(verdi: unknown, maks: number): string {
  if (typeof verdi !== "string") return "";
  return Array.from(verdi, (tegn) => {
    const kode = tegn.charCodeAt(0);
    return kode <= 31 || kode === 127 ? " " : tegn;
  }).join("").trim().slice(0, maks);
}

/** Hent ett, og bare ett, Bearer-token fra Authorization-headeren. */
export function hentBearerToken(authorization: string | null): string | null {
  if (!authorization || authorization.length > 8200) return null;
  const treff = /^Bearer[ \t]+([^\s]+)$/i.exec(authorization.trim());
  const token = treff?.[1] ?? "";
  return token.length >= 20 && token.length <= 8192 ? token : null;
}

/** Varsler har UUID som primærnøkkel. Andre former avvises før databaseoppslag. */
export function normaliserVarselId(verdi: unknown): string | null {
  if (typeof verdi !== "string") return null;
  const id = verdi.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
    ? id
    : null;
}

/**
 * Gjør en databaseprofil om til et lite, lukket sett med profilverdier.
 * Profilradene kan redigeres av brukeren, så fritekst skal ikke bli en ny
 * cache-dimensjon eller havne direkte i AI-prompten.
 */
export function normaliserProfil(profil: unknown): Profil {
  const rå = profil && typeof profil === "object"
    ? profil as Record<string, unknown>
    : {};

  const orgKandidat = kortTekst(rå.org_type, 40).toLowerCase();
  const org_type = TILLATTE_ORG_TYPER.has(orgKandidat) ? orgKandidat : null;

  const fagfelt = Array.isArray(rå.fagfelt)
    ? [...new Set(
      rå.fagfelt
        .map((felt) => kortTekst(felt, 40).toLowerCase())
        .filter((felt) => TILLATTE_FAGFELT.has(felt)),
    )].sort()
    : [];

  const fylkesKandidat = kortTekst(rå.fylkesnr, 20);
  const fylkesnrFraNavn = FYLKESNR_FRA_NAVN.get(
    kortTekst(rå.fylke, 40).toLowerCase(),
  );
  const fylkesnr = FYLKER[fylkesKandidat]
    ? fylkesKandidat
    : fylkesnrFraNavn ?? null;

  return {
    fagfelt,
    org_type,
    fylkesnr,
    fylke: fylkesnr ? FYLKER[fylkesnr] : null,
  };
}

/** Samme modell som klartekst-funksjonen. Relevansfilteret i hent-saker bruker Haiku. */
export const KLARTEKST_MODELL = "claude-sonnet-5";
export const KLARTEKST_MAKS_TOKENS = 2000;

/** Tom profil: ukjent org, alle fagfelt, hele landet. */
export function generellProfilNokkel(): string {
  return lagProfilNokkel(null);
}

/** Batch for backfill. Ugyldig verdi faller tilbake til standard, og taket er hardt. */
export function begrensBatch(verdi: unknown, standard = 8, maks = 20): number {
  const n = typeof verdi === "number"
    ? verdi
    : typeof verdi === "string" && verdi.trim() !== ""
    ? Number(verdi)
    : standard;
  if (!Number.isFinite(n)) return standard;
  return Math.min(maks, Math.max(1, Math.floor(n)));
}

export type KlartekstSvar = {
  hva_skjer: string;
  hvem_pavirkes: string;
  tall_belop: string | null;
  frist: string | null;
  hva_kan_du_gjore: string[];
};

// Normalisert cachenøkkel: samme profil skal alltid gi samme nøkkel,
// uavhengig av rekkefølge på fagfelt, store/små bokstaver og whitespace.
export function lagProfilNokkel(profil: unknown): string {
  const normalisert = normaliserProfil(profil);
  return `${normalisert.org_type ?? "ukjent"}|${normalisert.fagfelt.join(",") || "alle"}|${normalisert.fylkesnr ?? "hele-landet"}`;
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
  if (typeof tekst !== "string" || tekst.length > 20_000) return null;
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
  const tilStreng = (v: unknown, maks: number) => {
    const verdi = kortTekst(v, maks);
    return verdi || null;
  };
  const hvaSkjer = tilStreng(rå?.hva_skjer, 600);
  if (!hvaSkjer) return null;
  return {
    hva_skjer: hvaSkjer,
    hvem_pavirkes: tilStreng(rå.hvem_pavirkes, 800) ?? "",
    tall_belop: tilStreng(rå.tall_belop, 200),
    frist: tilStreng(rå.frist, 200),
    hva_kan_du_gjore: Array.isArray(rå.hva_kan_du_gjore)
      ? rå.hva_kan_du_gjore
        .slice(0, 4)
        .map((handling) => kortTekst(handling, 300))
        .filter(Boolean)
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
  profil: unknown,
): string {
  const normalisertProfil = normaliserProfil(profil);
  const tittel = kortTekst(sak.tittel, 300) || "(mangler)";
  const instans = kortTekst(sak.instans, 160) || "ukjent";
  const niva = kortTekst(sak.niva, 60) || "ukjent";
  const sted = kortTekst(sak.sted, 120);
  const frist = kortTekst(sak.frist, 120) || "ingen kjent frist";
  const sammendrag = kortTekst(sak.sammendrag, 1200) || "(mangler)";
  const forklaring = ordningsforklaring([tittel, sammendrag, instans].join("\n"));
  return `Du er ekspert på norsk kulturpolitikk og offentlig forvaltning. Forklar saken under i klartekst for en konkret kulturaktør — hverdagsspråk, ikke forvaltningsspråk. Skriv direkte til mottakeren («du/dere») og forankre svaret i mottakerens fagfelt og situasjon.

SAKEN:
Tittel: ${tittel}
Instans: ${instans}
Nivå/sted: ${niva}${sted ? ` / ${sted}` : ""}
Frist: ${frist}
Sammendrag: ${sammendrag}

MOTTAKEREN:
Fagfelt: ${normalisertProfil.fagfelt.length ? normalisertProfil.fagfelt.join(", ") : "alle fagfelt"}
Organisasjonstype: ${normalisertProfil.org_type ?? "ukjent"}
Fylke: ${normalisertProfil.fylke ?? "hele landet"}

Vær konkret og ærlig: hvis saken bare indirekte berører mottakerens felt, si det.

KILDETROSKAP:
- Bruk bare opplysninger som står i saken over. Ikke gjett.
- Ikke legg til vurderinger, superlativer, konsekvenser, datoer eller tall som ikke står der.
- Hvis saken ikke sier det, skriv «kilden sier ikke …».
- En ordningskode skal bruke navnet fra saken eller fra listen under. Finnes ingen av delene, gjengi koden. Ikke tolk den.
${forklaring ? `\n${forklaring}\n` : ""}
Svar BARE med gyldig JSON, ingen markdown:
{
  "hva_skjer": "én setning i klartekst om hva som faktisk skjer",
  "hvem_pavirkes": "én til to setninger om hvem dette treffer, spesielt mottakerens fagfelt",
  "tall_belop": "konkrete tall eller beløp fra saken, eller null hvis ingen",
  "frist": "hva mottakeren må rekke innen når, eller null hvis ingen frist",
  "hva_kan_du_gjore": ["to til fire konkrete handlinger mottakeren kan gjøre nå"]
}`;
}

/** Teksten som etterkontrolleres mot kilden. */
export function klartekstSomTekst(svar: {
  hva_skjer: string;
  hvem_pavirkes: string;
  tall_belop?: string | null;
  frist?: string | null;
  hva_kan_du_gjore: string[];
}): string {
  return [svar.hva_skjer, svar.hvem_pavirkes, svar.tall_belop, svar.frist, ...svar.hva_kan_du_gjore]
    .filter((del) => typeof del === "string" && del.trim())
    .join("\n");
}

/** Identisk input gjenbrukes; endret sak eller prompt får et nytt fingeravtrykk. */
export async function lagInnholdsNokkel(prompt: string, modell: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([modell, prompt]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function lesGyldigCache(verdi: unknown, innhold: string): KlartekstSvar | null {
  if (!verdi || typeof verdi !== "object") return null;
  if ((verdi as Record<string, unknown>)._innhold !== innhold) return null;
  return parseKlartekstSvar(JSON.stringify(verdi));
}
