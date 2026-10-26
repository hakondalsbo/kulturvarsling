// eInnsyn-adapter — første plattformadapter (KILDEKART: «én integrasjon → nasjonal dekning»).
// Verifisert juli 2026: api.einnsyn.no er åpent for lesing uten API-nøkkel.
// VIKTIG: datofiltrene heter moetedatoFrom/moetedatoTo — moetedatoAfter ignoreres STILLE.

import {
  feilFraUnntak,
  feilUtfall,
  lesTekstRespons,
  okUtfall,
  uventetFormat,
  type AdapterUtfall,
  type HenteFeil,
} from "./kildehelse.ts";

const API = "https://api.einnsyn.no";
const BRREG_API = "https://data.brreg.no/enhetsregisteret/api";

/** Digdir 26.10.2026: navn og kontaktadresse skal stå i User-Agent. */
export const EINNSYN_USER_AGENT =
  "Kulturvarsling/1.0 (kulturvarsling.no; post@kulturvarsling.no)";

/** Avbryter nattkjøringen. slåOppGeo skal ikke svelge denne. */
export class EinnsynStopp extends Error {
  readonly feil: HenteFeil;
  constructor(feil: HenteFeil) {
    super(feil.melding);
    this.name = "EinnsynStopp";
    this.feil = feil;
  }
}

// Dagens søk. Uendret når EINNSYN_V2_AKTIV ikke er nøyaktig "true".
export const EINNSYN_V1_SOK =
  `${API}/search?query=kultur&entity=Moetesak&sortBy=publisertDato&sortOrder=desc&limit=50`;
export const EINNSYN_V1_MAKS_GEO = 25;

export type EInnsynMoetesak = {
  id?: string;
  offentligTittel?: string;
  publisertDato?: string;
  journalenhet?: string;
  moetesaksaar?: number;
  moetesakssekvensnummer?: number;
  moetedato?: string | null;
};

// Geografi utledet fra organet saken hører til (fylles av slåOppGeo).
export type OrganGeo = {
  navn?: string;
  kommunenr?: string | null;
  fylkesnr?: string | null;
  sted?: string | null;
  niva?: "kommune" | "fylke" | "nasjonalt" | null;
};

export type BrregAdresse = {
  kommunenummer?: string | null;
  kommune?: string | null;
};

export type BrregEnhet = {
  navn?: string | null;
  organisasjonsform?: { kode?: string | null } | null;
  institusjonellSektorkode?: { kode?: string | null } | null;
  forretningsadresse?: BrregAdresse | null;
  postadresse?: BrregAdresse | null;
  overordnetEnhet?: string | null;
};

type KlassifisertGeo = Required<
  Pick<OrganGeo, "kommunenr" | "fylkesnr" | "sted" | "niva">
>;

const TOM_GEO: KlassifisertGeo = {
  kommunenr: null,
  fylkesnr: null,
  sted: null,
  niva: null,
};

// Fylkesnummeret er de to første sifrene i et gyldig kommunenummer.
export function fylkesnrFraKommunenr(
  kommunenr?: string | null,
): string | null {
  const normalisert = String(kommunenr ?? "").trim();
  return /^\d{4}$/.test(normalisert) ? normalisert.slice(0, 2) : null;
}

function formaterSted(sted?: string | null): string | null {
  const navn = sted?.trim();
  if (!navn) return null;
  if (navn !== navn.toUpperCase()) return navn;
  return navn.charAt(0) + navn.slice(1).toLowerCase();
}

/** Fylkesting og fylkeskommune i navnet er fylke, også når eInnsyn sier BYDEL. */
export function nivaFraOrgannavn(
  navn?: string | null,
): { niva: "kommune" | "fylke"; sted: string } | null {
  const sted = formaterSted(navn);
  if (!sted) return null;
  const n = sted.toLowerCase();
  if (/fylkeskommune|fylkesting/.test(n)) return { niva: "fylke", sted };
  // Oslo bystyre ligger ikke i kommunenavnet. Organet er kommunalt.
  if (/bystyrets sekretariat/.test(n)) return { niva: "kommune", sted: "Oslo" };
  if (/\bbydel\b/.test(n)) return { niva: "kommune", sted };
  if (/\bkommune\b/.test(n)) return { niva: "kommune", sted };
  return null;
}

