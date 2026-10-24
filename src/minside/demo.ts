import type { LagretSok, MinSak, MinValg } from "./filter.ts";

/** Fast dag i demo, så fristene i skjermbildene ikke følger klokken. */
export const DEMO_DAG = new Date("2026-10-24T12:00:00+02:00");

export const DEMO_VALG: MinValg = {
  fagfelt: ["musikk", "scenekunst"],
  geografisk: ["kommune:0301", "sted:oslo", "fylkeskommune:46"],
  organ: ["stortinget", "regjeringen"],
  komiteer: ["famkult"],
  varslerAktive: true,
};

export const DEMO_SOK: LagretSok[] = [
  { id: "sok-kulturskole", navn: "Kulturskole", sporretekst: "kulturskole" },
];

export const DEMO_FULGTE = ["fulgt-bodo"];

export const DEMO_SAKER: MinSak[] = [
  {
    id: "oslo-musikk",
    tittel: "Oslo kommune kutter tilskuddet til frie grupper",
    sammendrag: "Bystyret behandler kulturbudsjettet. Du kan si ifra før møtet.",
    instans: "Oslo kommune",
    kategori: "musikk",
    niva: "kommune",
    sted: "Oslo",
    kommunenr: "0301",
    fylkesnr: "03",
    frist: "2026-10-28",
    status: "høring",
    handling: "handling_mulig",
    kilde: "https://www.oslo.kommune.no/politikk/budsjett",
  },
  {
    id: "vestland-scene",
    tittel: "Vestland fylkeskommune lyser ut scenekunstmidler",
    sammendrag: "Fylkeskommunen har en åpen utlysning til fri scenekunst.",
    instans: "Vestland fylkeskommune",
    kategori: "scenekunst",
    niva: "fylke",
    sted: "Vestland",
    fylkesnr: "46",
    frist: "2026-11-06",
    status: "åpen",
    handling: "handling_mulig",
    kilde: "https://www.vestlandfylke.no",
  },
  {
    id: "famkult-horing",
    tittel: "Høring i Familie- og kulturkomiteen om kulturloven",
    sammendrag: "Komiteen tar imot skriftlige innspill.",
    instans: "Familie- og kulturkomiteen, Stortinget",
    kategori: "musikk",
    niva: "nasjonalt",
    sted: "Nasjonalt",
    frist: "2026-11-02",
    status: "høring",
    handling: "handling_mulig",
    kilde: "https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=107272",
  },
  {
    id: "regjeringen-frist",
    tittel: "Departementet ber om innspill til musikktilskudd",
    sammendrag: "Kultur- og likestillingsdepartementet har en høringsfrist i november.",
    instans: "KUD – høring",
    kategori: "musikk",
    niva: "nasjonalt",
    sted: "Nasjonalt",
    frist: "2026-11-20",
    status: "høring",
    handling: "handling_mulig",
    kilde: "https://www.regjeringen.no/no/dokumenter/horing-musikk/id1",
  },
  {
    id: "oslo-referat",
    tittel: "Referat fra kulturutvalget i Oslo",
    sammendrag: "Møtet er holdt. Saken ligger her til orientering.",
    instans: "Oslo kommune",
    kategori: "musikk",
    niva: "kommune",
    sted: "Oslo",
    kommunenr: "0301",
    fylkesnr: "03",
    frist: null,
    status: "normal",
    handling: "bare_orientering",
    kilde: "https://www.oslo.kommune.no",
  },
  {
    id: "bergen-dans",
    tittel: "Bergen kommune behandler dansetilskudd",
    sammendrag: "Denne saken skal ikke vises når du følger Oslo og Vestland fylkeskommune.",
    instans: "Bergen kommune",
    kategori: "dans",
    niva: "kommune",
    sted: "Bergen",
    kommunenr: "4601",
    fylkesnr: "46",
    frist: "2026-10-30",
    status: "høring",
    handling: "handling_mulig",
    kilde: "https://www.bergen.kommune.no",
  },
  {
    id: "kulturskole-trd",
    tittel: "Trondheim vurderer kulturskoletilbudet",
    sammendrag: "Saken treffer det lagrede søket, ikke sted eller fag.",
    instans: "Trondheim kommune",
    kategori: "kulturarv",
    niva: "kommune",
    sted: "Trondheim",
    kommunenr: "5001",
    fylkesnr: "50",
    frist: "2026-12-01",
    status: "normal",
    handling: "bare_orientering",
    kilde: "https://www.trondheim.kommune.no",
  },
  {
    id: "fulgt-bodo",
    tittel: "Nytt kulturbygg i Bodø",
    sammendrag: "Du følger denne saken selv om den ligger utenfor sted og fag.",
    instans: "Bodø kommune",
    kategori: "kulturarv",
    niva: "kommune",
    sted: "Bodø",
    kommunenr: "1804",
    fylkesnr: "18",
    frist: null,
    status: "vedtak",
    handling: "bare_orientering",
    kilde: "https://www.bodo.kommune.no",
  },
];

