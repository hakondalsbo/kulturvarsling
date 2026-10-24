import { dagerTilFrist } from "../frist.ts";
import { forsidePrioritet, vurderSak } from "../handling.ts";
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

export type KampanjeRef = {
  id: string | number;
  tittel: string;
  kategori?: string | null;
  sakId?: string | number | null;
};

export type BoksLinje = {
  id: string | number;
  tittel: string;
  frist: string | null;
  rolle: "handling" | "orientering";
};

/** Samme hovedsak som avisen velger, så boksen ikke gjentar den. */
function hovedsakId(saker: MinSak[], nå: Date): string | null {
  const kan = saker.filter((s) => vurderSak(s, nå).handlingsrettet);
  const grunnlag = kan.length > 0 ? kan : saker;
  if (grunnlag.length === 0) return null;
  const sortert = [...grunnlag].sort((a, b) => {
    const rang = forsidePrioritet(a, nå) - forsidePrioritet(b, nå);
    if (rang !== 0) return rang;
    const da = dagerTilFrist(a.frist, nå);
    const db = dagerTilFrist(b.frist, nå);
    return (da == null || da < 0 ? 10_000 : da) - (db == null || db < 0 ? 10_000 : db);
  });
  return String(sortert[0].id);
}

/**
 * Inntil fire saker fra det brukeren følger, uten avisens hovedsak.
 * Resten ligger på Min side. Avisen selv endres ikke.
 */
export function boksForForside(
  valg: MinValg,
  saker: MinSak[],
  fulgte: Array<string | number>,
  sok: LagretSok[],
  nå: Date,
): BoksLinje[] {
  const deler = delMinSide(saker, valg, fulgte, sok, nå);
  const sett = new Set<string>();
  const rekkefolge: MinSak[] = [];
  for (const sak of [...deler.mobiliser, ...deler.handling, ...deler.frister, ...deler.fulgte, ...deler.strom]) {
    const id = String(sak.id);
    if (sett.has(id)) continue;
    sett.add(id);
    rekkefolge.push(sak);
  }
  const lead = hovedsakId(saker, nå);
  const utenLead = rekkefolge.filter((s) => String(s.id) !== lead);
  const valgt = (utenLead.length > 0 ? utenLead : rekkefolge).slice(0, 4);
  return valgt.map((sak) => ({
    id: sak.id,
    tittel: sak.tittel || "Sak uten tittel",
    frist: sak.frist ? String(sak.frist).slice(0, 10) : null,
    rolle: sak.handling === "handling_mulig" ? "handling" : "orientering",
  }));
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
