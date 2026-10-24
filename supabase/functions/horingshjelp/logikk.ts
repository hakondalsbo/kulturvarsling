// Ren logikk for høringshjelp. Ingen Deno-kall, så npm test kan kjøre den.
// Utkastet sendes ikke. Kalleren lagrer det bare hvis brukeren selv ber om det.

import { loggUdokumenterteTall, type Tallavvik } from "../_shared/kildekontroll.ts";

export const HORING_MODELL = "claude-sonnet-5";
export const HORING_MAKS_TOKENS = 4000;
export const HORING_TEMPERATUR = 0.2;
export const MAKS_KILDETEGN = 24_000;

export type Syn = "støtter" | "støtter med endringer" | "er imot" | "vet ikke";

export type PunktSvar = {
  nr: string;
  syn: Syn;
  hvorfor: string;
};

export type SakRad = {
  id: string;
  tittel: string;
  sammendrag: string | null;
  instans: string | null;
  frist: string | null;
  kilde: string | null;
};

export type Kildegrunnlag = "notat" | "sak" | "innlimt";

export type OffisiellKilde = {
  tekst: string;
  hentet: string | null;
  grunnlag: Kildegrunnlag;
};

export type HoringSjekk = {
  tall: Tallavvik;
  sitater_fjernet: number;
  punkter_mangler: string[];
  for_lang: boolean;
  merkelinje: boolean;
};

const SYNPUNKT = new Set<Syn>(["støtter", "støtter med endringer", "er imot", "vet ikke"]);

export function merkelinje(organisasjon: string): string {
  const navn = organisasjon.trim() || "organisasjonen";
  return `UTKAST – må gjennomgås og eventuelt endres av ${navn} før innsending`;
}

export function hentBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

