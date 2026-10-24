import { kategorierForMeny } from "./kategorier.ts";
import { komiteNavn } from "./komiteer.ts";
import {
  DEMO_DAG,
  DEMO_FULGTE,
  DEMO_KAMPANJER,
  DEMO_SAKER,
  DEMO_SOK,
  DEMO_VALG,
  erUtfyltDemo,
  lesDemo,
  type DemoKampanje,
  type DemoModus,
} from "./demo.ts";
import { delMinSide, TOMT_VALG, type LagretSok, type MinSak, type MinValg } from "./filter.ts";
import { stedNavn } from "./steder.ts";

export type KampanjeRef = {
  id: string | number;
  tittel: string;
  kategori?: string | null;
  sakId?: string | number | null;
};

export type ForslagSak = {
  id: string | number;
  tittel: string;
  instans: string;
  handling: boolean;
  kampanjeTittel: string | null;
};

export type SnarveiId = "forside" | "minside" | "varsler" | "mobiliser" | "innspill";

export type Forslag = {
  setning: string;
  folger: string[];
  saker: ForslagSak[];
  snarveier: { id: SnarveiId; label: string; tekst: string }[];
};

const ORGAN: Record<string, string> = {
  stortinget: "Stortinget",
  regjeringen: "Regjeringen",
};

function oppramsing(deler: string[]): string {
  if (deler.length <= 1) return deler[0] ?? "";
  return `${deler.slice(0, -1).join(", ")} og ${deler[deler.length - 1]}`;
}

function kampanjeFor(kampanjer: KampanjeRef[], sak: MinSak): KampanjeRef | undefined {
  return kampanjer.find((k) => k.sakId != null && String(k.sakId) === String(sak.id));
}

export function forslagTilDeg(
  valg: MinValg,
  saker: MinSak[],
  fulgte: Array<string | number>,
  sok: LagretSok[],
  kampanjer: KampanjeRef[],
  nå: Date,
  sted: "forside" | "minside",
): Forslag {
  const fagNavn = new Map(kategorierForMeny().map((k) => [k.id, k.label]));
  const folger = [
    ...stedNavn(valg.geografisk),
    ...valg.fagfelt.map((id) => fagNavn.get(id)).filter((n): n is string => !!n),
    ...valg.organ.map((id) => ORGAN[id]).filter((n): n is string => !!n),
    ...valg.komiteer.map(komiteNavn),
    ...sok.map((s) => `søket «${s.navn}»`),
  ];
  const deler = delMinSide(saker, valg, fulgte, sok, nå);
  const grunnlag = [...deler.mobiliser, ...deler.handling];
  const valgt = (grunnlag.length > 0 ? grunnlag : deler.fulgte).slice(0, 2);
  const forslagSaker: ForslagSak[] = valgt.map((sak) => {
    const kampanje = kampanjeFor(kampanjer, sak);
    return {
      id: sak.id,
      tittel: sak.tittel || "Sak uten tittel",
      instans: sak.instans || "Ukjent instans",
      handling: sak.handling === "handling_mulig",
      kampanjeTittel: kampanje?.tittel ?? null,
    };
  });
  const harInnspill = kampanjer.some((k) =>
    forslagSaker.some((s) => String(s.id) === String(k.sakId))
    || (k.kategori && valg.fagfelt.includes(k.kategori))
    || fulgte.some((id) => String(id) === String(k.sakId)),
  );
  const setning = folger.length > 0
    ? sted === "forside"
      ? `Du følger ${oppramsing(folger)}. Forsiden under viser fortsatt alt. Dette feltet er tilpasset deg.`
      : `Du følger ${oppramsing(folger)}. Samme valg styrer varslene. Herfra skriver du innspill eller støtter et felles innspill.`
    : fulgte.length > 0
      ? `Du følger ${fulgte.length === 1 ? "én sak" : `${fulgte.length} saker`}. Forsiden viser fortsatt alt det andre.`
      : "Velg sted og fag, så tilpasses dette feltet og varslene. Forsiden viser fortsatt alt.";

  return {
    setning,
    folger,
    saker: forslagSaker,
    snarveier: [
      { id: "forside", label: "Forsiden", tekst: "Alt som er publisert" },
      { id: "minside", label: "Min side", tekst: "Bare det du følger" },
      { id: "varsler", label: "Varslingsvalg", tekst: "Samme avkrysning som her" },
      { id: "mobiliser", label: "Mobiliser", tekst: "Brev og innspill" },
      { id: "innspill", label: "Felles innspill", tekst: harInnspill ? "Et innspill treffer det du følger" : "Kampanjer du kan støtte" },
    ],
  };
}

export type PersonligKilde = {
  userId?: string;
  valg: MinValg;
  saker: MinSak[];
  fulgte: Array<string | number>;
  sok: LagretSok[];
  kampanjer: KampanjeRef[];
  nå?: Date;
};

export function personligKilde(live: PersonligKilde, modus: DemoModus | null = lesDemo().modus): PersonligKilde & { vis: boolean; mock: boolean } {
  if (erUtfyltDemo(modus)) {
    return {
      vis: true,
      mock: true,
      userId: "demo",
      valg: DEMO_VALG,
      saker: DEMO_SAKER,
      fulgte: [...DEMO_FULGTE],
      sok: DEMO_SOK,
      kampanjer: DEMO_KAMPANJER,
      nå: DEMO_DAG,
    };
  }
  if (modus === "tom") {
    return {
      vis: true,
      mock: true,
      userId: "demo",
      valg: { ...TOMT_VALG },
      saker: [],
      fulgte: [],
      sok: [],
      kampanjer: [],
      nå: DEMO_DAG,
    };
  }
  return {
    ...live,
    vis: !!live.userId,
    mock: false,
    nå: live.nå ?? new Date(),
  };
}

export function kampanjeTrefferSak(kampanjer: KampanjeRef[], sakId: string | number): DemoKampanje | KampanjeRef | undefined {
  return kampanjer.find((k) => k.sakId != null && String(k.sakId) === String(sakId));
}
