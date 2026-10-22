// Ren, testbar logikk for hent-saker — ingen nettverkskall, ingen Deno-avhengigheter.
// Importeres av index.ts (Deno/Supabase) OG av logikk.test.ts (Node --test / CI).

// ─── Kulturrelevante nøkkelord ────────────────────────────────────────────────
export const KULTUR_NØKKELORD = [
  "kultur", "kunst", "scenekunst", "musikk", "film", "museum", "museer",
  "bibliotek", "dans", "teater", "kulturliv", "kulturbudsjettet",
  "kulturpolitikk", "kulturmidler", "kulturskole", "kulturbygg",
  "kulturarv", "kulturinstitusjon", "kulturfondet", "kunstner",
  "stipend", "kulturrådet", "kulturdirektorat", "spillemidler",
  "litteratur", "opera", "ballett", "festival", "konsert", "kino",
  "forfatter", "komponist", "billedkunst", "skulptur", "arkiv",
  "riksteatret", "nationaltheatret", "operaen", "filminstituttet",
];

// Nøkkelord som indikerer at saken IKKE er kulturrelevant selv om den
// passerer positiv nøkkelordsjekk (f.eks. via "Familie- og kulturkomiteen")
export const IKKE_KULTUR = [
  "redningshelikopter", "helikopterbas", "beredskapsavtale",
  "forsvarsdepartement", "politiet", "kriminalitet",
  "veibygging", "samferdsel", "vegvesen",
  "sykehus", "helseforetak", "legemiddel",
  "juks i skolen", "eksamen", "karakterer",
  "fengsel", "kriminalomsorg",
];

export function erKulturRelevant(tittel: string, tekst = ""): boolean {
  const haystack = `${tittel} ${tekst}`.toLowerCase();
  if (IKKE_KULTUR.some((k) => haystack.includes(k))) return false;
  return KULTUR_NØKKELORD.some((k) => haystack.includes(k));
}

// Departementsnavnet inneholder «kultur» og ville ellers gjort nesten alle
// KUD-nyheter relevante. Tas bort før nøkkelordtreff, ikke før porteføljesjekken.
const DEPARTEMENTSNAVN = [
  /kultur-\s*og\s*likestillingsdepartementet/gi,
  /kultur-\s*og\s*likestillingsminister\w*/gi,
];

export function utenDepartementsnavn(tekst: string): string {
  let ut = tekst;
  for (const mønster of DEPARTEMENTSNAVN) ut = ut.replace(mønster, " ");
  return ut;
}

/**
 * Sakstyper Kulturvarsling skal ha med selv om det generelle kulturfilteret
 * eller AI-vurderingen sier nei: KUD-høringer (kringkasting, pengespill,
 * dataspill), mediepolitisk redegjørelse, statsbudsjett-pakken, stipend og
 * kulturbygg. Presseinvitasjoner holdes ute.
 */
/**
 * Idrett alene er utenfor kulturfeltet. Frivillighet sammen med idrett
 * (momskompensasjon) og saker som også gjelder kultur, blir igjen.
 */
export function erRenIdrett(tittel: string, tekst = ""): boolean {
  const hay = `${tittel} ${tekst}`.toLowerCase();
  if (!/toppidrett|idrettssenter|\bidrett\b/.test(hay)) return false;
  return !/frivillig|kultur|kunst|museum|musikk|\bfilm\b|\bdans\b|teater|litteratur|bibliotek|stipend|\bmedie|\bkringkast|dataspill|lootboks/.test(hay);
}

export function erPortefoljesak(tittel: string, tekst = ""): boolean {
  if (/^\s*presseinvitasjon\b/i.test(tittel)) return false;
  if (erRenIdrett(tittel, tekst)) return false;
  const hay = `${tittel} ${tekst}`.toLowerCase();
  if (/kringkast|lokalradio|pengespill|nettpoker|dataspill|lootboks|mediepolitikk/.test(hay)) {
    return true;
  }
  if (/statsbudsjettet\s+20\d{2}\s*:/i.test(tittel)) return true;
  if (/kunstnerstipend|kunstnarstipend/.test(hay)) return true;
  if (/kulturbygg/.test(hay)) return true;
  return false;
}

/** Regjeringen-RSS: kulturfilter etter at departementsnavnet er fjernet, pluss porteføljen. */
export function erRegjeringenRelevant(tittel: string, tekst = ""): boolean {
  if (/^\s*presseinvitasjon\b/i.test(tittel)) return false;
  if (erRenIdrett(tittel, tekst)) return false;
  if (erPortefoljesak(tittel, tekst)) return true;
  return erKulturRelevant(utenDepartementsnavn(tittel), utenDepartementsnavn(tekst));
}

export function kategoriFraTittel(tittel: string, tekst = ""): string {
  const hay = `${tittel} ${tekst}`.toLowerCase();
  if (/dataspill|lootboks/.test(hay)) return "spill";
  if (/film|kringkast|mediepolitikk|medie/.test(hay)) return "film";
  if (/\bdans/.test(hay)) return "dans";
  if (/musikk|æresløn|aereslon|æreslon/.test(hay)) return "musikk";
  if (/museum|kulturbygg|kulturarv/.test(hay)) return "kulturarv";
  if (/litteratur|forfatter|bok/.test(hay)) return "litteratur";
  return "kulturpolitikk";
}

