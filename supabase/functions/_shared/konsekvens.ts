// Ren logikk for konsekvens og «Mobiliser nå». Ingen nettverk, ingen Deno.
// Modellen foreslår dato og grunn. mobiliser_naa regnes alltid ut her.

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

export const SIKKERHET_VERDIER = ["lav", "middels", "høy"] as const;
export type Sikkerhet = (typeof SIKKERHET_VERDIER)[number];

/** Samme vindu som statusregelen viktig ≤ 21. */
export const MOBILISER_DAGER = 21;

/** Egne Haiku-kall per kjøring, i tillegg til relevansfilterets tak. */
export const MAKS_KONSEKVENS_PER_KJORING = 20;

export const KONSEKVENS_BACKFILL_BATCH = 8;
export const KONSEKVENS_BACKFILL_MAKS = 20;

export type KonsekvensFilter = "alle" | Konsekvens | "mobiliser";

export type KonsekvensInn = {
  tittel: string;
  sammendrag: string;
  kildetekst: string;
  instans: string;
  frist: string | null;
  dagensDato: string;
};

export type KonsekvensVurdering = {
  konsekvens: Konsekvens;
  begrunnelse: string;
  sikkerhet: Sikkerhet;
  mobiliser_dato: string | null;
  mobiliser_grunn: string | null;
  mobiliser_naa: boolean;
  /** true når svaret ikke var gyldig JSON eller en kjent verdi. */
  ugyldig: boolean;
};

export type KonsekvensFelt = {
  konsekvens: Konsekvens;
  konsekvens_begrunnelse: string;
  konsekvens_sikkerhet: Sikkerhet;
  mobiliser_dato: string | null;
  mobiliser_grunn: string | null;
  mobiliser_naa: boolean;
};

const PROMPT = `Du klassifiserer saker for kulturvarsling.no, en tjeneste som følger offentlige saker om kunst og kultur i Norge. Du skal sette KONSEKVENS og finne ut om saken har en frist eller et vedtak som gjør at leserne kan handle nå.

INPUT
tittel: {tittel}
sammendrag: {sammendrag}
kildetekst: {kildetekst}
instans: {instans}
frist (fra databasen, kan være tom): {frist}
dagens_dato: {dagens_dato}

GRUNNREGLER
1. Bruk bare det som faktisk står i kildeteksten (og tittel/sammendrag hvis de stemmer med kilden). Ikke bruk egen kunnskap, ikke gjett, ikke regn ut tall som ikke står der.
2. Ved tvil: velg "til_orientering" og sett sikkerhet til "lav".
3. Ikke lag dramatikk. Gjengi nøkternt. Ikke bruk ord som "dramatisk", "sjokk", "rammer hardt" eller "krise" med mindre det er et direkte sitat, og merk det i så fall som sitat med kilde.
4. Meninger fra en part (organisasjon, parti, Sametinget) er ikke det samme som et vedtak. Bruk dem bare hvis de inneholder konkrete tall, og si hvem som sier det.

VERDIER FOR KONSEKVENS
- "kutt_innstramming": kilden viser lavere bevilgning til en navngitt post, ordning eller institusjon; eller at en bevilgning står stille i kroner eller øker mindre enn pris-/lønnsveksten, og kilden oppgir tallene; eller nedleggelse; eller at en ordning avvikles eller stenges. Gjelder også forslag fra et organ som kan vedta det. Ikke nok: "stramt", "lite handlingsrom" uten tall; tekniske rammeoverføringer.
- "stor_endring": endring i regelverk (lov, forskrift, retningslinjer), organisering (ansvar flyttes, enheter slås sammen) eller fordelingsnøkler/kriterier for tilskudd, som ikke først og fremst er et kutt eller en økning.
- "ny_mulighet": økte bevilgninger, nye satsinger eller ordninger, en åpen søknadsrunde med frist fram i tid, eller vedtak/planer som åpner for ny kulturaktivitet.
- "til_orientering": alt annet, inkludert lister over tilskudd som allerede er tildelt, protokoller, møteplaner, referatsaker, uttalelser uten vedtak, varslede saker uten kjent innhold, og saker der kilden er uklar.

REKKEFØLGE NÅR FLERE PASSER
kutt_innstramming (bare når kuttet er konkret og navngitt i kilden) > stor_endring > ny_mulighet > til_orientering.
Har saken både kutt og økninger, nevner du begge i begrunnelsen.
"Videreført" i statsbudsjettet betyr prisomregnet og er ikke et kutt, med mindre kilden sier noe annet.

MOBILISER NÅ
Finn datoen leserne kan handle før, og som står i kilden:
- høringsfrist, frist for innspill eller søknadsfrist, eller
- dato for møte, behandling eller vedtak i et folkevalgt organ.
mobiliser_dato = den tidligste slike datoen som er lik eller senere enn dagens_dato. Er det ingen, settes den til null.
mobiliser_naa = true bare hvis mobiliser_dato ikke er null OG mobiliser_dato er senest 21 dager etter dagens_dato.
Datoer som har passert, gir aldri true. Har møtet allerede vært holdt, er mobiliser_naa false.
mobiliser_grunn: én kort setning med type og dato, for eksempel "Åpen høring, frist 12.01.2027" eller "Bystyret behandler saken 27.10.2026". Fyll den ut også når datoen ligger mer enn 21 dager fram i tid. Er det ingen dato, settes den til null.

SIKKERHET
- "høy": kilden sier dette direkte og tydelig.
- "middels": kilden støtter vurderingen, men noe mangler (bare tittel er kjent, liten forskjell i reell vekst, deler av dokumentet er ikke lest).
- "lav": kilden er uklar, tom eller ikke lest, eller du valgte til_orientering fordi du var i tvil.

BEGRUNNELSE
Én setning på norsk bokmål, saklig og konkret, som viser til det kilden sier (tall, dato, navn på ordning). Eksempel: "Kilden oppgir at post 50 øker med 3,2 %, mens prisveksten er anslått til 3,4 %."

SVAR
Svar bare med gyldig JSON, uten annen tekst:
{
  "konsekvens": "kutt_innstramming" | "stor_endring" | "ny_mulighet" | "til_orientering",
  "mobiliser_naa": true | false,
  "mobiliser_grunn": string | null,
  "mobiliser_dato": "ÅÅÅÅ-MM-DD" | null,
  "begrunnelse": string,
  "sikkerhet": "lav" | "middels" | "høy"
}`;