function formKode(enhet?: BrregEnhet | null): string {
  return String(enhet?.organisasjonsform?.kode ?? "").toUpperCase();
}

function fylkesnrFraAdresse(enhet?: BrregEnhet | null): string | null {
  const adresse = [enhet?.forretningsadresse, enhet?.postadresse].find((a) =>
    Boolean(fylkesnrFraKommunenr(a?.kommunenummer))
  );
  return fylkesnrFraKommunenr(adresse?.kommunenummer);
}

// Ren Brreg-mapping. Bare sektorkode 6500 er lokal kommuneforvaltning.
// FYLK har adresse i administrasjonsbyen og får derfor aldri kommunenummer.
// Underenhet av en fylkeskommune er fylke, selv om adressen ligger i Oslo.
export function geografiFraBrreg(
  enhet: BrregEnhet | null,
  organNavn?: string,
  overordnet?: BrregEnhet | null,
): KlassifisertGeo {
  if (!enhet) return { ...TOM_GEO };

  const egetForm = formKode(enhet);
  const parentForm = formKode(overordnet);
  if (egetForm === "FYLK" || parentForm === "FYLK") {
    const fylkesnr = egetForm === "FYLK"
      ? fylkesnrFraAdresse(enhet)
      : null;
    return {
      kommunenr: null,
      fylkesnr,
      sted: nivaFraOrgannavn(organNavn)?.sted
        ?? formaterSted(overordnet?.navn)
        ?? formaterSted(organNavn),
      niva: "fylke",
    };
  }

  const sektorkode = String(
    enhet.institusjonellSektorkode?.kode ?? "",
  ).trim();
  if (sektorkode !== "6500") {
    return {
      ...TOM_GEO,
      // 6100 er statsforvaltningen. Andre/ukjente sektorer holdes uklassifisert.
      niva: sektorkode === "6100" ? "nasjonalt" : null,
    };
  }

  const adresse = [enhet.forretningsadresse, enhet.postadresse].find((a) =>
    Boolean(fylkesnrFraKommunenr(a?.kommunenummer))
  );
  const kommunenr = adresse?.kommunenummer?.trim() ?? null;
  const fylkesnr = fylkesnrFraKommunenr(kommunenr);

  if (!fylkesnr) {
    return {
      ...TOM_GEO,
      niva: "kommune",
    };
  }

  return {
    kommunenr,
    fylkesnr,
    sted: formaterSted(adresse?.kommune) ?? formaterSted(organNavn),
    niva: "kommune",
  };
}

// Enhetstype fra eInnsyn → nivå. BYDEL/KOMMUNE = kommune, FYLKESKOMMUNE = fylke,
// STAT/DEPARTEMENT o.l. = nasjonalt. ORGAN, VIRKSOMHET og ukjent → null.
// BYDEL er upålitelig: Akershus fylkesting er registrert som BYDEL.
export function nivaFraEnhetstype(t?: string): OrganGeo["niva"] {
  const s = (t ?? "").toUpperCase();
  if (s.includes("FYLKE")) return "fylke";
  if (s === "KOMMUNE" || s === "BYDEL") return "kommune";
  if (s === "STAT" || s.includes("DEPARTEMENT") || s.includes("DIREKTORAT")) return "nasjonalt";
  return null;
}

/**
 * Navn som sier fylke vinner over feil enhetstype og over administrasjonsbyen.
 * Brreg vinner over Claude. Enhetstype brukes når Brreg og navnet tier.
 */
export function avklarEinnsynGeo(input: {
  enhetstype?: string | null;
  navn?: string | null;
  brreg?: BrregEnhet | null;
  overordnet?: BrregEnhet | null;
}): KlassifisertGeo {
  const fraNavn = nivaFraOrgannavn(input.navn);
  const brreg = input.brreg
    ? geografiFraBrreg(input.brreg, input.navn ?? undefined, input.overordnet)
    : { ...TOM_GEO };
  if (fraNavn?.niva === "fylke") {
    return {
      kommunenr: null,
      fylkesnr: brreg.niva === "fylke" ? brreg.fylkesnr : null,
      sted: fraNavn.sted,
      niva: "fylke",
    };
  }
  if (brreg.niva) return brreg;
  if (fraNavn) {
    return { kommunenr: null, fylkesnr: null, sted: fraNavn.sted, niva: fraNavn.niva };
  }
  const fraType = nivaFraEnhetstype(input.enhetstype ?? undefined);
  if (fraType) {
    return { kommunenr: null, fylkesnr: null, sted: null, niva: fraType };
  }
  return { ...TOM_GEO };
}