/**
 * Fagfelt som står i tittelen. Ordet «kultur» alene er ikke et fagfelt —
 * det er det som fikk Claude til å gjette kulturarv eller visuell.
 * «kulturarv» i en bred pott (også idrett, friluft eller folkehelse) er
 * ett av flere sektornavn, ikke selve saken.
 */
function fagFraEinnsynTittel(tittel: string): string | null {
  const t = tittel.toLowerCase();
  if (/kunst i offentlig rom/.test(t)) return "visuell";
  if (/arkeolog/.test(t)) return "kulturarv";
  // Stadsraad Lehmkuhl er et kulturminne. Tittelen sier ikke ordet kulturminne.
  if (/lehmkuhl/.test(t)) return "kulturarv";
  if (/museum/.test(t)) return "museer";
  if (/kulturminne/.test(t)) return "kulturarv";
  if (/filmfestival|\bfilm\b/.test(t)) return "film";
  if (/\bmusikk\b|æresløn|aereslon|æreslon/.test(t)) return "musikk";
  if (/\bdans\b/.test(t)) return "dans";
  if (/\bopera\b/.test(t)) return "opera";
  if (/litteratur|forfatter/.test(t)) return "litteratur";
  if (/dataspill|lootboks/.test(t)) return "spill";
  if (/scenekunst|\bteater\b/.test(t)) return "scenekunst";
  if (/kulturbygg/.test(t)) return "kulturarv";
  const bredPott = /idrett|friluft|folkehelse/.test(t);
  if (/\bkulturarv\b/.test(t) && !bredPott) return "kulturarv";
  return null;
}

/** Tilskudd, budsjett eller økonomiplan. En navngitt søkers sak («frå/fra Navn») er ikke ordningen selv. */
function erOkonomiinstrument(tittel: string): boolean {
  const t = tittel.toLowerCase();
  if (/tilskudd|tilskot|kulturmidl/.test(t)) return true;
  if (/budsjett|økonomiplan|okonomiplan/.test(t)) return true;
  if (/\b(opne|åpne|åpen|apen|open)\s+søknad/.test(t) && !/\b(frå|fra)\b/.test(t)) return true;
  return false;
}

/**
 * eInnsyn-møtesaker kategoriseres av Claude, som bare får kunstformer
 * å velge mellom. Sammendraget nevner ofte kulturinstitusjon eller
 * kulturarv, og generelle tilskudds- og budsjettsaker havner da på
 * kulturarv eller visuell. Appen har ingen egen kategori for
 * tilskudd/budsjett/økonomi. kulturpolitikk er den eksisterende
 * samlekategorien og brukes allerede på tilsvarende saker.
 * Et navngitt fagfelt eller kulturminne i tittelen vinner.
 */
export function kategoriForEinnsyn(tittel: string, foreslatt?: string | null): string {
  const fag = fagFraEinnsynTittel(tittel);
  if (fag) return fag;
  if (erOkonomiinstrument(tittel)) return "kulturpolitikk";
  const kjent = (foreslatt ?? "").trim();
  return kjent || "kulturpolitikk";
}

/**
 * Høring og innspill er horing selv om de kommer fra nyhetsfeeden.
 * Instans alene satte «Innspill til kvotefordelingen» som nyhet og
 * lot «Regjeringen – høring» bli stående uten sakstype.
 */
export function sakstypeFraSak(item: {
  instans?: string | null;
  tittel?: string | null;
  kilde?: string | null;
}): string | null {
  const tittel = item.tittel ?? "";
  const instans = (item.instans ?? "").toLowerCase();
  const hay = `${tittel} ${instans}`.toLowerCase();
  if (/høring|høyring|horing|innspill/.test(hay)) return "horing";
  if (/tilskudd|tilskot|retningslinj/.test(hay)) return "tilskudd";
  if (/budsjett|proposisjon|tale ved fremleggelse/.test(hay)) return "budsjett";
  if (instans.includes("nyhet")) return "nyhet";
  return null;
}

export type EmneSak = {
  id?: string | null;
  tittel?: string | null;
  instans?: string | null;
  kilde?: string | null;
  sammendrag_raa?: string | null;
  sammendrag?: string | null;
};

const SAK_EMNER: Array<{ id: string; mønster: RegExp }> = [
  { id: "nettpoker", mønster: /nettpoker|pengespillforskrift/i },
  { id: "lootboks", mønster: /lootboks|pengespill-lignende|pengespillignende/i },
  { id: "kulturbudsjett-hoved", mønster: /tale ved fremleggelse av kultur|rekordstort kulturbudsjett/i },
];

/** Felles emne for nyhet/tale og høringen eller hovedsaken om det samme. */
export function sakEmne(sak: EmneSak): string | null {
  const hay = `${sak.tittel ?? ""} ${sak.sammendrag_raa ?? ""} ${sak.sammendrag ?? ""}`;
  for (const emne of SAK_EMNER) {
    if (emne.mønster.test(hay)) return emne.id;
  }
  return null;
}