export async function sha256(tekst: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function datoOslo(nå: Date): string {
  return new Intl.DateTimeFormat("nb-NO", {
    timeZone: "Europe/Oslo",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(nå);
}

function fyll(mal: string, felt: Record<string, string>): string {
  let ut = mal;
  for (const [nokkel, verdi] of Object.entries(felt)) {
    ut = ut.split(`{${nokkel}}`).join(verdi);
  }
  return ut;
}

function kort(verdi: unknown, maks: number): string {
  if (typeof verdi !== "string") return "";
  return verdi.replace(/\s+/g, " ").trim().slice(0, maks);
}

export function lesPunkter(verdi: unknown): PunktSvar[] | null {
  if (!Array.isArray(verdi)) return [];
  if (verdi.length > 12) return null;
  const ut: PunktSvar[] = [];
  for (const rad of verdi) {
    if (!rad || typeof rad !== "object") return null;
    const kilde = rad as Record<string, unknown>;
    const nr = kort(kilde.nr, 40);
    const syn = kort(kilde.syn, 40);
    if (!nr || !SYNPUNKT.has(syn as Syn)) return null;
    ut.push({ nr, syn: syn as Syn, hvorfor: kort(kilde.hvorfor, 800) });
  }
  return ut;
}

export function byggBrukersvar(inn: {
  organisasjon: string;
  beskrivelse: string;
  punkter: PunktSvar[];
  erfaringer: string;
}): string {
  const linjer = [
    `Organisasjon: ${inn.organisasjon}`,
    `Om organisasjonen: ${inn.beskrivelse || "(ikke oppgitt)"}`,
    "Punkter organisasjonen vil kommentere:",
  ];
  if (!inn.punkter.length) linjer.push("(ingen punkter er valgt)");
  for (const punkt of inn.punkter) {
    linjer.push(`Punkt ${punkt.nr}: ${punkt.syn}. Begrunnelse: ${punkt.hvorfor || "(ikke oppgitt)"}`);
  }
  linjer.push(`Egne erfaringer og tall: ${inn.erfaringer || "(ingen)"}`);
  return linjer.join("\n");
}

const PROMPT = `Du lager UTKAST til høringssvar for norske kulturorganisasjoner. Utkastet skal leses, endres og sendes inn av organisasjonen selv. Du sender aldri noe.

KILDER
Du har bare to kilder:
1. KILDETEKST: høringsbrevet og høringsnotatet nedenfor.
2. BRUKERSVAR: det organisasjonen har fortalt om seg selv og hva den mener.
Alt du skriver om saken, skal stå i KILDETEKST. Alt du skriver om organisasjonens syn, erfaringer og tall, skal stå i BRUKERSVAR. Bruk ikke annen kunnskap.

KILDETROSKAP:
- Bruk bare opplysninger som står i KILDETEKST eller BRUKERSVAR. Ikke gjett og ikke finn på.
- Ikke legg til vurderinger, superlativer, konsekvenser, datoer eller tall som ikke står der.
- Hvis kilden ikke sier det, skriv «kilden sier ikke …» eller et spørsmål i hakeparentes.
- En henvisning til punkt skal bruke punktnummeret slik det står i KILDETEKST. Ikke finn på et nytt nummer.

DU SKAL ALDRI
- finne på tall, beløp, datoer, sitater, erfaringer, medlemstall eller eksempler
- tillegge organisasjonen et standpunkt den ikke har gitt i BRUKERSVAR
- tillegge departementet, andre organisasjoner eller partier meninger som ikke står i KILDETEKST
- vise til et punktnummer som ikke finnes i KILDETEKST
- skrive at noe er vedtatt når det er et forslag
- bruke ord som «alvorlig», «dramatisk», «trussel», «krever», «uakseptabelt», «historisk» eller utropstegn
- skrive «kritisk» om innholdet

NÅR NOE MANGLER
Hvis BRUKERSVAR ikke sier hva organisasjonen mener om et punkt den vil kommentere, skriv et spørsmål i stedet for et standpunkt, i dette formatet:
[SPØRSMÅL: ...]
Hvis frist eller mottaker ikke står i KILDETEKST, skriv:
[SPØRSMÅL: Vi fant ikke mottaker/frist i høringsbrevet. Sjekk på {lenke}.]
Det er bedre med tre gode spørsmål enn ett oppdiktet svar.

SITATER OG HENVISNINGER
- Start hver merknad med «Til punkt X Overskrift» slik punktet er nummerert i høringsnotatet.
- Sitater fra KILDETEKST skal være ordrette og stå i anførselstegn. Hold dem korte, maks 30 ord.
- Gjengi forslaget nøytralt før du skriver organisasjonens syn: først «Departementet foreslår …», så «{organisasjon} støtter / støtter med endringer / er imot …», så hvorfor, med organisasjonens egne begrunnelser.

SPRÅK
Norsk bokmål. Korte setninger. Vanlige ord. Saklig og høflig. Forklar faguttrykk kort første gang hvis organisasjonen ikke er en fagaktør på området. Ingen fyllord, ingen overdrivelser, ingen selgende formuleringer.

STRUKTUR (følg nøyaktig)
Linje 1: UTKAST – må gjennomgås og eventuelt endres av {organisasjon} før innsending
Så:
Til: {mottaker}
Høring: {tittel} ({lenke})
Høringsfrist: {frist}
Fra: {organisasjon}
Dato: {dato}

1. Hvem vi er (2–4 setninger, maks 80 ord, bare fra BRUKERSVAR)
2. Hva vi mener, kort fortalt (1–3 kulepunkter, maks 60 ord til sammen)
3. Merknader til de enkelte punktene (én overskrift per punkt organisasjonen vil kommentere, maks 150 ord per punkt)
4. Avslutning (1–3 setninger, maks 50 ord. Takk for muligheten til å svare, og gjenta eventuelt hovedpoenget. Ingen nye argumenter.)

Siste linje: UTKAST – må gjennomgås og eventuelt endres av {organisasjon} før innsending

Hele utkastet skal være maks 800 ord, uten merkelinjene og toppteksten.

Etter siste merkelinje skriver du en kort liste med overskriften «Til dere før innsending:», med
- alle [SPØRSMÅL] samlet
- hvordan svaret skal sendes inn, hvis KILDETEKST sier det
- en påminnelse om at høringssvar normalt blir offentlige

KILDETEKST:
{kildetekst}

BRUKERSVAR:
{brukersvar}

Mottaker: {mottaker}
Frist: {frist}
Lenke: {lenke}
Organisasjon: {organisasjon}
Dato: {dato}`;

export function avgrensKildetekst(kilde: string, punktnr: string[]): { tekst: string; kuttet: boolean } {
  const ren = kilde.trim();
  if (ren.length <= MAKS_KILDETEGN) return { tekst: ren, kuttet: false };
  const intro = ren.slice(0, 4000);
  const valgte = punktnr
    .map((nr) => {
      const idx = ren.indexOf(nr);
      if (idx < 0) return "";
      return ren.slice(Math.max(0, idx - 200), idx + 2500);
    })
    .filter(Boolean);
  const tekst = [intro, ...valgte].join("\n\n").slice(0, MAKS_KILDETEGN);
  const merke = punktnr.length ? punktnr.join(", ") : "innledningen";
  return {
    tekst: `${tekst}\n\n[MERK: Utkastet bygger bare på punkt ${merke}]`,
    kuttet: true,
  };
}

export function byggPrompt(inn: {
  organisasjon: string;
  kildetekst: string;
  brukersvar: string;
  mottaker: string;
  tittel: string;
  frist: string;
  lenke: string;
  dato: string;
}): string {
  return fyll(PROMPT, {
    organisasjon: inn.organisasjon,
    kildetekst: inn.kildetekst,
    brukersvar: inn.brukersvar,
    mottaker: inn.mottaker || "[SPØRSMÅL: Vi fant ikke mottaker i høringsbrevet.]",
    tittel: inn.tittel || "(uten tittel)",
    frist: inn.frist || "[SPØRSMÅL: Vi fant ikke frist i høringsbrevet.]",
    lenke: inn.lenke || "https://www.regjeringen.no",
    dato: inn.dato,
  });
}

function normSitat(tekst: string): string {
  return tekst
    .replace(/\u00ad/g, "")
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function sjekkSitater(tekst: string, kilde: string): { tekst: string; fjernet: number } {
  const normKilde = normSitat(kilde);
  let fjernet = 0;
  const ut = tekst.replace(/«([^»]{1,500})»|"([^"]{1,500})"|“([^”]{1,500})”/g, (hele, a, b, c) => {
    const innhold = String(a || b || c || "");
    if (!innhold.trim()) return hele;
    if (normKilde.includes(normSitat(innhold))) return hele;
    fjernet += 1;
    return "[SJEKK: sitatet ble ikke funnet i kilden]";
  });
  return { tekst: ut, fjernet };
}

function punktFinnes(nr: string, kilde: string): boolean {
  const monster = new RegExp(`(?:^|[^\\d.])${nr.replace(/\./g, "\\.")}(?!\\d)`);
  return monster.test(kilde);
}

function sjekkPunkter(tekst: string, kilde: string): { tekst: string; mangler: string[] } {
  const mangler: string[] = [];
  const ut = tekst.replace(/Til punkt\s+([0-9]+(?:\.[0-9]+)*)/g, (hele, nr: string) => {
    if (punktFinnes(nr, kilde)) return hele;
    if (!mangler.includes(nr)) mangler.push(nr);
    return `${hele} [SJEKK: punktet finnes ikke i høringsnotatet]`;
  });
  return { tekst: ut, mangler };
}

function tekstForTall(tekst: string): string {
  return tekst
    .split("\n")
    .filter((linje) => {
      const t = linje.trim();
      if (t.startsWith("UTKAST")) return false;
      if (/^\d+\.\s+/.test(t)) return false;
      if (/^(Til|Høring|Høringsfrist|Fra|Dato):/.test(t)) return false;
      return true;
    })
    .join("\n")
    .replace(/punkt\s+[0-9]+(?:\.[0-9]+)*/gi, "punkt")
    .replace(/\[(?:SPØRSMÅL|SJEKK|MERK):[^\]]*\]/g, " ");
}

