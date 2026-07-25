// eInnsyn-adapter — første plattformadapter (KILDEKART: «én integrasjon → nasjonal dekning»).
// Verifisert juli 2026: api.einnsyn.no er åpent for lesing uten API-nøkkel.
// VIKTIG: datofiltrene heter moetedatoFrom/moetedatoTo — moetedatoAfter ignoreres STILLE.

const API = "https://api.einnsyn.no";

export type EInnsynMoetesak = {
  id?: string;
  offentligTittel?: string;
  publisertDato?: string;
  journalenhet?: string;
  moetesaksaar?: number;
  moetesakssekvensnummer?: number;
};

// Geografi utledet fra organet saken hører til (fylles av slåOppGeo).
export type OrganGeo = {
  navn?: string;
  kommunenr?: string | null;
  fylkesnr?: string | null;
  sted?: string | null;
  niva?: "kommune" | "fylke" | "nasjonalt" | null;
};

// Enhetstype fra eInnsyn → nivå. BYDEL/KOMMUNE = kommune, FYLKESKOMMUNE = fylke,
// STAT/DEPARTEMENT o.l. = nasjonalt. Ukjent → null (Claude/default bestemmer).
export function nivaFraEnhetstype(t?: string): OrganGeo["niva"] {
  const s = (t ?? "").toUpperCase();
  if (s.includes("FYLKE")) return "fylke";
  if (s === "KOMMUNE" || s === "BYDEL") return "kommune";
  if (s === "STAT" || s.includes("DEPARTEMENT") || s.includes("DIREKTORAT")) return "nasjonalt";
  return null;
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
  sammendrag_raa: string;
  kilde_id: string;
  publisert_dato: string | null;
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
    sammendrag_raa: `Politisk møtesak hos ${organ}${saksref}, publisert via eInnsyn.`,
    kilde_id: `einnsyn-${item.id}`,
    publisert_dato: item.publisertDato ? item.publisertDato.split("T")[0] : null,
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
// deretter Brønnøysund → kommunenummer + kommunenavn. Fylkesnr = to første
// siffer i kommunenr. Best effort — alle feil gir tom geo (saken lagres uansett).
async function slåOppGeo(enhetId: string): Promise<OrganGeo> {
  try {
    const eRes = await fetch(`${API}/enhet/${enhetId}`, {
      headers: { Accept: "application/json" },
    });
    if (!eRes.ok) return {};
    const enhet = await eRes.json();
    const geo: OrganGeo = {
      navn: enhet?.navn ?? undefined,
      niva: nivaFraEnhetstype(enhet?.enhetstype),
    };
    const orgnr = String(enhet?.orgnummer ?? "").replace(/\D/g, "");
    if (orgnr.length === 9) {
      try {
        const bRes = await fetch(
          `https://data.brreg.no/enhetsregisteret/api/enheter/${orgnr}`,
          { headers: { Accept: "application/json", "User-Agent": "Kulturvarsling/1.0" } },
        );
        if (bRes.ok) {
          const b = await bRes.json();
          const knr = b?.forretningsadresse?.kommunenummer ?? null;
          if (knr) {
            geo.kommunenr = knr;
            geo.fylkesnr = String(knr).slice(0, 2);
            const kommune = b?.forretningsadresse?.kommune;
            if (kommune) {
              geo.sted = kommune.charAt(0) + kommune.slice(1).toLowerCase();
            }
            // Fant kommune, men enhetstype var ukjent → anta kommunenivå
            if (!geo.niva) geo.niva = "kommune";
          }
        }
      } catch (_) {
        // Brønnøysund utilgjengelig — behold navn/nivå fra eInnsyn
      }
    }
    return geo;
  } catch (_) {
    return {};
  }
}

// Henter kultursaker fra politiske møter i hele landet (alle organ i eInnsyn).
export async function hentEInnsynKultursaker(): Promise<any[]> {
  const items: any[] = [];
  try {
    const res = await fetch(
      `${API}/search?query=kultur&entity=Moetesak&limit=50`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) {
      console.error(`eInnsyn search svarte ${res.status}`);
      return items;
    }
    const data = await res.json();
    const rå: EInnsynMoetesak[] = data?.items ?? [];

    // Slå opp geografi per unik journalenhet (navn + kommunenr), maks 25 oppslag.
    const geoMap = new Map<string, OrganGeo>();
    const unike = [...new Set(rå.map((i) => i.journalenhet).filter(Boolean))]
      .slice(0, 25) as string[];
    for (const enhetId of unike) {
      geoMap.set(enhetId, await slåOppGeo(enhetId));
    }

    for (const item of rå) {
      const geo = item.journalenhet ? geoMap.get(item.journalenhet) : undefined;
      const mappet = mapEInnsynItem(item, geo);
      if (mappet) items.push(mappet);
    }
    const medKommune = [...geoMap.values()].filter((g) => g.kommunenr).length;
    console.log(
      `eInnsyn: ${rå.length} møtesaker, ${unike.length} organ, ${medKommune} geo-tagget`,
    );
  } catch (e) {
    console.error("eInnsyn feil:", e);
  }
  return items;
}
