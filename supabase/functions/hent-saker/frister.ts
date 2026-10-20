// Ren parsing av høringsfrister. Ingen nettverk.
// Regjeringen har ikke JSON for frist (verifisert i KILDEKART). Stabil kilde er
// dokumentlisten id2000006, og detaljsidens .horing-meta som reserve.
// Stortinget: HOERFRIST via finnHøringsfrist i logikk.ts.

export const REGJERINGEN_HORING_LISTE =
  "https://www.regjeringen.no/no/dokument/id2000006/?documenttype=dokumenter/h%C3%B8ringer&page=";

export const MAKS_LISTE_SIDER = 2;
export const MAKS_REGJERING_DETALJ = 10;
export const MAKS_STORTING_OPPSLAG = 20;
export const MAKS_SAMETING = 8;
export const MAKS_MOTEOPPSLAG = 20;

export function addIsoDager(iso: string, dager: number): string {
  const ms = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + dager * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function dekodeHtml(html: string): string {
  return html
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&oslash;/gi, "ø")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ");
}

export function norskDatoTilIso(dag: string, mnd: string, aar: string): string | null {
  const d = Number(dag);
  const m = Number(mnd);
  const y = Number(aar);
  if (!Number.isInteger(y) || y < 1970 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const MAANEDNR: Record<string, string> = {
  januar: "1",
  februar: "2",
  mars: "3",
  april: "4",
  mai: "5",
  juni: "6",
  juli: "7",
  august: "8",
  september: "9",
  oktober: "10",
  november: "11",
  desember: "12",
};

/**
 * Bokmål «Høringsfrist» og nynorsk «Høyringsfrist», også når ø er entitets-kodet.
 * Sametinget skriver «Høringsfristen er 23. november 2026», Regjeringen «Høringsfrist: 30.08.2026».
 */
export function trekkHoringsfrist(html: string): string | null {
  const tekst = dekodeHtml(html).replace(/<[^>]+>/g, " ");
  const ledetekst = /H[øo](?:y)?ringsfrist(?:en)?(?:\s*:\s*|\s+er\s+)/i;
  const tall = tekst.match(new RegExp(`${ledetekst.source}(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})`, "i"));
  if (tall) return norskDatoTilIso(tall[1], tall[2], tall[3]);
  const ord = tekst.match(
    new RegExp(
      `${ledetekst.source}(\\d{1,2})\\.?\\s+(januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)\\s+(\\d{4})`,
      "i",
    ),
  );
  if (!ord) return null;
  return norskDatoTilIso(ord[1], MAANEDNR[ord[2].toLowerCase()] ?? "", ord[3]);
}

export function erSametingetHoring(
  kilde: string | null | undefined,
  tittel: string | null | undefined,
): boolean {
  if (!kilde || !/sametinget\.no/i.test(kilde)) return false;
  return /h[øo]ring/i.test(`${tittel ?? ""} ${kilde}`);
}

export function einnsynMoetesakId(kilde: string | null | undefined): string | null {
  const m = kilde?.match(/einnsyn\.no\/moetesak\/(ms_[a-z0-9]+)/i);
  return m?.[1] ?? null;
}

export function bergenMoteOgSak(
  kilde: string | null | undefined,
): { mote: string; sak: string } | null {
  const m = kilde?.match(/\/mote\/(\d+)\/sak\/(\d+)/);
  return m ? { mote: m[1], sak: m[2] } : null;
}

export function regjeringenInnholdId(kilde: string | null | undefined): string | null {
  if (!kilde) return null;
  const m = kilde.match(/regjeringen\.no\/[^?#]*\/id(\d+)/i);
  return m?.[1] ?? null;
}

export function erRegjeringsHoring(
  kilde: string | null | undefined,
  instans: string | null | undefined,
): boolean {
  if (!regjeringenInnholdId(kilde)) return false;
  if (instans && /h[øo]yring/i.test(instans)) return true;
  return /\/dokumenter\/h(?:o|ø|%c3%b8)ring/i.test(kilde ?? "");
}

/** Sak-URL med p=, ikke ventede saker. */
export function stortingSakId(kilde: string | null | undefined): string | null {
  if (!kilde || /ventede-saker/i.test(kilde)) return null;
  const m = kilde.match(/stortinget\.no\/[^#]*[?&]p=(\d+)/i);
  return m?.[1] ?? null;
}

export function regjeringenSideUrl(kilde: string | null | undefined): string | null {
  if (!kilde) return null;
  const m = kilde.match(/https?:\/\/www\.regjeringen\.no\/[^?#]*\/id\d+\/?/i);
  return m ? m[0] : null;
}

export type RegjeringHoring = { innholdId: string; frist: string | null };

export function parseRegjeringenHoringListe(html: string): RegjeringHoring[] {
  const deler = html.split(/<li\b[^>]*\blistItem\b[^>]*>/i).slice(1);
  const ut: RegjeringHoring[] = [];
  for (const del of deler) {
    const blokk = del.split(/<\/li>/i)[0] ?? del;
    const id = blokk.match(/\/id(\d+)\//)?.[1];
    if (!id) continue;
    ut.push({ innholdId: id, frist: trekkHoringsfrist(blokk) });
  }
  return ut;
}

export function parseRegjeringenHoringSide(html: string): string | null {
  const meta = html.match(/class="[^"]*horing-meta[^"]*"[\s\S]*?<\/div>/i)?.[0] ?? html;
  return trekkHoringsfrist(meta);
}

/** Null frist, eller frist som ikke er mer enn 14 dager gammel. */
export function skalOppdatereStortingFrist(frist: string | null, idag: string): boolean {
  if (!frist) return true;
  const dato = frist.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dato)) return true;
  return dato >= addIsoDager(idag, -14);
}

export function prioriterStorting<T extends { frist: string | null }>(rader: T[]): T[] {
  return [...rader].sort((a, b) => {
    if (!a.frist && b.frist) return -1;
    if (a.frist && !b.frist) return 1;
    return (a.frist ?? "").localeCompare(b.frist ?? "");
  });
}
