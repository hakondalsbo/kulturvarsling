// Ren logikk for «Mobiliser nå» og felles innspill.
// Ingen Deno- eller databasekall. Klienten og Edge Function deler filen.
//
// Beslutningsnotatet 24.10.2026 gjelder der det avviker fra P1–P11.
// Samtykketeksten under er ordrett, med plassholderne [mottaker],
// [rolle/organisasjon] og [dato] slik de står i notatet.

import { finnUdokumenterteTall, kildegrunnlag } from "./kildekontroll.ts";

export const SAMTYKKE_VERSJON = "felles-innspill-2026-10-24";

/** Vedtatt av Håkon 24.10 kl. 17:23. Ikke en del av samtykkemalen. */
export const PERSONVERN_EPOST = "post@kulturvarsling.no";

/** Ordrett mal. Fet skrift i notatet er utheving, ikke egne ord. */
export const SAMTYKKE_MAL =
  "Jeg vil signere dette innspillet til [mottaker]. Jeg samtykker til at Kulturvarsling AS lagrer navnet mitt, e-postadressen min og det jeg ellers fyller ut, og at navn, [rolle/organisasjon] og kommune sendes til [mottaker] sammen med innspillet rundt [dato].\n" +
  "Jeg forstår at innspill med navn ofte blir offentlige, for eksempel på regjeringen.no eller stortinget.no. E-postadressen min deles aldri. Den brukes bare til å bekrefte signaturen og si fra hvordan det gikk.\n" +
  "Jeg kan trekke signaturen helt til innspillet er sendt, via lenken i e-posten. E-posten min slettes 30 dager etter innsending, og navnet mitt slettes hos oss etter 12 måneder. Du må være minst 16 år. [Les mer i personvernerklæringen]";

export const VARSEL_FASER = [
  "tidlig_signal",
  "utredning_horing",
  "regjeringens_forslag",
  "stortingskomite",
  "vedtak",
  "kommunal_behandling",
  "etterpa",
] as const;

export type VarselFase = (typeof VARSEL_FASER)[number];

export const RATE_EPOST = 5;
export const RATE_IP = 20;

const UTKAST_AV = "UTKAST – må gjennomgås og eventuelt endres av";
const FORBUDTE = ["alvorlig", "dramatisk", "trussel", "krever", "uakseptabelt", "historisk"];

export type MobiliserMiljo = {
  vercelEnv?: string | null;
  signaturEksplisitt?: string | null;
  panelEksplisitt?: string | null;
  demo?: string | null;
};

/** Serverhemmelighet. Bare nøyaktig true, etter trim og små bokstaver. Preview åpner ikke mottak. */
export function signaturMottakAktiv(verdi: string | null | undefined): boolean {
  return typeof verdi === "string" && verdi.trim().toLowerCase() === "true";
}

function visNarPreview(eksplisitt: string | null | undefined, miljo: MobiliserMiljo): boolean {
  const v = (eksplisitt ?? "").trim().toLowerCase();
  if (v === "false") return false;
  if (v === "true") return true;
  if ((miljo.demo ?? "").trim().toLowerCase() === "true") return true;
  return (miljo.vercelEnv ?? "").trim().toLowerCase() === "preview";
}

/** Visning i nettleseren. Av som standard. Preview og demo viser demodata, de tar ikke imot signaturer. */
export function signaturVises(miljo: MobiliserMiljo): boolean {
  return visNarPreview(miljo.signaturEksplisitt, miljo);
}

export function panelVises(miljo: MobiliserMiljo): boolean {
  return visNarPreview(miljo.panelEksplisitt, miljo);
}

export function erGyldigEpost(epost: string): boolean {
  if (epost.length < 3 || epost.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epost);
}

export function normaliserEpost(epost: string): string {
  return epost.trim().toLowerCase();
}

const FELT_LENGDE = { navn: 120, epost: 320, rolle: 120, organisasjon: 160, kommune: 80 } as const;

function feltTekst(verdi: unknown, maks: number): { ok: true; tekst: string } | { ok: false } {
  if (verdi == null || verdi === "") return { ok: true, tekst: "" };
  if (typeof verdi !== "string" || verdi.length > maks) return { ok: false };
  return { ok: true, tekst: verdi.replace(/[\u0000-\u001F\u007F]/g, "").trim() };
}

export type SigneringVerdi = {
  navn: string;
  epost: string;
  rolle: string;
  organisasjonsnavn: string;
  kommune: string;
  synlighet: "skjult";
  samtykkeTekstVersjon: string;
  minstealderBekreftet: true;
};