function klipp(tekst: string, maks: number): string {
  const ren = tekst.replace(/\s+/g, " ").trim();
  if (ren.length <= maks) return ren;
  return `${ren.slice(0, maks - 1).trimEnd()}…`;
}

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

/**
 * true når datoen er i dag eller inntil 21 dager frem.
 * Passert dato og manglende dato er alltid false.
 */
export function erMobiliserNaa(
  dato: string | null | undefined,
  iDag: string,
): boolean {
  if (!dato || !gyldigIsoDato(dato) || !gyldigIsoDato(iDag)) return false;
  if (dato < iDag) return false;
  return dato <= leggTilDager(iDag, MOBILISER_DAGER);
}

export function erKonsekvens(verdi: unknown): verdi is Konsekvens {
  return typeof verdi === "string" &&
    (KONSEKVENS_VERDIER as readonly string[]).includes(verdi);
}

export function erKonsekvensLåst(rad: {
  konsekvens_manuell?: boolean | null;
  manuelt_redigert?: boolean | null;
}): boolean {
  return rad.konsekvens_manuell === true || rad.manuelt_redigert === true;
}

/** Allerede satt, eller rettet for hånd: ikke klassifiser på nytt. */
export function kanKlassifisereRad(rad: {
  konsekvens?: string | null;
  konsekvens_manuell?: boolean | null;
  manuelt_redigert?: boolean | null;
}): boolean {
  if (erKonsekvensLåst(rad)) return false;
  if (rad.konsekvens) return false;
  return true;
}

/** Lav sikkerhet vises ikke før en redaktør har sett på saken. */
export function synligKonsekvens(sak: {
  konsekvens?: string | null;
  konsekvens_sikkerhet?: string | null;
}): Konsekvens | null {
  if (!erKonsekvens(sak.konsekvens)) return null;
  if (sak.konsekvens_sikkerhet === "lav") return null;
  return sak.konsekvens;
}

/**
 * 0 = kutt og innstramming, 1 = mobiliser nå, 2 = resten.
 * Kutt går foran. Lav sikkerhet løftes ikke som kutt.
 */
export function forsideRang(
  sak: {
    konsekvens?: string | null;
    konsekvens_sikkerhet?: string | null;
    mobiliser_dato?: string | null;
  },
  iDag: string,
): number {
  if (synligKonsekvens(sak) === "kutt_innstramming") return 0;
  if (erMobiliserNaa(sak.mobiliser_dato, iDag)) return 1;
  return 2;
}

export function matcherKonsekvensFilter(
  sak: {
    konsekvens?: string | null;
    konsekvens_sikkerhet?: string | null;
    mobiliser_dato?: string | null;
  },
  filter: KonsekvensFilter,
  iDag: string,
): boolean {
  if (filter === "alle") return true;
  if (filter === "mobiliser") return erMobiliserNaa(sak.mobiliser_dato, iDag);
  return synligKonsekvens(sak) === filter;
}

export function byggKonsekvensPrompt(inn: KonsekvensInn): string {
  const felt: Record<string, string> = {
    tittel: klipp(inn.tittel || "", 400),
    sammendrag: klipp(inn.sammendrag || "", 1500),
    kildetekst: klipp(inn.kildetekst || "", 6000),
    instans: klipp(inn.instans || "", 200),
    frist: inn.frist && gyldigIsoDato(inn.frist) ? inn.frist : "",
    dagens_dato: gyldigIsoDato(inn.dagensDato) ? inn.dagensDato : osloDato(),
  };
  return PROMPT.replace(
    /\{(tittel|sammendrag|kildetekst|instans|frist|dagens_dato)\}/g,
    (_, nøkkel: string) => felt[nøkkel] ?? "",
  );
}

