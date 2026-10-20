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
export function erPortefoljesak(tittel: string, tekst = ""): boolean {
  if (/^\s*presseinvitasjon\b/i.test(tittel)) return false;
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
// Regner i KALENDERDAGER (ikke millisekunder) — ellers ville status avhenge av
// hvilket klokkeslett cronen kjører, siden frister er rene datoer.
export function statusFraFrist(frist: string | null, nå: number = Date.now()): string {
  if (!frist) return "normal";
  const fristMs = new Date(frist).getTime();
  if (Number.isNaN(fristMs)) return "normal"; // ugyldig dato skal aldri krasje pipeline
  const idagMs = new Date(new Date(nå).toISOString().split("T")[0]).getTime();
  const dager = Math.round((fristMs - idagMs) / 86400000);
  if (dager < 0) return "normal"; // allerede utløpt
  if (dager <= 7) return "kritisk";
  if (dager <= 21) return "viktig";
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

    items.push({
      tittel,
      instans,
      kilde: link,
      frist: null, // RSS har sjelden frist
      sammendrag_raa: beskrivelse,
      kilde_id: `rss-${link}`,
      publisert_dato: pubDate
        ? new Date(pubDate).toISOString().split("T")[0]
        : null,
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