/**
 * Nivå og sted som lagres. Adapterens geografi vinner over Claude.
 * Avviste saker skal ikke falle tilbake til nasjonalt/Norge når organet er kjent.
 */
export function geografiSomLagres(
  item: { niva?: string | null; sted?: string | null; instans?: string | null },
  analyseNiva?: string | null,
): { niva: "nasjonalt" | "fylke" | "kommune"; sted: string } {
  const fraNavn = nivaFraOrgannavn(item.instans);
  if (fraNavn?.niva === "fylke") {
    return {
      niva: "fylke",
      sted: item.niva === "fylke" && item.sted ? item.sted : fraNavn.sted,
    };
  }
  if (item.niva === "kommune" || item.niva === "fylke" || item.niva === "nasjonalt") {
    return {
      niva: item.niva,
      sted: item.sted
        ?? (item.niva === "nasjonalt" ? "Nasjonalt" : fraNavn?.sted ?? "Norge"),
    };
  }
  if (fraNavn) return { niva: fraNavn.niva, sted: fraNavn.sted };
  if (analyseNiva === "kommune" || analyseNiva === "fylke" || analyseNiva === "nasjonalt") {
    return {
      niva: analyseNiva,
      sted: item.sted ?? (analyseNiva === "nasjonalt" ? "Nasjonalt" : "Norge"),
    };
  }
  return { niva: "nasjonalt", sted: item.sted ?? "Nasjonalt" };
}

// Ren mapping — testes i logikk.test.ts uten nettverk.
export function mapEInnsynItem(
  item: EInnsynMoetesak,
  geo?: OrganGeo,
): {
  tittel: string;
  instans: string;
  kilde: string;
  frist: null;
  motedato: string | null;
  sammendrag_raa: string;
  kilde_id: string;
  publisert_dato: string | null;
  kilde_publisert: string | null;
  forhåndsgodkjent: boolean;
  kommunenr: string | null;
  fylkesnr: string | null;
  sted: string | null;
  niva: OrganGeo["niva"];
} | null {
  if (!item?.id || !item.offentligTittel) return null;
  const organ = geo?.navn || "Organ i eInnsyn";
  const saksref =
    item.moetesaksaar && item.moetesakssekvensnummer
      ? ` (møtesak ${item.moetesaksaar}/${item.moetesakssekvensnummer})`
      : "";
  return {
    tittel: item.offentligTittel,
    instans: organ,
    kilde: `https://einnsyn.no/moetesak/${item.id}`,
    frist: null,
    motedato: item.moetedato ? String(item.moetedato).slice(0, 10) : null,
    sammendrag_raa: `Politisk møtesak hos ${organ}${saksref}, publisert via eInnsyn.`,
    kilde_id: `einnsyn-${item.id}`,
    publisert_dato: item.publisertDato ? item.publisertDato.split("T")[0] : null,
    kilde_publisert: item.publisertDato ?? null,
    // Treff på query=kultur i eInnsyn — skal ikke stoppes av nøkkelordfilteret
    // (treffet kan ligge i dokumentteksten, ikke tittelen). Claude vurderer uansett.
    forhåndsgodkjent: true,
    kommunenr: geo?.kommunenr ?? null,
    fylkesnr: geo?.fylkesnr ?? null,
    sted: geo?.sted ?? null,
    niva: geo?.niva ?? null,
  };
}

// Slår opp geografi for ett organ: eInnsyn-enhet → orgnummer + enhetstype,
// deretter Brønnøysund → sektor, organisasjonsform og adresse. Best effort —
// ved nettverksfeil beholdes navn/nivå fra eInnsyn, og saken lagres uansett.
async function lesBrreg(orgnr: string, hent: typeof fetch = fetch): Promise<BrregEnhet | null> {
  for (const sti of ["enheter", "underenheter"]) {
    const res = await hent(`${BRREG_API}/${sti}/${orgnr}`, {
      headers: { Accept: "application/json", "User-Agent": EINNSYN_USER_AGENT },
    });
    if (res.ok) return await res.json() as BrregEnhet;
    if (res.status !== 404) return null;
  }
  return null;
}