function markerTall(tekst: string, avvik: Tallavvik): string {
  let ut = tekst;
  const tokens = [...avvik.aar, ...avvik.tall];
  for (const token of tokens) {
    const monster = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(",", "[,.]");
    const re = new RegExp(`(?<!\\d)(${monster})(?!\\d)(?!\\s*\\[SJEKK\\])`);
    ut = ut.replace(re, "$1 [SJEKK]");
  }
  return ut;
}

function sikreMerkelinjer(tekst: string, linje: string): { tekst: string; ok: boolean } {
  const deler = tekst.split("\n");
  const haleIdx = deler.findIndex((l) => l.trim().startsWith("Til dere før innsending"));
  const hode = (haleIdx === -1 ? deler : deler.slice(0, haleIdx)).slice();
  const hale = haleIdx === -1 ? [] : deler.slice(haleIdx);
  while (hode.length && hode[0].trim() === "") hode.shift();
  while (hode.length && hode[hode.length - 1].trim() === "") hode.pop();
  if (hode[0]?.trim() !== linje) {
    if (hode[0]?.trim().startsWith("UTKAST")) hode[0] = linje;
    else hode.unshift(linje);
  }
  if (hode[hode.length - 1]?.trim() !== linje) {
    if (hode.length === 1 || hode[hode.length - 1]?.trim().startsWith("UTKAST")) {
      if (hode.length === 1) hode.push(linje);
      else hode[hode.length - 1] = linje;
    } else hode.push(linje);
  }
  const ut = [...hode, ...hale].join("\n").trim();
  const linjer = ut.split("\n").map((l) => l.trim()).filter(Boolean);
  const forste = linjer[0] === linje;
  const sisteMerk = [...linjer].reverse().find((l) => l.startsWith("UTKAST")) === linje;
  return { tekst: ut, ok: forste && sisteMerk };
}

