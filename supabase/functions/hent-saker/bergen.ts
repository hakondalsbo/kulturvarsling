// Bergen kommune-adapter — politikere-utvalg-API (BK360/bksak bak).
// Verifisert juli 2026: åpent JSON-REST-API uten auth; serverside fulltekstsøk
// på agendapunkt-tittel (tittel=kultur) gjør kulturfiltrering triviell.
// Klikkbar lenke bruker Angular-appens rute (lest ut av produksjonsbundelen):
//   /politikk/politiskeutvalg/:utvalgId/mote/:moteId/sak/:kildeId

import {
  feilFraUnntak,
  feilUtfall,
  lesTekstRespons,
  okUtfall,
  uventetFormat,
  type AdapterUtfall,
} from "./kildehelse.ts";

const API = "https://www.bergen.kommune.no/politikere-utvalg/api";

export type BergenAgendapunkt = {
  tittel?: string;
  beskrivelse?: string | null;
  utvalgId?: string;
  utvalgsNavn?: string;
  moteId?: string;
  kildeId?: string;
  moteDato?: string | null;
  saksnr?: string;
  kildesystem?: string;
};

// Rutinesaker treffer søket fordi utvalgsnavnet («Utvalg for finans, kultur og
// næring») står i tittelen — sil dem ut billig FØR de koster en Claude-vurdering.
export const BERGEN_RUTINESAK =
  /^(innkalling|protokoll|godkjenning av|eventuelt\b|referatsaker|muntlig orientering|orienteringer\b)/i;

// Ren mapping — testes i bergen.test.ts uten nettverk.
export function mapBergenAgendapunkt(punkt: BergenAgendapunkt): {
  tittel: string;
  instans: string;
  kilde: string;
  frist: null;
  sammendrag_raa: string;
  kilde_id: string;
  publisert_dato: string | null;
  niva: "kommune";
  sted: string;
  kommunenr: string;
  fylkesnr: string;
  forhåndsgodkjent: boolean;
} | null {
  const tittel = punkt?.tittel?.trim() ?? "";
  if (!tittel || BERGEN_RUTINESAK.test(tittel)) return null;
  if (!punkt.utvalgId || !punkt.moteId || !punkt.kildeId) return null;

  const utvalg = punkt.utvalgsNavn || "Politisk utvalg";
  const møte = punkt.moteDato ? ` (møte ${punkt.moteDato})` : "";
  const saksnr = punkt.saksnr ? `, saksnr ${punkt.saksnr}` : "";
  return {
    tittel,
    instans: `${utvalg}, Bergen kommune`,
    kilde:
      `https://www.bergen.kommune.no/politikk/politiskeutvalg/${punkt.utvalgId}/mote/${punkt.moteId}/sak/${punkt.kildeId}`,
    frist: null,
    sammendrag_raa: `Politisk sak i ${utvalg}, Bergen kommune${møte}${saksnr}.`,
    kilde_id: `bergen-${punkt.kildeId}-${punkt.moteId}`,
    publisert_dato: punkt.moteDato ?? null,
    niva: "kommune",
    sted: "Bergen",
    kommunenr: "4601",
    fylkesnr: "46",
    // Treff på tittel=kultur i API-et — Claude kvalitetssikrer uansett.
    forhåndsgodkjent: true,
  };
}

// Henter kultursaker fra alle politiske utvalg i Bergen for inneværende år.
// Paginering utover rows=150 er ikke implementert. numTotal logges så et kutt
// (numTotal > items.length) er synlig; oppfølging, ikke denne endringen.
export async function hentBergenSaker(): Promise<AdapterUtfall> {
  const år = new Date().getFullYear();
  const url = `${API}/agendapunkter?tittel=kultur&year=${år}&rows=150`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Kulturvarsling/1.0" },
    });
    const lest = await lesTekstRespons(res, url);
    if ("feil" in lest) {
      console.error(`Bergen agendapunkter ${url}: ${lest.feil.melding}`);
      return feilUtfall(lest.feil);
    }
    let data: any;
    try {
      data = JSON.parse(lest.tekst);
    } catch (e) {
      const feil = feilFraUnntak(e, url);
      console.error(`Bergen parse ${url}:`, e);
      return feilUtfall(feil);
    }
    if (!Array.isArray(data?.items)) {
      const feil = uventetFormat(url, "mangler items");
      console.error(`Bergen ${url}: ${feil.melding}`);
      return feilUtfall(feil);
    }
    const rå: BergenAgendapunkt[] = data.items;
    const items: any[] = [];
    for (const punkt of rå) {
      const mappet = mapBergenAgendapunkt(punkt);
      if (mappet) items.push(mappet);
    }
    const numTotal = typeof data.numTotal === "number" ? data.numTotal : null;
    console.log(
      `Bergen: numTotal=${numTotal ?? "mangler"}, rå=${rå.length}, etter rutinesak-filter=${items.length} (${år})`,
    );
    return okUtfall(items, rå.length, items.length);
  } catch (e) {
    console.error("Bergen feil:", e);
    return feilUtfall(feilFraUnntak(e, url));
  }
}