/** Høring vinner over pressemelding. Pressemelding vinner over tale. */
export function sakPrioritet(sak: EmneSak): number {
  const tittel = sak.tittel ?? "";
  const instans = (sak.instans ?? "").toLowerCase();
  if (/^\s*tale\s+ved\b/i.test(tittel)) return 0;
  if (
    /^\s*høy?ring\b|^\s*høyring\b/i.test(tittel) ||
    instans.includes("høring") ||
    instans.includes("høyring") ||
    /\/dokumenter\//i.test(sak.kilde ?? "")
  ) return 2;
  return 1;
}

export type EmneKobling<T> = {
  item: T;
  hovedsakId: string | null;
  hovedKilde: string | null;
};

/**
 * Nyhet eller tale om samme sak som en høring eller hovedpressemelding
 * settes ikke inn som egen publisert sak. Sektorbudsjett (film, dans, medier)
 * har ikke felles emne og blir stående.
 */
export function planleggEmneDedup<T extends EmneSak>(
  nye: T[],
  eksisterende: EmneSak[] = [],
): { behold: T[]; koblinger: EmneKobling<T>[] } {
  const besteEksisterende = new Map<string, EmneSak>();
  for (const rad of eksisterende) {
    const emne = sakEmne(rad);
    if (!emne) continue;
    const gammel = besteEksisterende.get(emne);
    if (!gammel || sakPrioritet(rad) > sakPrioritet(gammel)) besteEksisterende.set(emne, rad);
  }

  const grupper = new Map<string, T[]>();
  const behold: T[] = [];
  for (const item of nye) {
    const emne = sakEmne(item);
    if (!emne) {
      behold.push(item);
      continue;
    }
    const liste = grupper.get(emne) ?? [];
    liste.push(item);
    grupper.set(emne, liste);
  }

  const koblinger: EmneKobling<T>[] = [];
  for (const [emne, liste] of grupper) {
    const vinner = liste.reduce((best, item) =>
      sakPrioritet(item) > sakPrioritet(best) ? item : best
    );
    const gammel = besteEksisterende.get(emne);
    if (gammel && sakPrioritet(gammel) >= sakPrioritet(vinner)) {
      for (const item of liste) {
        koblinger.push({
          item,
          hovedsakId: gammel.id ?? null,
          hovedKilde: gammel.kilde ?? null,
        });
      }
      continue;
    }
    behold.push(vinner);
    for (const item of liste) {
      if (item === vinner) continue;
      koblinger.push({ item, hovedsakId: null, hovedKilde: vinner.kilde ?? null });
    }
  }
  return { behold, koblinger };
}

/** Sammendrag til lagring. Nøytral bokmål, også når kilden er nynorsk eller en pressemelding. */
export function byggSammendragPrompt(item: {
  tittel: string;
  sammendrag_raa?: string | null;
  instans?: string | null;
  frist?: string | null;
}): string {
  return `Du er ekspert på norsk kulturpolitikk. Vurder om denne saken er DIREKTE relevant for profesjonelle aktører i norsk kultursektor (kunstnere, kulturinstitusjoner, kulturorganisasjoner).

Tittel: ${item.tittel}
${item.sammendrag_raa ? `Beskrivelse: ${item.sammendrag_raa.slice(0, 400)}` : ""}
Instans: ${item.instans ?? ""}
${item.frist ? `Frist: ${item.frist}` : ""}

RELEVANT = ja BARE hvis saken direkte berører: finansiering av kunst/kultur, kulturinstitusjoner, kunstnerstipend, kulturbygg, scenekunst, musikk, film, museer, bibliotek, kulturarv, opphavsrett, kulturpolitikk, kulturskoler, kulturfond, dataspill, mediepolitikk, kringkasting, pengespill (herunder nettpoker) eller statsbudsjettet til Kultur- og likestillingsdepartementet.

IKKE RELEVANT = saker om: forsvar, beredskap, helse, skole (unntatt kulturskole), justis, samferdsel, idrett og toppidrett, AI i utdanning generelt, helikopter, redning, eller andre saker som bare nevner "kultur" i forbifarten (for eksempel fordi Kultur- og likestillingsdepartementet står som avsender uten at innholdet gjelder kultur, medier, spill eller stipend).

SPRÅKGUIDE FOR SAMMENDRAGET:
- Skriv nøytral bokmål, også når kilden er på nynorsk.
- Ikke ta med partimerkelapper som Arbeiderpartiet eller Arbeidarparti-regjeringa.
- Ikke ta med pressemeldingens reklamespråk, som rekordstor eller innfrir lovnaden.
- Ikke la et sitat fra en statsråd være hele sammendraget.
- Bruk bare tall, navn og frister som står i kilden. Ikke gjett og ikke finn på.
- 1-2 konkrete setninger om hva saken gjelder.

KATEGORI: Velg kunstformen når tittelen navngir den. Generelle tilskudd, budsjett, økonomiplan og fordeling av kulturmidler uten navngitt kunstform, museum eller kulturminne er "kulturpolitikk". Ikke bruk kulturarv eller visuell bare fordi saken handler om kultur.

Svar BARE med gyldig JSON, ingen markdown:
{
  "relevant": true eller false,
  "kategori": "scenekunst" | "musikk" | "dans" | "opera" | "litteratur" | "film" | "visuell" | "museer" | "spill" | "kulturarv" | "kulturpolitikk",
  "niva": "nasjonalt" | "fylke" | "kommune",
  "status": "kritisk" | "viktig" | "normal",
  "sammendrag": "1-2 setninger på nøytral bokmål"
}`;
}