export type DemoKampanje = {
  id: string;
  tittel: string;
  beskrivelse: string;
  kategori: string;
  sakId: string;
  sig: number;
  mal: number;
  dager: number;
  tags: string[];
};

/** Felles innspill som treffer demosaken i Oslo. Ikke en ekte kampanje. */
export const DEMO_KAMPANJER: DemoKampanje[] = [
  {
    id: "kamp-oslo",
    tittel: "Behold tilskuddet til frie grupper i Oslo",
    beskrivelse: "Felles innspill før bystyret behandler kulturbudsjettet.",
    kategori: "musikk",
    sakId: "oslo-musikk",
    sig: 128,
    mal: 500,
    dager: 4,
    tags: ["Oslo", "musikk"],
  },
];

export type DemoModus = "oppsett" | "side" | "tom" | "forside";

const TOM_DEMO = { modus: null, steg: 1 as const, endre: false };

/** Vercel setter VERCEL_ENV. Vite eksponerer den som VITE_VERCEL_ENV. */
function lesVercelEnv(): string | undefined {
  if (typeof import.meta.env === "undefined") return undefined;
  return import.meta.env.VITE_VERCEL_ENV;
}

/** ?demo= virker i preview og lokalt. Prod-bygg ignorerer parameteren. */
export function demoTillatt(miljo: string | undefined = lesVercelEnv()): boolean {
  return miljo !== "production";
}

export function tolkDemo(
  search: string,
  miljo?: string,
): { modus: DemoModus | null; steg: 1 | 2 | 3; endre: boolean } {
  if (!demoTillatt(miljo)) return TOM_DEMO;
  const q = new URLSearchParams(search);
  const demo = q.get("demo");
  const modus = demo === "oppsett" || demo === "side" || demo === "tom" || demo === "forside" ? demo : null;
  const n = Number(q.get("steg"));
  const steg = n === 2 || n === 3 ? n : 1;
  return { modus, steg, endre: q.get("endre") === "1" };
}

/** Utloggede på /min-side skal møte innlogging, ikke oppsett. Demo er unntaket. */
export function visInnloggingsport(harBruker: boolean, erDemo: boolean): boolean {
  return !harBruker && !erDemo;
}

/** Lenker fra saken skal lande i innholdet, ikke i oppsettsteget. */
export function hoppOverOppsettForAnker(hash: string): boolean {
  return hash === "#fulgte" || hash === "#stottet";
}

export function lesDemo(): { modus: DemoModus | null; steg: 1 | 2 | 3; endre: boolean } {
  if (typeof window === "undefined") return TOM_DEMO;
  return tolkDemo(window.location.search);
}

/** Rå ?demo=-verdi, eller null når demo er slått av. */
export function demoParameter(): string | null {
  if (!demoTillatt() || typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("demo");
}

/** side og forside er samme innloggede eksempel, bare ulike startsteder. */
export function erUtfyltDemo(modus: DemoModus | null): boolean {
  return modus === "side" || modus === "forside";
}