/**
 * Ett avkrysningsfelt, aldri forhåndsutfylt. Navn og e-post kreves.
 * Rolle, organisasjon og kommune er frivillig.
 * Synlighet tvinges til skjult: notatet sier at navn ikke vises på nettstedet.
 */
export function validerSignering(
  body: unknown,
  ctx: { mottaker: string; dato: string },
): { ok: true; bot: true } | { ok: true; bot: false; verdi: SigneringVerdi } | { ok: false; feil: string } {
  if (!body || typeof body !== "object") return { ok: false, feil: "Ugyldig forespørsel." };
  const felt = body as Record<string, unknown>;
  if (typeof felt.kv_hp_felt === "string" && felt.kv_hp_felt.trim() !== "") {
    return { ok: true, bot: true };
  }
  if (felt.samtykke !== true) {
    return { ok: false, feil: "Du må krysse av for samtykke. Avkrysningen er ikke fylt ut på forhånd." };
  }
  if (felt.samtykke_tekst_versjon !== SAMTYKKE_VERSJON) {
    return { ok: false, feil: "Samtykketeksten er utdatert. Last siden på nytt." };
  }
  if (!ctx.mottaker.trim() || !ctx.dato.trim()) {
    return { ok: false, feil: "Innspillet mangler mottaker eller dato. Det kan ikke signeres ennå." };
  }
  const navnFelt = feltTekst(felt.navn, FELT_LENGDE.navn);
  const epostFelt = feltTekst(felt.epost, FELT_LENGDE.epost);
  const rolleFelt = feltTekst(felt.rolle, FELT_LENGDE.rolle);
  const orgFelt = feltTekst(felt.organisasjon, FELT_LENGDE.organisasjon);
  const kommuneFelt = feltTekst(felt.kommune, FELT_LENGDE.kommune);
  if (!navnFelt.ok || !epostFelt.ok || !rolleFelt.ok || !orgFelt.ok || !kommuneFelt.ok) {
    return { ok: false, feil: "Ett av feltene er for langt." };
  }
  const navn = navnFelt.tekst;
  if (navn.length < 2) return { ok: false, feil: "Skriv inn navnet ditt." };
  const epost = normaliserEpost(epostFelt.tekst);
  if (!erGyldigEpost(epost)) return { ok: false, feil: "Skriv inn en gyldig e-postadresse." };
  return {
    ok: true,
    bot: false,
    verdi: {
      navn,
      epost,
      rolle: rolleFelt.tekst,
      organisasjonsnavn: orgFelt.tekst,
      kommune: kommuneFelt.tekst,
      synlighet: "skjult",
      samtykkeTekstVersjon: SAMTYKKE_VERSJON,
      minstealderBekreftet: true,
    },
  };
}

/** Det underskriveren faktisk så. Malen i samtykke_tekster beholder plassholderne. */
export function fyllSamtykke(mottaker: string, dato: string, mal: string = SAMTYKKE_MAL): string {
  return mal
    .replaceAll("[mottaker]", mottaker.trim())
    .replaceAll("[dato]", dato.trim())
    .replaceAll("[rolle/organisasjon]", "rolle eller organisasjon");
}

export function erRateBlokkert(epostAntall: number, ipAntall: number): boolean {
  return epostAntall >= RATE_EPOST || ipAntall >= RATE_IP;
}

export type SignaturTilstand = {
  samtykkeGittTid: string | null;
  bekreftetTid: string | null;
  trukketTid: string | null;
  trekkForespurtTid: string | null;
};

/** Teller først etter bekreftelse, og ikke etter trekk før innsending. */
export function tellerMed(rad: SignaturTilstand): boolean {
  return !!rad.samtykkeGittTid && !!rad.bekreftetTid && !rad.trukketTid;
}

export function bekreftSignatur(
  rad: SignaturTilstand,
): { ok: true; allerede: boolean } | { ok: false; feil: string } {
  if (!rad.samtykkeGittTid) return { ok: false, feil: "Samtykke mangler." };
  if (rad.trukketTid) return { ok: false, feil: "Signaturen er trukket tilbake." };
  if (rad.bekreftetTid) return { ok: true, allerede: true };
  return { ok: true, allerede: false };
}

export type TrekkUtfall = "trukket" | "forespurt" | "allerede_trukket" | "allerede_forespurt";