const MAANED: Record<string, string> = {
  januar: "01",
  februar: "02",
  mars: "03",
  april: "04",
  mai: "05",
  juni: "06",
  juli: "07",
  august: "08",
  september: "09",
  oktober: "10",
  november: "11",
  desember: "12",
};

function isoFraDeler(dag: string, maaned: string, aar: string): string | null {
  const dd = Number(dag);
  const mm = Number(maaned);
  const yyyy = Number(aar);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 2020 || yyyy > 2100) return null;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function parseEnDato(raw: string): string | null {
  const num = raw.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (num) return isoFraDeler(num[1], num[2], num[3]);
  const ord = raw.match(/(\d{1,2})\.?\s+([a-zæøå]+)\s+(\d{4})/i);
  if (!ord) return null;
  const mm = MAANED[ord[2].toLowerCase()];
  if (!mm) return null;
  return isoFraDeler(ord[1], mm, ord[3]);
}

const DATO_UTTRYKK = String.raw`(\d{1,2}\.\d{1,2}\.\d{4}|\d{1,2}\.?\s+[a-zæøå]+\s+\d{4})`;

/**
 * Frist fra hørings- og tilskuddssider. Merkede felt vinner over løse datoer.
 * Flere søknadsfrister: den seneste (kulturbygg 2028 er 1. desember, ikke
 * den utløpte fristen for 2027).
 */
export function parseRegjeringenFrist(kilde: string): string | null {
  const tekst = dekodXml(kilde).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const treff = (mønster: RegExp): string[] => {
    const ut: string[] = [];
    for (const m of tekst.matchAll(mønster)) {
      const iso = parseEnDato(m[1] ?? "");
      if (iso) ut.push(iso);
    }
    return ut;
  };
  const senest = (liste: string[]) => (liste.length ? liste.sort()[liste.length - 1] : null);
  return senest(treff(new RegExp(`høy?ringsfrist\\s*:?\\s*${DATO_UTTRYKK}`, "gi")))
    ?? senest(treff(new RegExp(`søknadsfrist(?:en)?\\s*:?\\s*${DATO_UTTRYKK}`, "gi")))
    ?? senest(treff(new RegExp(`frist(?:en)?\\s+er\\s+${DATO_UTTRYKK}`, "gi")))
    ?? senest(treff(new RegExp(`(?:^|[^\\wæøå])frist\\s*:\\s*${DATO_UTTRYKK}`, "gi")));
}

/** Tilskuddssiden har fristen. Retningslinje-dokumentet lenker til PDF og har den ikke. */
const KULTURBYGG_TILSKUDD =
  "https://www.regjeringen.no/no/dep/kud/tilskudd/tilskudd-til-nasjonale-kulturbygg-og-tus/id86015/";

export type HoringslisteTreff = { id: string; frist: string | null };

function dekodHtml(verdi: string): string {
  return dekodXml(verdi)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => tegnFraKode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => tegnFraKode(Number(dec)));
}

function tegnFraKode(kode: number): string {
  if (!Number.isInteger(kode) || kode < 32 || kode > 0x10ffff) return "";
  try {
    return String.fromCodePoint(kode);
  } catch {
    return "";
  }
}

/**
 * Høringslisten er server-rendret HTML. Hvert listItem har innholds-id i lenken
 * og merket «Høringsfrist» / «Høyringsfrist». Publiseringsdatoen i span.date
 * er ikke en frist. RSS-itemet har ikke feltet.
 */
export function parseHoringsliste(html: string): HoringslisteTreff[] {
  const tekst = dekodHtml(html);
  const blokker = tekst.match(/<li\b[^>]*\blistItem\b[^>]*>[\s\S]*?<\/li>/gi) ?? [];
  const ut: HoringslisteTreff[] = [];
  const sett = new Set<string>();
  for (const blokk of blokker) {
    const id = blokk.match(/\/id(\d+)/i)?.[1];
    if (!id || sett.has(id)) continue;
    sett.add(id);
    ut.push({ id, frist: parseRegjeringenFrist(blokk) });
  }
  return ut;
}

export function innholdsidFraKilde(kilde: string | null | undefined): string | null {
  if (!kilde) return null;
  return dekodHtml(kilde).match(/\/id(\d+)/i)?.[1] ?? null;
}

