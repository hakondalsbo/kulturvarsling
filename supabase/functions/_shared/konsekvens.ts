// Ren logikk for konsekvens og «Mobiliser nå». Ingen nettverk, ingen Deno.
// Modellen foreslår dato og grunn. mobiliser_naa regnes alltid ut her.
import { hemmeligheterStemmer } from "./samtykke.ts";

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

/**
 * Egne Haiku-kall per hent-saker-kjøring, bare på saker som blir publisert.
 *
 * Gratisplanens veggklokke er 150 s. kallClaude avbryter etter 25 s og
 * prøver ikke et tidsavbrudd på nytt. Relevanskjøringen er allerede
 * dokumentert til omtrent ett minutt ved 25 Haiku-kall, innhenting inkludert.
 * Klartekst legger til inntil 8 Sonnet-kall. Budsjettet under er et planlagt
 * nattløp, ikke summen av alle tidsavbrudd (den summen sprenger 150 s allerede
 * uten konsekvens):
 *
 *   relevans + innhenting     70 s
 *   klartekst, 8 × 6 s        48 s
 *   igjen                     32 s
 *   konsekvens, tak 8 s       4 kall = 32 s
 *
 * Fire trege kall fyller resten. Flere venter til neste kjøring eller backfill.
 */
export const MAKS_KONSEKVENS_PER_KJORING = 4;

/** Tidsavbrudd for ett konsekvens-kall i pipelinen. Fire slike er 32 s. */
export const KONSEKVENS_TIMEOUT_MS = 8_000;

/**
 * Eval-kjøringen er ett eget funksjonskall, ikke en del av hent-saker.
 * Den opprinnelige fasiten kjøres først, deretter sakene som er holdt utenfor.
 * Vi stopper før plattformens 150 s så svaret blir JSON og ikke et avbrudd
 * uten kropp. Ingenting skrives.
 */
export const EVAL_TIDSBUDSJETT_MS = 120_000;

export const KONSEKVENS_BACKFILL_BATCH = 8;
export const KONSEKVENS_BACKFILL_MAKS = 20;

export type KonsekvensFilter = "alle" | Konsekvens | "mobiliser";

