// Ren, testbar logikk for hent-saker — ingen nettverkskall, ingen Deno-avhengigheter.
// Importeres av index.ts (Deno/Supabase) OG av logikk.test.ts (Node --test / CI).

// ─── Kulturrelevante nøkkelord ────────────────────────────────────────────────
export const KULTUR_NØKKELORD = [
  "kultur", "kunst", "scenekunst", "musikk", "film", "museum", "museer",
  "bibliotek", "dans", "teater", "kulturliv", "kulturbudsjettet",
  "kulturpolitikk", "kulturmidler", "kulturskole", "kulturbygg",
  "kulturarv", "kulturinstitusjon", "kulturfondet", "kunstner",
  "stipend", "kulturrådet", "kulturdirektorat", "spillmidler",
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