export function ordIUtkast(tekst: string): number {
  const linjer = tekst.split("\n");
  const hale = linjer.findIndex((l) => l.trim().startsWith("Til dere før innsending"));
  const kropp = (hale === -1 ? linjer : linjer.slice(0, hale)).filter((linje) => {
    const t = linje.trim();
    if (!t || t.startsWith("UTKAST")) return false;
    if (/^(Til|Høring|Høringsfrist|Fra|Dato):/.test(t)) return false;
    return true;
  });
  return kropp.join(" ").split(/\s+/).filter(Boolean).length;
}

function kuttMerknader(tekst: string): { tekst: string; kuttet: boolean } {
  if (ordIUtkast(tekst) <= 800) return { tekst, kuttet: false };
  const ut = tekst.split("\n");
  let kuttet = false;
  while (ordIUtkast(ut.join("\n")) > 800) {
    const start = ut.findIndex((l) => /^3\.\s+Merknader/.test(l.trim()));
    const slutt = ut.findIndex((l) => /^4\.\s+Avslutning/.test(l.trim()));
    if (start < 0 || slutt < 0 || slutt <= start + 1) break;
    ut.splice(slutt - 1, 1);
    kuttet = true;
  }
  if (ordIUtkast(ut.join("\n")) > 800) kuttet = true;
  if (kuttet && !ut.some((l) => l.includes("kuttet for å holde lengdegrensen"))) {
    const slutt = ut.findIndex((l) => /^4\.\s+Avslutning/.test(l.trim()));
    const merknad = "[MERK: Merknadene er kuttet for å holde lengdegrensen.]";
    if (slutt >= 0) ut.splice(slutt, 0, merknad);
    else ut.push(merknad);
  }
  return { tekst: ut.join("\n"), kuttet };
}

export function kontrollerUtkast(
  utkast: string,
  kilde: string,
  brukersvar: string,
  organisasjon: string,
  tillattEkstra: string,
  logg: (linje: string) => void = () => undefined,
): { tekst: string; sjekk: HoringSjekk } {
  const sitater = sjekkSitater(utkast, kilde);
  const punkter = sjekkPunkter(sitater.tekst, kilde);
  const grunnlag = [kilde, brukersvar, tillattEkstra].filter(Boolean).join("\n");
  const avvik = loggUdokumenterteTall("horingshjelp", tekstForTall(punkter.tekst), grunnlag, organisasjon, logg);
  const merket = markerTall(punkter.tekst, avvik);
  const medLinjer = sikreMerkelinjer(merket, merkelinje(organisasjon));
  const lengde = kuttMerknader(medLinjer.tekst);
  const slutt = sikreMerkelinjer(lengde.tekst, merkelinje(organisasjon));
  return {
    tekst: slutt.tekst,
    sjekk: {
      tall: avvik,
      sitater_fjernet: sitater.fjernet,
      punkter_mangler: punkter.mangler,
      for_lang: lengde.kuttet,
      merkelinje: slutt.ok,
    },
  };
}