/** Setter frist fra høringslisten bare der den mangler. Eksisterende frist beholdes. */
export function leggPaHoringsfrist<T extends { kilde?: string | null; frist?: string | null }>(
  items: T[],
  liste: HoringslisteTreff[],
): T[] {
  const frist = new Map(
    liste.filter((t) => t.frist).map((t) => [t.id, t.frist as string]),
  );
  return items.map((item) => {
    if (item.frist) return item;
    const id = innholdsidFraKilde(item.kilde);
    const funnet = id ? frist.get(id) : undefined;
    return funnet ? { ...item, frist: funnet } : item;
  });
}

export function erRegjeringenHoring(item: {
  instans?: string | null;
  tittel?: string | null;
}): boolean {
  const instans = (item.instans ?? "").toLowerCase();
  if (/høring|høyring|horing/.test(instans)) return true;
  return /^\s*høy?ring\b|^\s*høyring\b/i.test(item.tittel ?? "");
}

export function ekstraFristside(tittel: string): string | null {
  if (/nasjonale kulturbygg/i.test(tittel)) return KULTURBYGG_TILSKUDD;
  return null;
}

export function skalHenteFristside(item: {
  tittel?: string;
  kilde?: string | null;
  frist?: string | null;
}): boolean {
  if (item.frist) return false;
  const tittel = (item.tittel ?? "").toLowerCase();
  const url = (item.kilde ?? "").toLowerCase();
  if (url.includes("/dokumenter/")) return true;
  return /høring|horing|høyring|tilskudd|tilskot|stipend|innspill|retningslinj/.test(tittel);
}

export function sideUrl(kilde: string): string {
  const ren = dekodXml(kilde).split("#")[0];
  const q = ren.indexOf("?");
  return q >= 0 ? ren.slice(0, q) : ren;
}

/** Tilleggsfeeder (KUD-nyheter, høringer, tilskudd, statsbudsjett) eldre enn dette droppes. */
export const INNHENTINGSVINDU_DAGER = 120;

export function innenInnhentingsvindu(
  dato: string | null,
  nå = Date.now(),
  dager = INNHENTINGSVINDU_DAGER,
): boolean {
  if (!dato) return true;
  const ms = Date.parse(`${dato}T00:00:00Z`);
  if (Number.isNaN(ms)) return true;
  const naaDag = Date.parse(`${new Date(nå).toISOString().slice(0, 10)}T00:00:00Z`);
  const alder = Math.round((naaDag - ms) / 86400000);
  return alder <= dager && alder >= -1;
}

// ─── Bestem status ut fra frist ───────────────────────────────────────────────
// `nå` kan injiseres i tester; produksjon bruker klokka.
// Kalenderdager i Europe/Oslo. Passert frist blir «passert».
/** Kalenderdag i Europe/Oslo, YYYY-MM-DD. Frister er rene datoer. */
export function kalenderdag(nå: number, tidssone = "Europe/Oslo"): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: tidssone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nå));
}

export function statusFraFrist(frist: string | null, nå: number = Date.now()): string {
  if (!frist) return "normal";
  const fristDato = frist.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fristDato)) return "normal";
  const idag = kalenderdag(nå);
  if (fristDato < idag) return "passert";
  const dager = Math.round(
    (Date.parse(`${fristDato}T00:00:00Z`) - Date.parse(`${idag}T00:00:00Z`)) / 86400000,
  );
  if (dager <= 7) return "kritisk";
  if (dager <= 21) return "viktig";
  return "normal";
}

/**
 * Status kommer bare fra frist, ellers møtedato. Ingen av delene er normal:
 * manglende frist er ikke kritisk, og en passert dag er passert.
 */
export function statusForSak(
  frist: string | null | undefined,
  motedato: string | null | undefined,
  nå: number = Date.now(),
): string {
  const fristIso = frist?.slice(0, 10) ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(fristIso)) return statusFraFrist(fristIso, nå);
  const moteIso = motedato?.slice(0, 10) ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(moteIso)) return statusFraFrist(moteIso, nå);
  return "normal";
}

// ─── Stortinget-datoformater ──────────────────────────────────────────────────
// API-et bruker to formater: "/Date(1760479200000+0200)/" (med tidssone-offset som
// MÅ legges til før dato-uttrekk, ellers blir midnatt lokal tid til dagen før i UTC)
// og norsk "21.10.2025 00:00:00". Placeholder for ubrukte datoer er "01.01.0001".
export function parseStortingetDato(verdi: string | null | undefined): string | null {
  if (!verdi) return null;
  const epoch = verdi.match(/\/Date\((\d+)([+-]\d{4})?\)/);
  if (epoch) {
    let ms = Number(epoch[1]);
    if (epoch[2]) {
      const fortegn = epoch[2].startsWith("-") ? -1 : 1;
      const timer = Number(epoch[2].slice(1, 3));
      const min = Number(epoch[2].slice(3, 5));
      ms += fortegn * (timer * 60 + min) * 60000;
    }
    const d = new Date(ms);
    return d.getUTCFullYear() > 1970 ? d.toISOString().split("T")[0] : null;
  }
  const norsk = verdi.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (norsk) {
    const [, dd, mm, yyyy] = norsk;
    if (Number(yyyy) < 1970) return null; // placeholder 01.01.0001
    return `${yyyy}-${mm}-${dd}`;
  }
  const iso = verdi.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}

