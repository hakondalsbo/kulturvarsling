// Bergen kommune-adapter — politikere-utvalg-API (BK360/bksak bak).
// Verifisert juli 2026: åpent JSON-REST-API uten auth; serverside fulltekstsøk
// på agendapunkt-tittel (tittel=kultur) gjør kulturfiltrering triviell.
// Klikkbar lenke bruker Angular-appens rute (lest ut av produksjonsbundelen):
//   /politikk/politiskeutvalg/:utvalgId/mote/:moteId/sak/:kildeId

import {
  feilFraUnntak,
  feilUtfall,
  lesTekstRespons,
  uventetFormat,
  type AdapterUtfall,
} from "./kildehelse.ts";

const API = "https://www.bergen.kommune.no/politikere-utvalg/api";

// Verifisert 24.10.2026: start er offset, rows=150 er siden vi allerede bruker.
// rows=200 ga også treff, men vi holder oss til 150. year=2026 hadde numTotal=197,
// så start=150 gir de siste 47. robots.txt sperrer bare /api/fil, /api/sakskart og /api/kalender.
export const BERGEN_SIDE = 150;
export const BERGEN_PAUSE_MS = 400;
export const BERGEN_MAKS_SIDER = 20;

export function bergenSideUrl(år: number, start: number, rows = BERGEN_SIDE): string {
  const side = Math.min(Math.max(1, rows), BERGEN_SIDE);
  return `${API}/agendapunkter?tittel=kultur&year=${år}&rows=${side}&start=${Math.max(0, start)}`;
}

/**
 * Neste offset, eller null når siden er siste.
 * Kort side, manglende numTotal eller ingen nye rader stopper. Vi looper ikke.
 */
export function nesteBergenStart(input: {
  start: number;
  mottatt: number;
  rows: number;
  numTotal: number | null;
  nye: number;
}): number | null {
  if (input.mottatt <= 0 || input.nye <= 0) return null;
  if (input.numTotal == null) return null;
  const neste = input.start + input.mottatt;
  if (neste >= input.numTotal) return null;
  if (input.mottatt < input.rows) return null;
  return neste;
}

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
  motedato: string | null;
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
    motedato: punkt.moteDato?.slice(0, 10) ?? null,
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

type BergenHent = (
  url: string,
) => Promise<{ tekst: string; status: number } | { feil: AdapterUtfall["feil"][number] }>;

async function standardBergenHent(url: string): Promise<{ tekst: string; status: number } | { feil: AdapterUtfall["feil"][number] }> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Kulturvarsling/1.0" },
  });
  const lest = await lesTekstRespons(res, url);
  if ("feil" in lest) return { feil: lest.feil };
  return { tekst: lest.tekst, status: res.status };
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type BergenInnhenting = {
  punkter: BergenAgendapunkt[];
  numTotal: number | null;
  feil: AdapterUtfall["feil"];
  forsok: number;
  vellykket: number;
  httpStatus: number | null;
};

/**
 * Alle agendapunkter for året. Side på 150, pause mellom sider.
 * Feil på første side gir ingen punkter. Feil senere stopper og beholder
 * sidene som kom. Samme første id to ganger stopper, så en ignorert start
 * ikke blir en løkke.
 */
export async function hentBergenAgendapunkter(opts?: {
  år?: number;
  hent?: BergenHent;
  pause?: (ms: number) => Promise<void>;
  pauseMs?: number;
}): Promise<BergenInnhenting> {
  const år = opts?.år ?? new Date().getFullYear();
  const hent = opts?.hent ?? standardBergenHent;
  const vent = opts?.pause ?? pause;
  const pauseMs = opts?.pauseMs ?? BERGEN_PAUSE_MS;
  const sett = new Set<string>();
  const punkter: BergenAgendapunkt[] = [];
  const feil: AdapterUtfall["feil"] = [];
  let start = 0;
  let numTotal: number | null = null;
  let forsok = 0;
  let vellykket = 0;
  let httpStatus: number | null = null;

  for (let side = 0; side < BERGEN_MAKS_SIDER; side++) {
    if (side > 0 && pauseMs > 0) await vent(pauseMs);
    const url = bergenSideUrl(år, start);
    forsok++;
    let lest: { tekst: string; status: number } | { feil: AdapterUtfall["feil"][number] };
    try {
      lest = await hent(url);
    } catch (e) {
      const f = feilFraUnntak(e, url);
      console.error(`Bergen agendapunkter ${url}:`, e);
      feil.push(f);
      break;
    }
    if ("feil" in lest) {
      console.error(`Bergen agendapunkter ${url}: ${lest.feil.melding}`);
      feil.push(lest.feil);
      break;
    }
    let data: any;
    try {
      data = JSON.parse(lest.tekst);
    } catch (e) {
      const f = feilFraUnntak(e, url);
      console.error(`Bergen parse ${url}:`, e);
      feil.push(f);
      break;
    }
    if (!Array.isArray(data?.items)) {
      const f = uventetFormat(url, "mangler items");
      console.error(`Bergen ${url}: ${f.melding}`);
      feil.push(f);
      break;
    }
    vellykket++;
    httpStatus = lest.status;
    if (typeof data.numTotal === "number") numTotal = data.numTotal;
    const rå: BergenAgendapunkt[] = data.items;
    let nye = 0;
    for (const punkt of rå) {
      const nokkel = `${punkt?.kildeId ?? ""}:${punkt?.moteId ?? ""}:${punkt?.tittel ?? ""}`;
      if (sett.has(nokkel)) continue;
      sett.add(nokkel);
      punkter.push(punkt);
      nye++;
    }
    const neste = nesteBergenStart({
      start,
      mottatt: rå.length,
      rows: BERGEN_SIDE,
      numTotal,
      nye,
    });
    if (neste == null) break;
    if (side === BERGEN_MAKS_SIDER - 1) {
      feil.push(uventetFormat(url, "sidegrense"));
      break;
    }
    start = neste;
  }

  return { punkter, numTotal, feil, forsok, vellykket, httpStatus };
}

// Henter kultursaker fra alle politiske utvalg i Bergen for inneværende år.
export async function hentBergenSaker(opts?: {
  år?: number;
  hent?: BergenHent;
  pause?: (ms: number) => Promise<void>;
  pauseMs?: number;
}): Promise<AdapterUtfall> {
  const år = opts?.år ?? new Date().getFullYear();
  try {
    const hentet = await hentBergenAgendapunkter(opts);
    if (hentet.vellykket === 0) {
      return feilUtfall(hentet.feil[0] ?? feilFraUnntak(new Error("Ingen kall ble forsøkt")), hentet.forsok || 1);
    }
    const items: any[] = [];
    for (const punkt of hentet.punkter) {
      const mappet = mapBergenAgendapunkt(punkt);
      if (mappet) items.push(mappet);
    }
    console.log(
      `Bergen: sider=${hentet.vellykket}, numTotal=${hentet.numTotal ?? "mangler"}, rå=${hentet.punkter.length}, etter rutinesak-filter=${items.length} (${år})`,
    );
    return {
      items,
      raattAntall: hentet.punkter.length,
      antallEtterFilter: items.length,
      feil: hentet.feil,
      forsok: hentet.forsok,
      vellykket: hentet.vellykket,
      httpStatus: hentet.feil[0]?.httpStatus ?? hentet.httpStatus,
    };
  } catch (e) {
    console.error("Bergen feil:", e);
    return feilUtfall(feilFraUnntak(e));
  }
}