function enSetning(verdi: unknown, reserve: string): string {
  if (typeof verdi !== "string") return reserve;
  const ren = verdi.replace(/\s+/g, " ").trim();
  if (!ren) return reserve;
  return ren.slice(0, 500);
}

function lesDato(verdi: unknown): string | null {
  if (typeof verdi !== "string") return null;
  const iso = verdi.trim().slice(0, 10);
  return gyldigIsoDato(iso) ? iso : null;
}

function lesGrunn(verdi: unknown): string | null {
  if (typeof verdi !== "string") return null;
  const ren = verdi.replace(/\s+/g, " ").trim();
  if (!ren || ren.toLowerCase() === "null") return null;
  return ren.slice(0, 300);
}

const FALLBACK_BEGRUNNELSE = "Kilden ga ikke et svar som kunne klassifiseres.";

export function fallbackVurdering(): KonsekvensVurdering {
  return {
    konsekvens: "til_orientering",
    begrunnelse: FALLBACK_BEGRUNNELSE,
    sikkerhet: "lav",
    mobiliser_dato: null,
    mobiliser_grunn: null,
    mobiliser_naa: false,
    ugyldig: true,
  };
}

function lesJsonObjekt(tekst: string): unknown {
  const renset = tekst
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(renset);
  } catch {
    const start = renset.indexOf("{");
    const slutt = renset.lastIndexOf("}");
    if (start === -1 || slutt <= start) return null;
    try {
      return JSON.parse(renset.slice(start, slutt + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Tolker modellsvaret. mobiliser_naa fra modellen brukes ikke.
 * Ugyldig JSON eller ukjent konsekvens blir til_orientering med lav sikkerhet.
 */
export function tolkKonsekvensSvar(tekst: string, iDag: string): KonsekvensVurdering {
  const data = lesJsonObjekt(tekst);
  if (!data || typeof data !== "object" || Array.isArray(data)) return fallbackVurdering();
  const rad = data as Record<string, unknown>;
  if (!erKonsekvens(rad.konsekvens)) return fallbackVurdering();
  const sikkerhet = (SIKKERHET_VERDIER as readonly string[]).includes(String(rad.sikkerhet))
    ? rad.sikkerhet as Sikkerhet
    : "lav";
  const mobiliser_dato = lesDato(rad.mobiliser_dato);
  const mobiliser_grunn = lesGrunn(rad.mobiliser_grunn);
  return {
    konsekvens: rad.konsekvens,
    begrunnelse: enSetning(rad.begrunnelse, "Begrunnelse mangler."),
    sikkerhet,
    mobiliser_dato,
    mobiliser_grunn,
    mobiliser_naa: erMobiliserNaa(mobiliser_dato, iDag),
    ugyldig: false,
  };
}

export function feltFraVurdering(v: KonsekvensVurdering): KonsekvensFelt {
  return {
    konsekvens: v.konsekvens,
    konsekvens_begrunnelse: v.begrunnelse,
    konsekvens_sikkerhet: v.sikkerhet,
    mobiliser_dato: v.mobiliser_dato,
    mobiliser_grunn: v.mobiliser_grunn,
    mobiliser_naa: v.mobiliser_naa,
  };
}

export function tekstFraClaude(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const innhold = (data as { content?: unknown }).content;
  if (!Array.isArray(innhold)) return "";
  const blokk = innhold.find((b) =>
    !!b && typeof b === "object" && (b as { type?: string }).type === "text"
  ) as { text?: string } | undefined;
  return typeof blokk?.text === "string" ? blokk.text : "";
}

export type TreffRad = { forventet: string; faktisk: string };

export type TreffVerdi = { antall: number; treff: number; rate: number | null };

/** Treffrate per fasitverdi (recall): andel av fasitens saker som fikk riktig verdi. */
export function treffrate(par: TreffRad[]): {
  antall: number;
  treff: number;
  rate: number | null;
  per_verdi: Record<Konsekvens, TreffVerdi>;
} {
  const per_verdi = {} as Record<Konsekvens, TreffVerdi>;
  for (const verdi of KONSEKVENS_VERDIER) {
    const relevante = par.filter((p) => p.forventet === verdi);
    const treff = relevante.filter((p) => p.faktisk === verdi).length;
    per_verdi[verdi] = {
      antall: relevante.length,
      treff,
      rate: relevante.length === 0 ? null : treff / relevante.length,
    };
  }
  const treff = par.filter((p) => p.forventet === p.faktisk).length;
  return {
    antall: par.length,
    treff,
    rate: par.length === 0 ? null : treff / par.length,
    per_verdi,
  };
}