/**
 * UTC-øyeblikket i `/Date(ms+offset)/`. Offseten endrer ikke tidsstempelet.
 * parseStortingetDato legger den til bare for å lese kalenderdagen i Oslo.
 * Norsk dato uten klokkeslett blir midnatt UTC. 72-timersmarginen dekker
 * avviket mot Europe/Oslo.
 */
export function parseStortingetTidspunkt(verdi: string | null | undefined): string | null {
  if (!verdi) return null;
  const epoch = verdi.match(/\/Date\((\d+)(?:[+-]\d{4})?\)/);
  if (epoch) {
    const ms = Number(epoch[1]);
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime()) || d.getUTCFullYear() <= 1970) return null;
    return d.toISOString();
  }
  const dato = parseStortingetDato(verdi);
  return dato ? `${dato}T00:00:00.000Z` : null;
}

/**
 * Kildens publiseringstid som ISO-UTC. Fullt tidsstempel beholdes.
 * Ren kalenderdato blir midnatt UTC. Ugyldig tekst blir null, så den
 * ikke kan se ut som «nå».
 */
export function kildePublisertIso(item: {
  kilde_publisert?: string | null;
  publisert_dato?: string | null;
}): string | null {
  for (const raw of [item.kilde_publisert, item.publisert_dato]) {
    const verdi = raw?.trim();
    if (!verdi) continue;
    const bare = /^(\d{4}-\d{2}-\d{2})$/.exec(verdi);
    if (bare) {
      const ms = Date.parse(`${bare[1]}T00:00:00.000Z`);
      if (!Number.isNaN(ms)) return new Date(ms).toISOString();
      continue;
    }
    const ms = Date.parse(verdi);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }
  return null;
}

// ─── Klientside-filter for Stortingets saker ──────────────────────────────────
// KILDEKART-funn (verifisert juli 2026): serverens komité-filter IGNORERES —
// eksport/saker gir alltid hele sesjonen. Vi må velge kultursakene selv:
// familie- og kulturkomiteen, hovedemne 6 (Kultur), eller nøkkelord-treff.
export function erKulturSak(sak: {
  komite?: { id?: string } | null;
  emne_liste?: Array<{ id?: number; navn?: string }> | { emne?: Array<{ id?: number; navn?: string }> } | null;
  tittel?: string;
  korttittel?: string;
}): boolean {
  if (sak?.komite?.id === "FAMKULT") return true;
  const rå = sak?.emne_liste;
  const emner = Array.isArray(rå) ? rå : rå?.emne ?? [];
  if (emner.some((e) => e?.id === 6 || /^kultur$/i.test(e?.navn ?? ""))) return true;
  return erKulturRelevant(sak?.tittel ?? "", sak?.korttittel ?? "");
}

// ─── Høringsfrist fra sak-detalj (eksport/sak) ────────────────────────────────
// Eneste fungerende maskinlesbare kilde til komiteenes høringsfrister
// (eksport/horingsoversikt = 404, eksport/horinger = 500, verifisert).
// Ved flere HOERFRIST-hendelser velges den SISTE (skriftlig innspillsfrist).
export function finnHøringsfrist(sakDetalj: {
  saksgang?: {
    saksgang_steg_liste?: Array<{
      saksgang_hendelse_liste?: Array<{ id?: string; dato?: string }>;
    }>;
  } | null;
}): string | null {
  const frister: string[] = [];
  for (const steg of sakDetalj?.saksgang?.saksgang_steg_liste ?? []) {
    for (const hendelse of steg?.saksgang_hendelse_liste ?? []) {
      if (hendelse?.id === "HOERFRIST") {
        const dato = parseStortingetDato(hendelse.dato);
        if (dato) frister.push(dato);
      }
    }
  }
  return frister.length ? frister.sort()[frister.length - 1] : null;
}

// ─── RSS-parsing ──────────────────────────────────────────────────────────────
export type RssItem = {
  tittel: string;
  instans: string;
  kilde: string;
  frist: string | null;
  sammendrag_raa: string;
  kilde_id: string;
  publisert_dato: string | null;
  /** Fullt tidsstempel fra pubDate. Null når datoen mangler eller er ugyldig. */
  kilde_publisert?: string | null;
};

export function parseRssItems(xml: string, instans: string): RssItem[] {
  const items: RssItem[] = [];
  const itemBlokker = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

  for (const match of itemBlokker) {
    const blokk = match[1];

    const tittel = dekodXml((
      blokk.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1] ??
      blokk.match(/<title>([\s\S]*?)<\/title>/)?.[1] ??
      ""
    ).trim());

    const link = dekodXml((
      blokk.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? ""
    ).trim());

    const beskrivelse = dekodXml(
      blokk.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] ??
        blokk.match(/<description>([\s\S]*?)<\/description>/)?.[1] ??
        "",
    ).replace(/<[^>]+>/g, "").trim().slice(0, 600);

    const pubDate = blokk.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "";

    if (!tittel || !link) continue;

    const publisertMs = pubDate ? Date.parse(pubDate) : Number.NaN;
    const kildePublisert = Number.isNaN(publisertMs) ? null : new Date(publisertMs).toISOString();

    items.push({
      tittel,
      instans,
      kilde: link,
      frist: null, // RSS har sjelden frist
      sammendrag_raa: beskrivelse,
      kilde_id: `rss-${link}`,
      publisert_dato: kildePublisert ? kildePublisert.slice(0, 10) : null,
      kilde_publisert: kildePublisert,
    });
  }

  return items;
}