export type KonsekvensInn = {
  tittel: string;
  sammendrag: string;
  /** Råtekst eller utdrag. Ikke det forkastede sammendraget. */
  kildetekst: string;
  instans: string;
  frist: string | null;
  dagensDato: string;
  /** høring, proposisjon, budsjett, varslet, tildeling, tilskudd, forslag eller nyhet. */
  sakstype?: string | null;
  kategori?: string | null;
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
type: {sakstype}
organ: {instans}
kategori: {kategori}
frist (fra databasen, kan være tom): {frist}
sammendrag: {sammendrag}
utdrag: {kildetekst}
dagens_dato: {dagens_dato}

GRUNNREGLER
1. Bruk tittel, type, organ, frist, kategori og utdrag. Sammendraget er bare et hjelpemiddel. Er sammendraget tomt, merket som forkastet, eller «Automatisk avvist», skal det ikke brukes. Da avgjør de andre feltene.
2. Når utdraget og sammendraget spriker, gjelder utdraget. Ikke bruk egen kunnskap, og ikke regn ut tall som ikke står i utdraget, tittelen eller frist-feltet.
3. Ikke lag dramatikk. Gjengi nøkternt. Ikke bruk ord som "dramatisk", "sjokk", "rammer hardt" eller "krise" med mindre det er et direkte sitat, og merk det i så fall som sitat med kilde.
4. En mening fra en part (organisasjon, parti, Sametinget) er ikke et vedtak. Bruk den når den gjengir konkrete tall, og si hvem som sier det.

VERDIER FOR KONSEKVENS
- "kutt_innstramming": kilden viser lavere bevilgning til en navngitt post, ordning eller institusjon; eller at en bevilgning står stille i kroner eller øker mindre enn pris- eller lønnsveksten, og kilden oppgir tallene; eller nedleggelse; eller at en ordning avvikles eller stenges. Gjelder også forslag fra et organ som kan vedta det. Ikke nok: "stramt" eller "lite handlingsrom" uten tall. En teknisk rammeoverføring er ikke et kutt.
- "stor_endring": en lov, forskrift, retningslinje eller regulering som endrer rammevilkårene for en bransje; eller at ansvaret for en kulturordning flyttes eller slås sammen; eller at fordelingsnøkler eller kriterier for tilskudd endres. Det kreves ikke et ferdig vedtak eller en møtedato.
- "ny_mulighet": økte bevilgninger, en ny ordning, eller en åpen søknadsrunde med frist fram i tid. Også et vedtak eller en plan som åpner for ny kulturaktivitet.
- "til_orientering": saken krever ikke handling og endrer ikke noe vesentlig. Det gjelder lister over tilskudd som allerede er tildelt, protokoller, referater, redegjørelser uten vedtak, innspill og uttalelser, vedlikehold, saker utenfor kunst og kultur, og en varslet sak der verken tittel eller utdrag sier hva som endres.

REKKEFØLGE NÅR FLERE PASSER
kutt_innstramming (bare når kuttet er konkret og navngitt i kilden) > stor_endring > ny_mulighet > til_orientering.
Har saken både kutt og økninger, nevner du begge i begrunnelsen.
"Videreført" i statsbudsjettet betyr prisomregnet og er ikke et kutt, med mindre kilden sier noe annet.

SLIK DU SKILLER DEM
- En lov- eller forskriftsendring som endrer rammevilkår for en bransje, er stor_endring. Et varslet lovforslag er stor_endring når tittelen eller utdraget navngir loven og hva som endres. Et forslag om å tillate eller forby en type aktivitet er stor_endring. En høring av et slikt forslag er stor_endring.
- Et statsbudsjett eller en proposisjon som setter kulturbevilgninger, er ikke til_orientering. Etter innholdet: navngitt kutt, eller vekst under pris- eller lønnsveksten kilden selv oppgir, er kutt_innstramming. Økt bevilgning eller en ny ordning er ny_mulighet. Uten slike tall, men med en kjent endring i rammene, er det stor_endring. En varslet budsjettsak uten kjent innhold er til_orientering. Et sammendrag som bare sier at budsjettet er viktig, uten poster eller beløp, er ikke kjent innhold.
- En ny tilskuddsordning eller en åpen søknadsmulighet er ny_mulighet.
- Til_orientering skal bare brukes når saken ikke krever handling og ikke endrer noe vesentlig.
- En høring som bare kartlegger behov, uten et forslag til regel, er til_orientering.
- Et forslag om åpningstid eller drift ved én institusjon, uten lov eller forskrift, er til_orientering.
- Søknader og ønsker om mer støtte, uten vedtak og uten åpen søknadsrunde, er til_orientering.
- At ansvaret for en tilskuddsordning flyttes, er stor_endring selv om teksten ikke gjengir et vedtak.
- Gjelder saken et annet felt enn kunst og kultur, er den til_orientering selv om organet har kultur i navnet.

EKSEMPLER
Eksemplene er generelle og er ikke sakene du skal vurdere.
- Høring om forskrift om tilskudd til scenekunst, der kravet til egenandel fjernes. → stor_endring.
- Prop. 1 S: posten for museer reduseres med 12 millioner kroner, og kilden oppgir beløpet. → kutt_innstramming.
- Ny søknadsrunde for et debutantstipend, med frist 1. mars. → ny_mulighet.
- Referat fra kulturutvalget, eller en liste over tilskudd som allerede er delt ut. → til_orientering.

MOBILISER NÅ
Finn datoen leserne kan handle før, og som står i kilden:
- høringsfrist, frist for innspill eller søknadsfrist, eller
- dato for møte, behandling eller vedtak i et folkevalgt organ.
mobiliser_dato = den tidligste slike datoen som er lik eller senere enn dagens_dato. Er det ingen, settes den til null.
mobiliser_naa = true bare hvis mobiliser_dato ikke er null OG mobiliser_dato er senest 21 dager etter dagens_dato.
Datoer som har passert, gir aldri true. Har møtet allerede vært holdt, er mobiliser_naa false.
mobiliser_grunn: én kort setning med type og dato, for eksempel "Åpen høring, frist 12.01.2027" eller "Bystyret behandler saken 27.10.2026". Fyll den ut også når datoen ligger mer enn 21 dager fram i tid. Er det ingen dato, settes den til null.

SIKKERHET
- "høy": utdraget eller tittelen sier dette direkte og tydelig.
- "middels": vurderingen følger av tittel og type, men utdraget er kort eller mangler tall.
- "lav": utdraget er tomt og tittelen sier ikke hva som endres.

BEGRUNNELSE
Én setning på norsk bokmål, saklig og konkret, som viser til det kilden sier (tall, dato, navn på ordning). Eksempel: "Kilden oppgir at posten for museer reduseres med 12 millioner kroner."

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

/** Tomt, eller bare «Automatisk avvist …». Skal ikke være eneste grunnlag. */
export function erUbrukeligGrunnlag(tekst: string | null | undefined): boolean {
  const ren = (tekst ?? "").replace(/\s+/g, " ").trim();
  if (!ren) return true;
  return /^automatisk avvist\b/i.test(ren);
}

/**
 * Type fra tittel og organ når kilden ikke har satt sakstype.
 * Varslet sak går foran, slik at et ukjent budsjett ikke blir en proposisjon.
 */
export function utledSakstype(tittel: string, instans: string): string {
  const tittelRen = tittel.replace(/\s+/g, " ").trim();
  const hay = `${tittelRen} ${instans}`.toLowerCase();
  if (/^varslet sak\b/i.test(tittelRen)) return "varslet";
  if (/\bprop\.\s*1\b|\bproposisjon\b/.test(hay)) return "proposisjon";
  if (/høring|høyring|\bhoring\b/.test(hay)) return "horing";
  if (/\bstatsbudsjett/.test(hay) && !/budsjettbehov|økonomiske perspektiver/.test(hay)) {
    return "budsjett";
  }
  if (/^tildeling\b|^innvilgede\b/i.test(tittelRen)) return "tildeling";
  return "";
}

/** Feltene modellen skal se. Fasitbegrunnelsen tas ikke med. */
export function innFraFasit(sak: {
  tittel: string;
  sammendrag: string;
  instans: string;
  frist: string | null;
  sakstype?: string | null;
  kategori?: string | null;
  utdrag?: string | null;
}, dagensDato: string): KonsekvensInn {
  return forberedKonsekvensInn({
    tittel: sak.tittel,
    sammendrag: sak.sammendrag,
    kildetekst: sak.utdrag ?? "",
    instans: sak.instans,
    frist: sak.frist,
    dagensDato,
    sakstype: sak.sakstype,
    kategori: sak.kategori,
  });
}

/** Forkaster ubrukelig sammendrag og lar utdraget være kildeteksten. */
export function forberedKonsekvensInn(inn: KonsekvensInn): KonsekvensInn {
  const sammendrag = erUbrukeligGrunnlag(inn.sammendrag)
    ? ""
    : inn.sammendrag.replace(/\s+/g, " ").trim();
  let kildetekst = erUbrukeligGrunnlag(inn.kildetekst)
    ? ""
    : inn.kildetekst.replace(/\s+/g, " ").trim();
  if (!kildetekst && sammendrag) kildetekst = sammendrag;
  const sakstype = (inn.sakstype ?? "").replace(/\s+/g, " ").trim()
    || utledSakstype(inn.tittel ?? "", inn.instans ?? "");
  const kategori = (inn.kategori ?? "").replace(/\s+/g, " ").trim();
  return { ...inn, sammendrag, kildetekst, sakstype, kategori };
}

export function byggKonsekvensPrompt(inn: KonsekvensInn): string {
  const klar = forberedKonsekvensInn(inn);
  const kortSammendrag = klipp(klar.sammendrag, 1500);
  const sammendrag = erUbrukeligGrunnlag(inn.sammendrag)
    ? "(forkastet, brukes ikke)"
    : kortSammendrag;
  const fullKilde = klipp(klar.kildetekst, 6000);
  let kildetekst = fullKilde;
  if (!fullKilde) kildetekst = "(ingen utdrag)";
  else if (!erUbrukeligGrunnlag(inn.sammendrag) && fullKilde === kortSammendrag) {
    kildetekst = "(samme som sammendraget)";
  }
  const felt: Record<string, string> = {
    tittel: klipp(klar.tittel || "", 400),
    sakstype: klar.sakstype || "(ikke oppgitt)",
    kategori: klar.kategori || "(ikke oppgitt)",
    sammendrag,
    kildetekst,
    instans: klipp(klar.instans || "", 200),
    frist: klar.frist && gyldigIsoDato(klar.frist) ? klar.frist : "",
    dagens_dato: gyldigIsoDato(klar.dagensDato) ? klar.dagensDato : osloDato(),
  };
  return PROMPT.replace(
    /\{(tittel|sakstype|kategori|sammendrag|kildetekst|instans|frist|dagens_dato)\}/g,
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

export type TokenForbruk = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

export type EvalKall = {
  konsekvens: string | null;
  begrunnelse: string | null;
  tokens: TokenForbruk | null;
};

export type EvalRad = {
  id: string;
  forventet: string;
  /** null når kallet ikke ga en verdi. Telles ikke som feil klasse. */
  faktisk: string | null;
  grunn: "ok" | "utsatt" | "tidsbudsjett";
  begrunnelse: string | null;
  tokens: TokenForbruk | null;
  sett?: string;
  /** Hvorfor fasiten er satt slik. Sendes ikke til modellen. */
  fasit_begrunnelse?: string | null;
};

export type EvalDelrapport = {
  antall: number;
  vurdert: number;
  treff: number;
  rate: number | null;
  per_verdi: Record<Konsekvens, TreffVerdi>;
};

export type KonsekvensPort =
  | { kind: "json"; status: 503 | 401 | 200; body: Record<string, string> }
  | { kind: "tekst"; status: 405; body: string };

/**
 * Samme port som hent-saker: header x-cron-secret mot HENT_SAKER_CRON_SECRET
 * (Vault-navn hent_saker_cron_secret). KONSEKVENS_BACKFILL_SECRET er valgfri.
 * Den godtas i x-cron-secret eller x-backfill-secret når den er satt.
 * Uten begge hemmeligheter er tjenesten ikke konfigurert.
 */
export function avslagForKonsekvens(
  method: string,
  cronHeader: string | null,
  backfillHeader: string | null,
  cronSecret: string | undefined,
  fallbackSecret: string | undefined,
): KonsekvensPort | null {
  if (!cronSecret && !fallbackSecret) {
    return { kind: "json", status: 503, body: { feil: "Tjenesten er ikke konfigurert" } };
  }
  const godkjent = hemmeligheterStemmer(cronHeader, cronSecret)
    || hemmeligheterStemmer(cronHeader, fallbackSecret)
    || hemmeligheterStemmer(backfillHeader, fallbackSecret);
  if (!godkjent) {
    return { kind: "json", status: 401, body: { feil: "Uautorisert" } };
  }
  if (method === "GET") {
    return { kind: "json", status: 200, body: { status: "ok" } };
  }
  if (method !== "POST") {
    return { kind: "tekst", status: 405, body: "Bruk POST" };
  }
  return null;
}

function tokenTall(verdi: unknown): number {
  return typeof verdi === "number" && Number.isFinite(verdi) && verdi >= 0 ? verdi : 0;
}

/** Usage fra Anthropic-svaret. Mangler feltet, blir null. */
export function lesTokenForbruk(data: unknown): TokenForbruk | null {
  if (!data || typeof data !== "object") return null;
  const usage = (data as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const rad = usage as Record<string, unknown>;
  if (rad.input_tokens == null && rad.output_tokens == null) return null;
  return {
    input_tokens: tokenTall(rad.input_tokens),
    output_tokens: tokenTall(rad.output_tokens),
    cache_read_input_tokens: tokenTall(rad.cache_read_input_tokens),
    cache_creation_input_tokens: tokenTall(rad.cache_creation_input_tokens),
  };
}

export function summerTokenForbruk(rader: Array<TokenForbruk | null>): TokenForbruk & { kall: number } {
  const sum = {
    kall: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  for (const rad of rader) {
    if (!rad) continue;
    sum.kall += 1;
    sum.input_tokens += rad.input_tokens;
    sum.output_tokens += rad.output_tokens;
    sum.cache_read_input_tokens += rad.cache_read_input_tokens;
    sum.cache_creation_input_tokens += rad.cache_creation_input_tokens;
  }
  return sum;
}

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

/**
 * Klassifiserer fasiten innenfor tidsbudsjettet. Et kall som ikke gir verdi,
 * eller som ikke rekker å starte, blir utsatt og inngår ikke i treffraten.
 */
function normaliserEvalSvar(svar: string | EvalKall | null): EvalKall {
  if (typeof svar === "string") {
    return { konsekvens: svar, begrunnelse: null, tokens: null };
  }
  if (!svar) return { konsekvens: null, begrunnelse: null, tokens: null };
  return {
    konsekvens: svar.konsekvens,
    begrunnelse: svar.begrunnelse,
    tokens: svar.tokens,
  };
}

function evalDelrapport(rader: EvalRad[]): EvalDelrapport {
  const vurdert = rader.filter((s) => s.faktisk != null) as Array<{ forventet: string; faktisk: string }>;
  const rapport = treffrate(vurdert);
  return {
    antall: rader.length,
    vurdert: vurdert.length,
    treff: rapport.treff,
    rate: rapport.rate,
    per_verdi: rapport.per_verdi,
  };
}

export async function kjørFasitEval<T extends {
  id: string;
  forventet: string;
  sett?: string;
  fasit_begrunnelse?: string | null;
}>(
  saker: readonly T[],
  klassifiser: (sak: T) => Promise<string | EvalKall | null>,
  nå: () => number = Date.now,
  budsjettMs: number = EVAL_TIDSBUDSJETT_MS,
): Promise<{
  antall: number;
  vurdert: number;
  treff: number;
  rate: number | null;
  per_verdi: Record<Konsekvens, TreffVerdi>;
  per_sett: Record<string, EvalDelrapport>;
  utsatt: string[];
  token_forbruk: TokenForbruk & { kall: number };
  saker: EvalRad[];
}> {
  const start = nå();
  const sakerUt: EvalRad[] = [];
  for (const sak of saker) {
    const meta = {
      sett: sak.sett,
      fasit_begrunnelse: sak.fasit_begrunnelse ?? null,
    };
    if (nå() - start >= budsjettMs) {
      sakerUt.push({
        id: sak.id,
        forventet: sak.forventet,
        faktisk: null,
        grunn: "tidsbudsjett",
        begrunnelse: null,
        tokens: null,
        ...meta,
      });
      continue;
    }
    let svar: EvalKall = { konsekvens: null, begrunnelse: null, tokens: null };
    try {
      svar = normaliserEvalSvar(await klassifiser(sak));
    } catch {
      svar = { konsekvens: null, begrunnelse: null, tokens: null };
    }
    sakerUt.push({
      id: sak.id,
      forventet: sak.forventet,
      faktisk: svar.konsekvens,
      grunn: svar.konsekvens ? "ok" : "utsatt",
      begrunnelse: svar.begrunnelse,
      tokens: svar.tokens,
      ...meta,
    });
  }
  const samlet = evalDelrapport(sakerUt);
  const grupper = new Map<string, EvalRad[]>();
  for (const rad of sakerUt) {
    if (!rad.sett) continue;
    const liste = grupper.get(rad.sett) ?? [];
    liste.push(rad);
    grupper.set(rad.sett, liste);
  }
  const per_sett: Record<string, EvalDelrapport> = {};
  for (const [sett, rader] of grupper) per_sett[sett] = evalDelrapport(rader);
  return {
    antall: samlet.antall,
    vurdert: samlet.vurdert,
    treff: samlet.treff,
    rate: samlet.rate,
    per_verdi: samlet.per_verdi,
    per_sett,
    utsatt: sakerUt.filter((s) => s.grunn !== "ok").map((s) => s.id),
    token_forbruk: summerTokenForbruk(sakerUt.map((s) => s.tokens)),
    saker: sakerUt,
  };
}
