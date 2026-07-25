// eInnsyn-adapter — første plattformadapter (KILDEKART: «én integrasjon → nasjonal dekning»).
// Verifisert juli 2026: api.einnsyn.no er åpent for lesing uten API-nøkkel.
// VIKTIG: datofiltrene heter moetedatoFrom/moetedatoTo — moetedatoAfter ignoreres STILLE.

const API = "https://api.einnsyn.no";
const BRREG = "https://data.brreg.no/enhetsregisteret/api/enheter";

export type EInnsynMoetesak = {
  id?: string;
  offentligTittel?: string;
  publisertDato?: string;
  journalenhet?: string;
  moetesaksaar?: number;
  moetesakssekvensnummer?: number;
};

// ─── Geografi (VEIKART E1): orgnr → kommunenr/fylkesnr via Brønnøysund ────────
// Verifisert juli 2026: data.brreg.no/enhetsregisteret er åpent uten nøkkel.
// eInnsyns egen enhetstype kan IKKE brukes til å skille kommune fra fylke —
// «Vestland fylkeskommune» har enhetstype KOMMUNE der. Brreg har to presise
// signaler i stedet: institusjonellSektorkode 6500 = kommuneforvaltningen
// (statlige organ som universiteter er 6100 og ville ellers fått Oslo-adressen
// sin som kommunenr), og organisasjonsform FYLK = fylkeskommune, hvis adresse
// peker på administrasjonsbyen (Vestland → Bergen) — der settes kun fylkesnr.

export type BrregEnhet = {
  organisasjonsform?: { kode?: string };
  institusjonellSektorkode?: { kode?: string };
  forretningsadresse?: { kommunenummer?: string };
  postadresse?: { kommunenummer?: string };
};

export type Geografi = { kommunenr: string | null; fylkesnr: string | null };

// Fylkesnummer = de to første sifrene i kommunenummeret (SSB-standarden).
export function fylkesnrFraKommunenr(
  kommunenr?: string | null,
): string | null {
  if (!kommunenr || !/^\d{4}$/.test(kommunenr)) return null;
  return kommunenr.slice(0, 2);
}

// Ren mapping — testes i logikk.test.ts uten nettverk.
export function geografiFraBrreg(enhet: BrregEnhet | null): Geografi {
  const ingen: Geografi = { kommunenr: null, fylkesnr: null };
  if (!enhet) return ingen;
  if (enhet.institusjonellSektorkode?.kode !== "6500") return ingen; // statlig
  const knr = enhet.forretningsadresse?.kommunenummer ??
    enhet.postadresse?.kommunenummer ?? null;
  const fylkesnr = fylkesnrFraKommunenr(knr);
  if (!fylkesnr) return ingen;
  if (enhet.organisasjonsform?.kode === "FYLK") {
    return { kommunenr: null, fylkesnr };
  }
  return { kommunenr: knr, fylkesnr };
}

export async function hentBrregEnhet(orgnr: string): Promise<BrregEnhet | null> {
  try {
    const res = await fetch(`${BRREG}/${orgnr}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null; // uten geografi er saken fortsatt gyldig (vises som nasjonal)
  }
}

// Ren mapping — testes i logikk.test.ts uten nettverk.
export function mapEInnsynItem(
  item: EInnsynMoetesak,
  enhetNavn?: string,
  geo?: Geografi,
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
} | null {
  if (!item?.id || !item.offentligTittel) return null;
  const organ = enhetNavn || "Organ i eInnsyn";
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
    // Organnavnet som sted gir varselkortet «📍 Bydel Ullern» i stedet for «Norge»
    sted: geo?.kommunenr || geo?.fylkesnr ? organ : null,
  };
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

    // Slå opp organnavn + orgnr per unik journalenhet (med cache, maks 25 oppslag)
    const enheter = new Map<string, { navn?: string; orgnummer?: string }>();
    const unike = [...new Set(rå.map((i) => i.journalenhet).filter(Boolean))]
      .slice(0, 25) as string[];
    for (const enhetId of unike) {
      try {
        const eRes = await fetch(`${API}/enhet/${enhetId}`, {
          headers: { Accept: "application/json" },
        });
        if (eRes.ok) {
          const enhet = await eRes.json();
          enheter.set(enhetId, {
            navn: enhet?.navn,
            orgnummer: enhet?.orgnummer,
          });
        }
      } catch (_) {
        // navnløst organ er OK — mappingen har fallback
      }
    }

    // E1: kommunenr/fylkesnr per unikt orgnr (Brønnøysund, med cache)
    const geoPerOrgnr = new Map<string, Geografi>();
    const orgnr = [
      ...new Set([...enheter.values()].map((e) => e.orgnummer).filter(Boolean)),
    ] as string[];
    for (const nr of orgnr) {
      geoPerOrgnr.set(nr, geografiFraBrreg(await hentBrregEnhet(nr)));
    }

    for (const item of rå) {
      const enhet = item.journalenhet ? enheter.get(item.journalenhet) : undefined;
      const mappet = mapEInnsynItem(
        item,
        enhet?.navn,
        enhet?.orgnummer ? geoPerOrgnr.get(enhet.orgnummer) : undefined,
      );
      if (mappet) items.push(mappet);
    }
    console.log(
      `eInnsyn: ${rå.length} møtesaker hentet, ${unike.length} organ navngitt`,
    );
  } catch (e) {
    console.error("eInnsyn feil:", e);
  }
  return items;
}