export async function slåOppGeo(enhetId: string, hent: typeof fetch = fetch): Promise<OrganGeo> {
  try {
    const eRes = await hent(`${API}/enhet/${enhetId}`, {
      headers: { Accept: "application/json", "User-Agent": EINNSYN_USER_AGENT },
    });
    if (!eRes.ok) return {};
    const enhet = await eRes.json();
    const navn = enhet?.navn ?? undefined;
    const orgnr = String(enhet?.orgnummer ?? "").replace(/\D/g, "");
    let brreg: BrregEnhet | null = null;
    let overordnet: BrregEnhet | null = null;
    if (orgnr.length === 9) {
      try {
        brreg = await lesBrreg(orgnr, hent);
        const parent = String(brreg?.overordnetEnhet ?? "").replace(/\D/g, "");
        if (parent.length === 9) overordnet = await lesBrreg(parent, hent);
      } catch (_) {
        // Brønnøysund utilgjengelig — behold navn/nivå fra eInnsyn
      }
    }
    const klass = avklarEinnsynGeo({
      enhetstype: enhet?.enhetstype,
      navn,
      brreg,
      overordnet,
    });
    return {
      navn,
      kommunenr: klass.kommunenr,
      fylkesnr: klass.fylkesnr,
      sted: klass.sted,
      niva: klass.niva,
    };
  } catch (e) {
    if (e instanceof EinnsynStopp) throw e;
    return {};
  }
}

// Henter kultursaker fra politiske møter i hele landet (alle organ i eInnsyn).
// Geo-oppslag er best effort og feiler aldri selve søket.
// Kallvolumet her er uendret. v2 ligger i einnsyn-v2.ts og kjører bare når
// EINNSYN_V2_AKTIV er nøyaktig "true".
export async function hentEInnsynKultursaker(opts?: {
  hent?: typeof fetch;
}): Promise<AdapterUtfall> {
  const hent = opts?.hent ?? fetch;
  // Nyeste først. Uten sort kan de 50 treffene være eldre møter, og
  // datogrensen i hent-saker siler dem bort uten at nyere saker er med.
  const url = EINNSYN_V1_SOK;
  try {
    const res = await hent(url, {
      headers: { Accept: "application/json", "User-Agent": EINNSYN_USER_AGENT },
    });
    const lest = await lesTekstRespons(res, url);
    if ("feil" in lest) {
      console.error(`eInnsyn search: ${lest.feil.melding}`, url);
      return feilUtfall(lest.feil);
    }
    let data: any;
    try {
      data = JSON.parse(lest.tekst);
    } catch (e) {
      const feil = feilFraUnntak(e, url);
      console.error("eInnsyn parse:", e);
      return feilUtfall(feil);
    }
    if (!Array.isArray(data?.items)) {
      const feil = uventetFormat(url, "mangler items");
      console.error(`eInnsyn: ${feil.melding}`, url);
      return feilUtfall(feil);
    }
    const rå: EInnsynMoetesak[] = data.items;
    const items: any[] = [];

    // Slå opp geografi per unik journalenhet (navn + kommunenr), maks 25 oppslag.
    const geoMap = new Map<string, OrganGeo>();
    const unike = [...new Set(rå.map((i) => i.journalenhet).filter(Boolean))]
      .slice(0, EINNSYN_V1_MAKS_GEO) as string[];
    for (const enhetId of unike) {
      geoMap.set(enhetId, await slåOppGeo(enhetId, hent));
    }

    for (const item of rå) {
      const geo = item.journalenhet ? geoMap.get(item.journalenhet) : undefined;
      const mappet = mapEInnsynItem(item, geo);
      if (mappet) items.push(mappet);
    }
    const medGeo = [...geoMap.values()].filter((g) =>
      g.kommunenr || g.fylkesnr
    ).length;
    console.log(
      `eInnsyn: ${rå.length} møtesaker, ${unike.length} organ, ${medGeo} geo-tagget`,
    );
    return okUtfall(items, rå.length, items.length, res.status);
  } catch (e) {
    console.error("eInnsyn feil:", e);
    return feilUtfall(feilFraUnntak(e, url));
  }
}