/** Dekoder XML-entiteter i RSS. `&amp;` i lenker må bli `&` før dedup. */
export function dekodXml(verdi: string): string {
  return verdi
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Nøkkel for dedup av varsler.kilde.
 * Skjema og vert lavere, standardport bort, avsluttende skråstrek i stien
 * bort, spørringsparametre sortert. Fragmentet beholdes: Kulturdirektoratet
 * og ventede saker skiller rundene/sakene med #.
 * Må holde seg lik public.normaliser_kilde_url i migrasjonen.
 */
export function normaliserKildeUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (!s) return null;

  let fragment = "";
  const hash = s.indexOf("#");
  if (hash >= 0) {
    fragment = s.slice(hash);
    s = s.slice(0, hash);
  }

  let query = "";
  const q = s.indexOf("?");
  if (q >= 0) {
    query = s.slice(q + 1);
    s = s.slice(0, q);
  }
  const qNorm = query
    .split("&")
    .filter((del) => del.length > 0)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join("&");
  const hale = `${qNorm ? `?${qNorm}` : ""}${fragment}`;

  const m = s.match(/^(https?):\/\/([^/]*)(.*)$/i);
  if (!m) {
    const sti = s.length > 1 ? s.replace(/\/+$/, "") : s;
    return `${sti}${hale}`;
  }
  const scheme = m[1].toLowerCase();
  const authority = m[2];
  let path = m[3] ?? "";
  const at = authority.lastIndexOf("@");
  const userinfo = at >= 0 ? authority.slice(0, at + 1) : "";
  let hostport = (at >= 0 ? authority.slice(at + 1) : authority).toLowerCase();
  if (scheme === "http" && hostport.endsWith(":80")) hostport = hostport.slice(0, -3);
  if (scheme === "https" && hostport.endsWith(":443")) hostport = hostport.slice(0, -4);
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return `${scheme}://${userinfo}${hostport}${path}${hale}`;
}

/**
 * Dedup-nøkkel. Dekoder `&amp;` først, så eldre rader med XML-entitet i
 * `varsler.kilde` matcher nye RSS-lenker.
 */
export function kildeNokkel(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  return normaliserKildeUrl(dekodXml(raw));
}

/**
 * Adapter i kilderegisteret ut fra kilde-URL. Samme regler som
 * public.adapter_fra_kilde. Stavanger-frø og andre ukjente vertsnavn
 * blir null — de skal ikke gjettes inn i en annen kilde.
 */
export function adapterFraKildeUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("stortinget.no") && (s.includes("ventede-saker") || s.includes("#sak-"))) {
    return "stortinget-ventede";
  }
  if (s.includes("stortinget.no")) return "stortinget-saker";
  if (s.includes("regjeringen.no")) return "regjeringen-rss";
  if (s.includes("einnsyn.no")) return "einnsyn";
  if (s.includes("bergen.kommune.no")) return "bergen";
  if (s.includes("kulturdirektoratet.no")) return "kulturdirektoratet";
  if (s.includes("sametinget.no")) return "sametinget";
  return null;
}

