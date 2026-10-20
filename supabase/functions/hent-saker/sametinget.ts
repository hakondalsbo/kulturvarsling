// Sametinget-adapter — nyhets-RSS med de ukentlige tildelingslistene.
// Verifisert juli 2026: kun kategori 9 (Aktuelt) finnes; feeden viser BARE de
// 5 nyeste artiklene, så den daglige kjøringen må ikke hoppes over i travle uker.
// «Innvilgede saker DD.MM.ÅÅ-DD.MM.ÅÅ» er sametingsrådets tildelingslister.

import { trekkHoringsfrist } from "./frister.ts";
import { type RssItem } from "./logikk.ts";
import {
  feilFraUnntak,
  feilUtfall,
  lesTekstRespons,
  okUtfall,
  samleRssSvar,
  type AdapterUtfall,
} from "./kildehelse.ts";

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
    frist: trekkHoringsfrist(`${item.tittel}\n${item.sammendrag_raa}`),
    kilde_id: `sametinget-${item.kilde}`,
    sakstype: erTildeling ? "tildeling" : null,
    // Tildelingslistene («Innvilgede saker 06.07.26-12.07.26») mangler kulturord
    // i tittelen og ville røket i nøkkelordfilteret — Claude siler i stedet ut
    // de få ikke-kulturelle Sametings-nyhetene (feeden har bare 5 items).
    forhåndsgodkjent: true,
  };
}

export async function hentSametingetSaker(): Promise<AdapterUtfall> {
  try {
    const res = await fetch(FEED, {
      headers: { "User-Agent": "Kulturvarsling/1.0" },
    });
    const lest = await lesTekstRespons(res, FEED);
    if ("feil" in lest) {
      console.error(`Sametinget RSS ${FEED}: ${lest.feil.melding}`);
      return feilUtfall(lest.feil);
    }
    const samlet = samleRssSvar(
      [{ url: FEED, instans: "Sametinget", status: res.status, kropp: lest.tekst }],
      { forhandsGodkjent: true },
    );
    if (samlet.vellykket === 0) {
      console.error(`Sametinget RSS ${FEED}: ${samlet.feil[0]?.melding ?? "ukjent"}`);
      return samlet;
    }
    const items = samlet.items.map((item) => mapSametingetItem(item));
    console.log(`Sametinget: ${items.length} nyheter hentet`);
    return okUtfall(items, samlet.raattAntall, items.length, res.status);
  } catch (e) {
    console.error("Sametinget feil:", e);
    return feilUtfall(feilFraUnntak(e, FEED));
  }
}