export function htmlTilTekst(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function erPrivatV4(a: number, b: number): boolean {
  if (![a, b].every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function ipv4Deler(ip: string): [number, number, number, number] | null {
  const deler = ip.split(".");
  if (deler.length !== 4) return null;
  const tall = deler.map((del) => (/^\d{1,3}$/.test(del) ? Number(del) : NaN));
  if (tall.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return tall as [number, number, number, number];
}

/** Åtte hextetter, eller null når teksten ikke er en IPv6-adresse. */
function ipv6Hextetter(raw: string): number[] | null {
  let ip = raw.toLowerCase();
  const sone = ip.indexOf("%");
  if (sone !== -1) ip = ip.slice(0, sone);
  let v4: [number, number, number, number] | null = null;
  if (ip.includes(".")) {
    const kolon = ip.lastIndexOf(":");
    v4 = ipv4Deler(ip.slice(kolon + 1));
    if (!v4) return null;
    ip = ip.slice(0, kolon);
  }
  const sider = ip.split("::");
  if (sider.length > 2) return null;
  const les = (side: string) => {
    if (!side) return [] as number[];
    return side.split(":").map((del) => (/^[0-9a-f]{1,4}$/.test(del) ? parseInt(del, 16) : NaN));
  };
  const hode = les(sider[0]);
  const hale = sider.length === 2 ? les(sider[1]) : [];
  if ([...hode, ...hale].some((n) => Number.isNaN(n))) return null;
  const v4plass = v4 ? 2 : 0;
  let full: number[];
  if (sider.length === 1) {
    if (hode.length + v4plass !== 8) return null;
    full = hode;
  } else {
    const mangler = 8 - hode.length - hale.length - v4plass;
    if (mangler < 0) return null;
    full = [...hode, ...Array(mangler).fill(0), ...hale];
  }
  if (v4) full.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
  return full.length === 8 ? full : null;
}

function erPrivatV6(deler: number[]): boolean {
  if (deler.every((n) => n === 0)) return true;
  if (deler.slice(0, 7).every((n) => n === 0) && deler[7] === 1) return true;
  const a = deler[0];
  if ((a & 0xfe00) === 0xfc00) return true;
  if ((a & 0xffc0) === 0xfe80) return true;
  if ((a & 0xffc0) === 0xfec0) return true;
  if (deler.slice(0, 5).every((n) => n === 0) && deler[5] === 0xffff) {
    return erPrivatV4((deler[6] >> 8) & 255, deler[6] & 255);
  }
  return false;
}

export function tryggKildeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (host === "metadata.google.internal") return false;
    const v4 = ipv4Deler(host);
    if (v4) return !erPrivatV4(v4[0], v4[1]);
    if (host.includes(":")) {
      const v6 = ipv6Hextetter(host);
      if (!v6) return false;
      return !erPrivatV6(v6);
    }
    return true;
  } catch {
    return false;
  }
}

/** Neste hopp etter en manuell omdirigering. Null når Location mangler eller ikke er trygg. */
export function nesteTryggeUrl(fra: string, location: string | null): string | null {
  if (!location || !location.trim()) return null;
  try {
    const neste = new URL(location, fra).href;
    return tryggKildeUrl(neste) ? neste : null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type HoringBody = {
  varsel_id: string;
  organisasjon: string;
  beskrivelse: string;
  punkter: PunktSvar[];
  erfaringer: string;
  kildetekst: string;
};

export function lesBody(data: unknown): HoringBody | string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "Ugyldig forespørsel";
  const rad = data as Record<string, unknown>;
  const varselId = typeof rad.varsel_id === "string" ? rad.varsel_id.trim() : "";
  if (!UUID.test(varselId)) return "Ugyldig sak";
  const organisasjon = kort(rad.organisasjon, 200);
  if (organisasjon.length < 2) return "Skriv organisasjonens navn";
  const punkter = lesPunkter(rad.punkter);
  if (!punkter) return "Ugyldige punkter";
  const kildetekst = typeof rad.kildetekst === "string" ? rad.kildetekst.slice(0, 50_000) : "";
  return {
    varsel_id: varselId,
    organisasjon,
    beskrivelse: kort(rad.beskrivelse, 800),
    punkter,
    erfaringer: kort(rad.erfaringer, 2000),
    kildetekst,
  };
}

export type HoringDeps = {
  aktiv: boolean;
  getUser: (token: string) => Promise<{ id: string; anonymous?: boolean } | null>;
  hentProfil: (brukerId: string) => Promise<Record<string, unknown> | null | "feil">;
  hentSak: (id: string) => Promise<SakRad | null | "feil">;
  hentOffisiellKilde: (sak: SakRad) => Promise<OffisiellKilde>;
  reserverKvote: (brukerId: string) => Promise<"ok" | "grense" | "feil">;
  kallModell: (prompt: string) => Promise<string | null>;
  logg?: (linje: string) => void;
  nå?: () => Date;
};

function sakTekst(sak: SakRad): string {
  return [sak.tittel, sak.sammendrag, sak.instans, sak.frist, sak.kilde].filter(Boolean).join("\n");
}

export async function kjorHoringshjelp(
  input: { token: string | null; body: unknown },
  deps: HoringDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const logg = deps.logg ?? (() => undefined);
  if (!deps.aktiv) return { status: 404, body: { feil: "Forslag til utkast er ikke skrudd på" } };
  if (!input.token) return { status: 401, body: { feil: "Du må være innlogget" } };
  const bruker = await deps.getUser(input.token);
  if (!bruker || bruker.anonymous) return { status: 401, body: { feil: "Du må være innlogget" } };

  const profil = await deps.hentProfil(bruker.id);
  if (profil === "feil") return { status: 503, body: { feil: "Kunne ikke hente profilen akkurat nå" } };
  if (!profil) return { status: 409, body: { feil: "Fullfør profilen før du ber om et utkast" } };

  const lest = lesBody(input.body);
  if (typeof lest === "string") return { status: 400, body: { feil: lest } };

  const sak = await deps.hentSak(lest.varsel_id);
  if (sak === "feil") return { status: 503, body: { feil: "Kunne ikke hente saken akkurat nå" } };
  if (!sak) return { status: 404, body: { feil: "Fant ikke saken" } };

  const offisiell = await deps.hentOffisiellKilde(sak);
  let kildetekst = offisiell.tekst.trim();
  let grunnlag = offisiell.grunnlag;
  let hentet = offisiell.hentet;
  if (grunnlag !== "notat" && lest.kildetekst.trim().length > 200) {
    kildetekst = lest.kildetekst.trim();
    grunnlag = "innlimt";
    hentet = (deps.nå ?? (() => new Date()))().toISOString();
  }
  if (kildetekst.length < 40) {
    kildetekst = sakTekst(sak);
    grunnlag = "sak";
  }
  const avgrenset = avgrensKildetekst(kildetekst, lest.punkter.map((p) => p.nr));
  const brukersvar = byggBrukersvar(lest);
  const nå = deps.nå ?? (() => new Date());
  const dato = datoOslo(nå());
  const mottaker = sak.instans?.trim() || "";
  const frist = sak.frist?.trim() || "";
  const lenke = sak.kilde?.trim() || "";
  const prompt = byggPrompt({
    organisasjon: lest.organisasjon,
    kildetekst: avgrenset.tekst,
    brukersvar,
    mottaker,
    tittel: sak.tittel,
    frist,
    lenke,
    dato,
  });

  const kvote = await deps.reserverKvote(bruker.id);
  if (kvote === "grense") {
    return { status: 429, body: { feil: "Du har brukt opp dagens kvote for forslag til utkast. Lagrede utkast er fortsatt tilgjengelige." } };
  }
  if (kvote !== "ok") return { status: 503, body: { feil: "Kunne ikke kontrollere kvoten akkurat nå" } };

  const rå = await deps.kallModell(prompt);
  if (!rå || !rå.trim()) return { status: 502, body: { feil: "Utkastet kunne ikke lages akkurat nå. Prøv igjen om litt." } };
  const utenGjerde = rå.replace(/^```(?:text|markdown)?\s*/i, "").replace(/```\s*$/, "").trim();
  const tillatt = [mottaker, frist, dato, sak.tittel, lenke, lest.organisasjon].join("\n");
  const kontroll = kontrollerUtkast(utenGjerde, avgrenset.tekst, brukersvar, lest.organisasjon, tillatt, logg);
  let tekst = kontroll.tekst;
  if (grunnlag !== "notat" && !tekst.includes("bygger bare på")) {
    tekst += "\n[MERK: Utkastet bygger bare på saken slik den er lagret hos Kulturvarsling, ikke hele høringsnotatet.]";
  }
  return {
    status: 200,
    body: {
      utkast: tekst,
      kilde_url: lenke || null,
      kilde_hentet: hentet,
      kilde_hash: await sha256(avgrenset.tekst),
      kilde_grunnlag: grunnlag,
      sjekk: kontroll.sjekk,
    },
  };
}