/**
 * Før innsending: ett klikk trekker signaturen.
 * Etter innsending kan vi ikke hente den tilbake hos mottakeren.
 * Vi registrerer bare et ønske om å si fra. Ingen e-post sendes her.
 */
export function trekkSignatur(rad: SignaturTilstand, sendt: boolean): TrekkUtfall {
  if (!sendt) {
    if (rad.trukketTid) return "allerede_trukket";
    return "trukket";
  }
  if (rad.trekkForespurtTid) return "allerede_forespurt";
  return "forespurt";
}

export type Personrad = {
  navn: string | null;
  epost: string | null;
  rolle: string | null;
  organisasjonsnavn: string | null;
  kommune: string | null;
  tokenHash: string | null;
  epostSlettesEtter: string | null;
  slettesEtter: string | null;
};

export type SletteResultat<T extends Personrad> =
  | { behold: false }
  | { behold: true; rad: T };

function forfalt(frist: string | null, naa: string): boolean {
  if (!frist) return false;
  const a = Date.parse(frist);
  const b = Date.parse(naa);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return a <= b;
}

/**
 * Etter innsending: e-post nullstilles 30 dager etter, navnelisten 12 måneder etter.
 * Raden beholdes så antallet kan stå. Uten innsending slettes hele raden
 * 12 måneder etter at innspillet er avsluttet.
 */
export function anvendSletting<T extends Personrad>(rad: T, naa: string, sendt: boolean): SletteResultat<T> {
  if (!sendt && forfalt(rad.slettesEtter, naa)) return { behold: false };
  const neste: T = { ...rad };
  if (forfalt(rad.epostSlettesEtter, naa)) neste.epost = null;
  if (sendt && forfalt(rad.slettesEtter, naa)) {
    neste.navn = null;
    neste.epost = null;
    neste.rolle = null;
    neste.organisasjonsnavn = null;
    neste.kommune = null;
    neste.tokenHash = null;
  }
  return { behold: true, rad: neste };
}

export function slettefrister(tidspunkt: string, sendt: boolean): { epostSlettesEtter: string; slettesEtter: string } {
  const start = new Date(tidspunkt);
  if (Number.isNaN(start.getTime())) {
    throw new Error("Ugyldig tidspunkt for sletting");
  }
  if (!sendt) {
    const alt = leggTilManeder(start, 12).toISOString();
    return { epostSlettesEtter: alt, slettesEtter: alt };
  }
  const epost = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return { epostSlettesEtter: epost, slettesEtter: leggTilManeder(start, 12).toISOString() };
}

function leggTilManeder(start: Date, maneder: number): Date {
  const kopi = new Date(start.getTime());
  const dag = kopi.getUTCDate();
  kopi.setUTCMonth(kopi.getUTCMonth() + maneder);
  if (kopi.getUTCDate() < dag) kopi.setUTCDate(0);
  return kopi;
}

export type EksportLinje = {
  navn: string;
  rolle: string;
  organisasjon: string;
  kommune: string;
};

export type SignaturForEksport = SignaturTilstand & {
  navn: string | null;
  rolle: string | null;
  organisasjonsnavn: string | null;
  kommune: string | null;
  epost?: string | null;
};

/** Til mottakeren: innspillets navneliste. Aldri e-post. Bare bekreftede som ikke er trukket. */
export function eksportTilMottaker(rader: SignaturForEksport[]): { totalt: number; linjer: EksportLinje[] } {
  const med = rader.filter(tellerMed);
  const linjer: EksportLinje[] = [];
  for (const rad of med) {
    if (!rad.navn) continue;
    linjer.push({
      navn: rad.navn,
      rolle: rad.rolle ?? "",
      organisasjon: rad.organisasjonsnavn ?? "",
      kommune: rad.kommune ?? "",
    });
  }
  return { totalt: med.length, linjer };
}

export function lagListeTekst(tittel: string, totalt: number, linjer: EksportLinje[]): string {
  const hode = [
    tittel,
    `Antall bekreftede signaturer: ${totalt}`,
    "E-post er ikke med.",
    "Innspill med navn kan bli offentlige hos mottakeren.",
    "",
    "Navn; rolle; organisasjon; kommune",
  ];
  const rader = linjer.map((linje) =>
    [linje.navn, linje.rolle, linje.organisasjon, linje.kommune].map(csv).join(";"),
  );
  return [...hode, ...rader].join("\n");
}