export function kildeUuidForAdapter(
  adapter: string | null | undefined,
  register: { get(key: string): { id: string } | undefined },
): string | null {
  if (!adapter) return null;
  const id = register.get(adapter)?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export type VarselRadInn = {
  tittel: string;
  kilde?: string | null;
  instans?: string | null;
  frist?: string | null;
  niva?: string | null;
  sted?: string | null;
  sakstype?: string | null;
  kommunenr?: string | null;
  fylkesnr?: string | null;
  adapter?: string | null;
  motedato?: string | null;
  publisert_dato?: string | null;
  kilde_publisert?: string | null;
};

/**
 * Rad klar for insert/upsert. kilde lagres normalisert, så generert
 * kilde_nokkel blir den samme strengen for alle adaptere. kilde_nokkel
 * sendes aldri med. kilde_id er UUID fra kilderegisteret, ikke adapterens
 * egen streng-id.
 */
export function byggVarselRad(
  item: VarselRadInn,
  felt: {
    publisert: boolean;
    kategori: string;
    niva: string;
    status: string;
    sammendrag: string;
    sted?: string | null;
  },
  register: { get(key: string): { id: string } | undefined },
): Record<string, unknown> | null {
  const kilde = kildeNokkel(item.kilde ?? null);
  if (!kilde || !item.tittel) return null;
  const rad: Record<string, unknown> = {
    tittel: item.tittel,
    sammendrag: felt.sammendrag,
    instans: item.instans ?? "",
    kilde,
    frist: item.frist ?? null,
    kategori: felt.kategori,
    niva: felt.niva,
    sted: felt.sted ?? item.sted ?? (felt.niva === "nasjonalt" ? "Nasjonalt" : "Norge"),
    status: felt.status,
    publisert: felt.publisert,
    motedato: item.motedato ?? null,
    kilde_publisert: item.kilde_publisert
      ? kildePublisertIso({ kilde_publisert: item.kilde_publisert })
      : null,
    kilde_id: kildeUuidForAdapter(
      item.adapter ?? adapterFraKildeUrl(item.kilde),
      register,
    ),
  };
  if (felt.publisert) {
    rad.sakstype = item.sakstype ?? null;
    rad.kommunenr = item.kommunenr ?? null;
    rad.fylkesnr = item.fylkesnr ?? null;
  }
  return rad;
}

/** Første treff per normalisert kilde-URL. Rader uten URL droppes. */
export function dedupEtterKilde<T extends { kilde?: string | null }>(
  items: T[],
  allerede: Iterable<string> = [],
): T[] {
  const sett = new Set(allerede);
  const ut: T[] = [];
  for (const item of items) {
    const nokkel = kildeNokkel(item.kilde ?? null);
    if (!nokkel || sett.has(nokkel)) continue;
    sett.add(nokkel);
    ut.push(item);
  }
  return ut;
}

/**
 * Sammenligningstekst for innholdsduplikater.
 * Må holde seg lik public.normaliser_innhold_tekst.
 * Små bokstaver, æøå beholdes, tegnsetting og ekstra mellomrom blir ett mellomrom.
 */
export function normaliserInnholdTekst(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = raw.toLowerCase().replace(/[^0-9a-zæøå]+/g, " ").trim();
  return s || null;
}

/**
 * Sak-id som gjør at like titler fortsatt er ulike saker.
 * Stortinget p=, regjeringsdokument id og fragment på Kulturdirektoratet
 * eller ventede saker. Møte-URL-er (eInnsyn, Bergen) inngår ikke:
 * samme sak i flere møter er ett innhold.
 * Må holde seg lik public.innhold_dedup_nokkel.
 */
export function stabilSakId(kilde: string | null | undefined): string {
  if (!kilde) return "";
  if (/stortinget\.no/i.test(kilde) && !/ventede-saker/i.test(kilde)) {
    const sak = kilde.match(/[?&]p=(\d+)/i);
    if (sak) return `p=${sak[1]}`;
  }
  if (/regjeringen\.no/i.test(kilde)) {
    const dok = kilde.match(/\/id(\d+)/i);
    if (dok) return `id${dok[1]}`;
  }
  if (/kulturdirektoratet\.no/i.test(kilde)) {
    const hash = kilde.indexOf("#");
    if (hash >= 0) return kilde.slice(hash).toLowerCase();
  }
  if (/stortinget\.no/i.test(kilde)) {
    const lav = kilde.toLowerCase();
    const i = lav.indexOf("#sak-");
    if (i >= 0) return lav.slice(i);
  }
  return "";
}

export type InnholdNokkelInn = {
  instans?: string | null;
  tittel?: string | null;
  frist?: string | null;
  kilde?: string | null;
};

/** instans + normalisert tittel + fristdato + stabil sak-id. Uten frist er datodelen tom. */
export function innholdDedupNokkel(item: InnholdNokkelInn): string | null {
  const instans = normaliserInnholdTekst(item.instans);
  const tittel = normaliserInnholdTekst(item.tittel);
  if (!instans || !tittel) return null;
  const dato = item.frist ? String(item.frist).slice(0, 10) : "";
  return `${instans}|${tittel}|${dato}|${stabilSakId(item.kilde)}`;
}

/** Første treff per innholdsnøkkel. Rader uten nøkkel beholdes. */
export function dedupEtterInnhold<T extends InnholdNokkelInn>(
  items: T[],
  allerede: Iterable<string> = [],
): T[] {
  const sett = new Set(allerede);
  const ut: T[] = [];
  for (const item of items) {
    const nokkel = innholdDedupNokkel(item);
    if (nokkel && sett.has(nokkel)) continue;
    if (nokkel) sett.add(nokkel);
    ut.push(item);
  }
  return ut;
}

/**
 * Backfill skal ikke skrive om tittel, sammendrag, kategori, frist,
 * møtedato eller status når manuelt_redigert er satt, heller ikke når
 * feltet er tomt. Kolonnen kommer fra Regjeringen-sporet.
 */
export function utenManuelleTekstfelt<T extends Record<string, unknown>>(
  rad: T,
  manueltRedigert: boolean,
): T {
  if (!manueltRedigert) return rad;
  const kopi = { ...rad };
  delete kopi.tittel;
  delete kopi.sammendrag;
  delete kopi.kategori;
  delete kopi.frist;
  delete kopi.motedato;
  delete kopi.status;
  return kopi;
}

/** Følg gjeldende sesjon og behold fjoråret for saker som fortsatt behandles. */
export function stortingsSesjoner(nå = Date.now()): string[] {
  const dato = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nå));
  const [år, måned] = dato.split("-").map(Number);
  const start = måned >= 10 ? år : år - 1;
  return [`${start}-${start + 1}`, `${start - 1}-${start}`];
}
