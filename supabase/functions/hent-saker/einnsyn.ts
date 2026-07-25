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

// Ren mapping — testes i logikk.test.ts uten nettverk.
export function mapEInnsynItem(
  item: EInnsynMoetesak,
  enhetNavn?: string,
): {
  tittel: string;
  instans: string;
  kilde: string;
  frist: null;
  sammendrag_raa: string;
  kilde_id: string;
  publisert_dato: string | null;
  forhåndsgodkjent: boolean;
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

    // Slå opp organnavn per unik journalenhet (med cache, maks 25 oppslag)
    const enhetNavn = new Map<string, string>();
    const unike = [...new Set(rå.map((i) => i.journalenhet).filter(Boolean))]
      .slice(0, 25) as string[];
    for (const enhetId of unike) {
      try {
        const eRes = await fetch(`${API}/enhet/${enhetId}`, {
          headers: { Accept: "application/json" },
        });
        if (eRes.ok) {
          const enhet = await eRes.json();
          if (enhet?.navn) enhetNavn.set(enhetId, enhet.navn);
        }
      } catch (_) {
        // navnløst organ er OK — mappingen har fallback
      }
    }

    for (const item of rå) {
      const mappet = mapEInnsynItem(
        item,
        item.journalenhet ? enhetNavn.get(item.journalenhet) : undefined,
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
