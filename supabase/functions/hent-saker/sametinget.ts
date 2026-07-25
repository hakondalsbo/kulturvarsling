// Sametinget-adapter — nyhets-RSS med de ukentlige tildelingslistene.
// Verifisert juli 2026: kun kategori 9 (Aktuelt) finnes; feeden viser BARE de
// 5 nyeste artiklene, så den daglige kjøringen må ikke hoppes over i travle uker.
// «Innvilgede saker DD.MM.ÅÅ-DD.MM.ÅÅ» er sametingsrådets tildelingslister.

import { parseRssItems, type RssItem } from "./logikk.ts";

const FEED = "https://sametinget.no/ArtikkelRSS.ashx?NyhetsKategoriId=9&Spraak=Norsk";

// Ren mapping — testes i sametinget.test.ts uten nettverk.
export function mapSametingetItem(item: RssItem): RssItem & {
  sakstype: string | null;
  forhåndsgodkjent: boolean;
} {
  const erTildeling = /innvilgede saker|tildel/i.test(
    `${item.tittel} ${item.sammendrag_raa}`,
  );
  return {
    ...item,
    kilde_id: `sametinget-${item.kilde}`,
    sakstype: erTildeling ? "tildeling" : null,
    // Tildelingslistene («Innvilgede saker 06.07.26-12.07.26») mangler kulturord
    // i tittelen og ville røket i nøkkelordfilteret — Claude siler i stedet ut
    // de få ikke-kulturelle Sametings-nyhetene (feeden har bare 5 items).
    forhåndsgodkjent: true,
  };
}

export async function hentSametingetSaker(): Promise<any[]> {
  const items: any[] = [];
  try {
    const res = await fetch(FEED, {
      headers: { "User-Agent": "Kulturvarsling/1.0" },
    });
    if (!res.ok) {
      console.error(`Sametinget RSS svarte ${res.status}`);
      return items;
    }
    const xml = await res.text();
    for (const item of parseRssItems(xml, "Sametinget")) {
      items.push(mapSametingetItem(item));
    }
    console.log(`Sametinget: ${items.length} nyheter hentet`);
  } catch (e) {
    console.error("Sametinget feil:", e);
  }
  return items;
}