function csv(verdi: string): string {
  if (/[;"\n]/.test(verdi)) return `"${verdi.replace(/"/g, '""')}"`;
  return verdi;
}

export function lagEnkelPdf(linjer: string[]): Uint8Array {
  const kommandoer = linjer.slice(0, 40).map((linje, i) => {
    const y = 800 - i * 18;
    return `BT /F1 11 Tf 48 ${y} Td (${pdfTekst(linje)}) Tj ET`;
  }).join("\n");
  const strom = `BT /F1 11 Tf ET\n${kommandoer}`;
  const objekter = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${strom.length} >> stream\n${strom}\nendstream endobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offset = [0];
  for (const obj of objekter) {
    offset.push(pdf.length);
    pdf += obj;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objekter.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offset.length; i++) {
    pdf += `${String(offset[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objekter.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

const WIN: Record<string, number> = {
  "æ": 0xe6, "ø": 0xf8, "å": 0xe5, "Æ": 0xc6, "Ø": 0xd8, "Å": 0xc5,
  "–": 0x96, "—": 0x97, "«": 0xab, "»": 0xbb,
};

function pdfTekst(verdi: string): string {
  let ut = "";
  for (const tegn of verdi) {
    if (tegn === "\\") ut += "\\\\";
    else if (tegn === "(") ut += "\\(";
    else if (tegn === ")") ut += "\\)";
    else if (WIN[tegn]) ut += `\\${WIN[tegn].toString(8).padStart(3, "0")}`;
    else if (tegn.charCodeAt(0) < 32 || tegn.charCodeAt(0) > 126) ut += "?";
    else ut += tegn;
  }
  return ut;
}

export function erVarselFase(verdi: unknown): verdi is VarselFase {
  return typeof verdi === "string" && (VARSEL_FASER as readonly string[]).includes(verdi);
}

export type SakGrunnlag = {
  tittel?: string | null;
  sammendrag?: string | null;
  instans?: string | null;
  frist?: string | null;
  kilde?: string | null;
  fase?: string | null;
};

export type PanelModell = {
  merke: "handling" | "orientering";
  merkeTekst: "Du kan gjøre noe ▸" | "Til orientering –";
  handling: string;
  hvem: string;
  frist: string | null;
  fristIso: string | null;
  utkast: string | null;
  innsending: string | null;
  lukket: boolean;
};

/**
 * Én ●-handling per fase, den kanalen tabellen i mobiliseringskonseptet
 * peker ut som beste valg. Ved flere ● velges høringsinnspill foran
 * kontakt, og kontakt foran felles uttalelse. Signering tilbys ikke her.
 */
const FASE_HANDLING: Record<VarselFase, { handling: string; hvem: string; lukket: boolean; merke: "handling" | "orientering" }> = {
  tidlig_signal: {
    handling: "Ta kontakt med programkomiteen mens partiprogrammet skrives.",
    hvem: "Partienes programkomiteer",
    lukket: false,
    merke: "handling",
  },
  utredning_horing: {
    handling: "Send et høringsinnspill før fristen.",
    hvem: "Instansen som har sendt saken på høring",
    lukket: false,
    merke: "handling",
  },
  regjeringens_forslag: {
    handling: "Ta kontakt med partienes fagpolitikere.",
    hvem: "Partienes fagpolitikere",
    lukket: false,
    merke: "handling",
  },
  stortingskomite: {
    handling: "Send et samordnet innspill til komiteen.",
    hvem: "Komiteen på Stortinget som har saken",
    lukket: false,
    merke: "handling",
  },
  vedtak: {
    handling: "Vinduet er lukket. Neste mulighet er å følge opp etterpå.",
    hvem: "Organet som har gjort vedtaket",
    lukket: true,
    merke: "orientering",
  },
  kommunal_behandling: {
    handling: "Ta kontakt med gruppelederne før formannskapet.",
    hvem: "Gruppelederne i kommunestyret",
    lukket: false,
    merke: "handling",
  },
  etterpa: {
    handling: "Skriv hvordan det gikk.",
    hvem: "Den som følger saken etterpå",
    lukket: false,
    merke: "handling",
  },
};

export function innsendingslenke(kilde: string | null | undefined): string | null {
  if (!kilde) return null;
  try {
    const url = new URL(kilde.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function fristTekst(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const dag = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dag)) return null;
  const [år, mnd, dato] = dag.split("-").map(Number);
  const dt = new Date(Date.UTC(år, mnd - 1, dato));
  if (dt.getUTCFullYear() !== år || dt.getUTCMonth() !== mnd - 1 || dt.getUTCDate() !== dato) return null;
  return new Intl.DateTimeFormat("nb-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

export function normaliserForSitat(tekst: string): string {
  return tekst
    .replace(/\u00ad/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function sitatFinnes(sitat: string, kilde: string): boolean {
  const naal = normaliserForSitat(sitat);
  if (!naal) return false;
  return normaliserForSitat(kilde).includes(naal);
}

function antallOrd(tekst: string): number {
  return tekst.trim().split(/\s+/).filter(Boolean).length;
}

function forsteSetning(tekst: string): string | null {
  const trimmet = tekst.trim();
  if (!trimmet) return null;
  const punktum = trimmet.search(/\.\s|\.$/);
  const setning = punktum === -1 ? trimmet : trimmet.slice(0, punktum + 1).trim();
  if (antallOrd(setning) > 30) return null;
  if (!sitatFinnes(setning, trimmet)) return null;
  return setning;
}

function sikreKildetro(merknad: string, kilde: string): string {
  let tekst = merknad.replace(/«([^»]*)»/g, (hel, indre: string) => {
    if (sitatFinnes(indre, kilde)) return hel;
    return "[SJEKK: sitatet ble ikke funnet i kilden]";
  });
  const avvik = finnUdokumenterteTall(tekst, kilde);
  for (const tall of [...avvik.aar, ...avvik.tall]) {
    const monster = new RegExp(`(?<![\\d])${tall.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\d])`, "g");
    tekst = tekst.replace(monster, "[SJEKK]");
  }
  return tekst;
}

function merkelinje(av: string): string {
  return `${UTKAST_AV} ${av} før innsending`;
}

export function lagUtkast(sak: SakGrunnlag, datoTekst: string, av = "deg"): { tekst: string; merknad: string } {
  const kilde = kildegrunnlag([sak.tittel, sak.sammendrag, sak.instans, sak.frist, sak.kilde]);
  const linje = merkelinje(av.trim() || "deg");
  const mottaker = sak.instans?.trim()
    ? sak.instans.trim()
    : `[SPØRSMÅL: Vi fant ikke mottaker i saken. Sjekk på ${innsendingslenke(sak.kilde) ?? "kilden"}.]`;
  const frist = fristTekst(sak.frist);
  const fristLinje = frist
    ? `Frist: ${frist}`
    : `[SPØRSMÅL: Vi fant ikke frist i saken. Sjekk på ${innsendingslenke(sak.kilde) ?? "kilden"}.]`;
  const tittel = sak.tittel?.trim() || "[SPØRSMÅL: Vi fant ikke tittel i saken.]";
  const lenke = innsendingslenke(sak.kilde);
  const setning = sak.sammendrag ? forsteSetning(sak.sammendrag) : null;
  const sitat = setning ? `«${setning}»` : "";
  const stengt = sak.fase === "vedtak"
    ? "Vinduet for å påvirke dette vedtaket er lukket. Teksten under kan brukes til en oppfølging etterpå.\n\n"
    : "";
  const merknadRad = sikreKildetro(
    [
      stengt.trim(),
      sitat,
      "[SPØRSMÅL: Støtter dere forslaget, eller vil dere ha det endret? Hvorfor?]",
    ].filter(Boolean).join("\n\n"),
    kilde,
  );
  const digitalt = /digitalt|send inn/i.test(kilde) && lenke
    ? `Svaret skal sendes digitalt. Lenken står i saken: ${lenke}`
    : null;
  const etter = [
    "Til dere før innsending:",
    "Høringssvar og innspill blir normalt offentlige.",
    digitalt,
    "Kulturvarsling sender ikke inn utkastet.",
  ].filter((linjeTekst): linjeTekst is string => !!linjeTekst);
  const tekst = [
    linje,
    "",
    `Til: ${mottaker}`,
    `Sak: ${tittel}${lenke ? ` (${lenke})` : ""}`,
    fristLinje,
    `Fra: ${av.trim() || "deg"}`,
    `Dato: ${datoTekst}`,
    "",
    "1. Hvem vi er",
    "[SPØRSMÅL: Hvem skriver, og hva driver dere med?]",
    "",
    "2. Hva vi mener, kort fortalt",
    "[SPØRSMÅL: Hva er hovedpoenget deres, med egne ord?]",
    "",
    "3. Merknader",
    merknadRad,
    "",
    "4. Avslutning",
    "Takk for muligheten til å svare.",
    "",
    linje,
    "",
    ...etter,
  ].join("\n");
  return { tekst, merknad: merknadRad };
}

export function utkastErMerke(tekst: string, av = "deg"): boolean {
  const merke = merkelinje(av);
  const forste = tekst.split("\n")[0];
  const sisteMerke = tekst.split("\n").filter((linje) => linje.trim() === merke);
  return forste === merke && sisteMerke.length >= 2 && !egetStemmeInneholderForbudt(tekst);
}

export function byggPanel(sak: SakGrunnlag, dato: Date = new Date()): PanelModell {
  const fristIso = sak.frist ? String(sak.frist).slice(0, 10) : null;
  const frist = fristTekst(sak.frist);
  const lenke = innsendingslenke(sak.kilde);
  const instans = sak.instans?.trim() || "";
  const fase = erVarselFase(sak.fase) ? sak.fase : null;
  const datoTekst = new Intl.DateTimeFormat("nb-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Oslo",
  }).format(dato);

  if (!fase) {
    return {
      merke: "orientering",
      merkeTekst: "Til orientering –",
      handling: "Varselredaktøren har ikke satt fasen. Vi anbefaler ingen handling før den er satt.",
      hvem: instans || "Instansen står ikke i saken.",
      frist,
      fristIso: frist ? fristIso : null,
      utkast: null,
      innsending: lenke,
      lukket: false,
    };
  }

  const valgt = FASE_HANDLING[fase];
  const utkast = lagUtkast(sak, datoTekst);
  return {
    merke: valgt.merke,
    merkeTekst: valgt.merke === "handling" ? "Du kan gjøre noe ▸" : "Til orientering –",
    handling: valgt.handling,
    hvem: instans || valgt.hvem,
    frist,
    fristIso: frist ? fristIso : null,
    utkast: utkast.tekst,
    innsending: lenke,
    lukket: valgt.lukket,
  };
}

export function egetStemmeInneholderForbudt(tekst: string): boolean {
  const utenSitat = tekst.replace(/«[^»]*»/g, "");
  const lav = utenSitat.toLowerCase();
  return FORBUDTE.some((ord) => lav.includes(ord)) || lav.includes("!");
}

export type InnspillRef = {
  id: string;
  sakId: string | null;
  tittel: string;
};

export type StottetInnspill = {
  innspillId: string;
  tittel: string;
  sakId: string | null;
  bekreftet: boolean;
  trukket: boolean;
};

/** Innspill på saker brukeren følger, minus det som allerede er støttet. */
export function foreslaaInnspill<T extends InnspillRef>(
  innspill: T[],
  fulgteSakIder: Array<string | number>,
  alleredeStottet: string[] = [],
): T[] {
  const fulgt = new Set(fulgteSakIder.map((id) => String(id)));
  const stottet = new Set(alleredeStottet.map(String));
  return innspill.filter((rad) => !!rad.sakId && fulgt.has(String(rad.sakId)) && !stottet.has(rad.id));
}

/** Bare innlogget bruker får sin egen liste. Ubekreftet og trukket skilles fra det som teller. */
export function synligeStotte(rader: StottetInnspill[], innlogget: boolean): StottetInnspill[] {
  if (!innlogget) return [];
  return rader.filter((rad) => rad.bekreftet && !rad.trukket);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function erUuid(verdi: unknown): verdi is string {
  return typeof verdi === "string" && UUID.test(verdi);
}

/**
 * Captcha er av til MOBILISERING_CAPTCHA_AKTIV er nøyaktig true.
 * Nøkkel kreves ikke for at funksjonen skal starte. Er flagget på uten nøkkel,
 * avvises signeringen. Turnstile sjekkes bare da.
 */
export function vurderCaptcha(input: {
  flagg: string | null | undefined;
  hemmelighet: string | null | undefined;
  token: unknown;
}): { krev: false } | { krev: true; token: string } | { krev: true; feil: string; status: 400 | 503 } {
  if (!signaturMottakAktiv(input.flagg)) return { krev: false };
  const hemmelighet = (input.hemmelighet ?? "").trim();
  if (!hemmelighet) {
    return { krev: true, feil: "Captcha er slått på, men nøkkelen er ikke satt.", status: 503 };
  }
  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (token.length < 10 || token.length > 2048) {
    return { krev: true, feil: "Bekreft at du ikke er en robot.", status: 400 };
  }
  return { krev: true, token };
}

export async function sha256Hex(tekst: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
