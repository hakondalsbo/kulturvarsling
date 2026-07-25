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

    const tittel = (
      blokk.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1] ??
      blokk.match(/<title>([\s\S]*?)<\/title>/)?.[1] ??
      ""
    ).trim();

    const link = (
      blokk.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? ""
    ).trim();

    const beskrivelse = (
      blokk.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] ??
      blokk.match(/<description>([\s\S]*?)<\/description>/)?.[1] ??
      ""
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
