// Engangs-backfill (VEIKART E1): gir eksisterende eInnsyn-saker riktig geografi.
// Idempotent — kan kjøres flere ganger, gir samme resultat. Ny-innhentede saker
// får geografi direkte i hent-saker; denne rydder opp i det som lå der fra før.
//
// For hver sak med einnsyn.no/moetesak/{id}-kilde: møtesak → journalenhet →
// orgnr → Brønnøysund → kommunenr/fylkesnr (samme regel som hent-saker/einnsyn.ts).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EINNSYN = "https://api.einnsyn.no";
const BRREG = "https://data.brreg.no/enhetsregisteret/api/enheter";

type Geografi = { kommunenr: string | null; fylkesnr: string | null };

function fylkesnrFraKommunenr(knr?: string | null): string | null {
  if (!knr || !/^\d{4}$/.test(knr)) return null;
  return knr.slice(0, 2);
}

// Kun kommuneforvaltningen (sektor 6500) får geografi — statlige organ (6100)
// har ofte Oslo-adresse og ville feilaktig blitt Oslo-saker. Fylkeskommuner
// (FYLK) får kun fylkesnr; adressen deres peker på administrasjonsbyen.
function geografiFraBrreg(enhet: any): Geografi {
  const ingen: Geografi = { kommunenr: null, fylkesnr: null };
  if (!enhet || enhet?.institusjonellSektorkode?.kode !== "6500") return ingen;
  const knr = enhet?.forretningsadresse?.kommunenummer ??
    enhet?.postadresse?.kommunenummer ?? null;
  const fylkesnr = fylkesnrFraKommunenr(knr);
  if (!fylkesnr) return ingen;
  if (enhet?.organisasjonsform?.kode === "FYLK") {
    return { kommunenr: null, fylkesnr };
  }
  return { kommunenr: knr, fylkesnr };
}

async function jsonEllerNull(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    return res.ok ? await res.json() : null;
  } catch (_) {
    return null;
  }
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Alle eInnsyn-saker (uansett om de har geografi — idempotent oppdatering)
  const { data: saker, error } = await supabase
    .from("varsler")
    .select("id, kilde, kommunenr, fylkesnr, niva, sted")
    .like("kilde", "%einnsyn.no/moetesak/%");
  if (error) {
    return new Response(JSON.stringify({ feil: error.message }), { status: 500 });
  }

  // Cache: enhetId → {orgnr, navn}, orgnr → geografi (få unike, mange saker)
  const enhetCache = new Map<string, { orgnr?: string; navn?: string }>();
  const geoCache = new Map<string, Geografi>();

  let oppdatert = 0, uendret = 0, uten_geo = 0;
  const feil: string[] = [];
  const eksempler: string[] = [];

  for (const sak of saker ?? []) {
    const mid = String(sak.kilde).replace(/\/$/, "").split("/").pop();
    if (!mid) { feil.push(`${sak.id}: ingen møtesak-id`); continue; }

    const moetesak = await jsonEllerNull(`${EINNSYN}/moetesak/${mid}`);
    const enhetId: string | undefined = moetesak?.journalenhet;
    if (!enhetId) { feil.push(`${mid}: fant ikke journalenhet`); continue; }

    if (!enhetCache.has(enhetId)) {
      const enhet = await jsonEllerNull(`${EINNSYN}/enhet/${enhetId}`);
      enhetCache.set(enhetId, {
        orgnr: enhet?.orgnummer,
        navn: enhet?.navn,
      });
    }
    const { orgnr, navn } = enhetCache.get(enhetId)!;
    if (!orgnr) { feil.push(`${mid}: enhet mangler orgnr`); continue; }

    if (!geoCache.has(orgnr)) {
      geoCache.set(orgnr, geografiFraBrreg(await jsonEllerNull(`${BRREG}/${orgnr}`)));
    }
    const geo = geoCache.get(orgnr)!;

    const niva = geo.kommunenr ? "kommune" : geo.fylkesnr ? "fylke" : sak.niva;
    const sted = (geo.kommunenr || geo.fylkesnr) ? (navn ?? sak.sted) : sak.sted;

    if (!geo.kommunenr && !geo.fylkesnr) uten_geo++;

    // Hopp over skriving hvis alt allerede stemmer (idempotent)
    if (
      sak.kommunenr === geo.kommunenr && sak.fylkesnr === geo.fylkesnr &&
      sak.niva === niva && sak.sted === sted
    ) { uendret++; continue; }

    const { error: uErr } = await supabase
      .from("varsler")
      .update({
        kommunenr: geo.kommunenr,
        fylkesnr: geo.fylkesnr,
        niva,
        sted,
      })
      .eq("id", sak.id);
    if (uErr) { feil.push(`${mid}: ${uErr.message}`); continue; }
    oppdatert++;
    if (eksempler.length < 10) {
      eksempler.push(`${navn ?? enhetId}: niva=${niva} knr=${geo.kommunenr ?? "-"} fnr=${geo.fylkesnr ?? "-"}`);
    }
  }

  // ── Eldre {navn}.kommune.no-saker (demo/seed fra før eInnsyn-adapteren) ──
  // Ingen adapter lager disse lenger, men de ligger på siden. Utled kommunenr
  // fra subdomenet mot Brønnøysunds kommuneliste (bergen→4601, stavanger→1103).
  let kommune_no_oppdatert = 0;
  const kommuneListe = await jsonEllerNull(
    "https://data.brreg.no/enhetsregisteret/api/kommuner?size=500",
  );
  const navnTilNr = new Map<string, string>();
  for (const k of kommuneListe?._embedded?.kommuner ?? []) {
    navnTilNr.set(String(k.navn).replace(/[\s-]/g, "").toUpperCase(), k.nummer);
  }
  const { data: komSaker } = await supabase
    .from("varsler")
    .select("id, kilde, kommunenr, fylkesnr, niva, sted")
    .like("kilde", "%.kommune.no%")
    .is("kommunenr", null);
  for (const sak of komSaker ?? []) {
    const m = String(sak.kilde).match(/https?:\/\/(?:www\.)?([a-z0-9æøå]+)\.kommune\.no/i);
    const subdomene = m?.[1]?.toUpperCase();
    const knr = subdomene ? navnTilNr.get(subdomene) : undefined;
    if (!knr) { feil.push(`${sak.kilde}: fant ikke kommune for subdomene`); continue; }
    const { error: uErr } = await supabase
      .from("varsler")
      .update({ kommunenr: knr, fylkesnr: knr.slice(0, 2), niva: "kommune" })
      .eq("id", sak.id);
    if (uErr) { feil.push(`${sak.id}: ${uErr.message}`); continue; }
    kommune_no_oppdatert++;
    if (eksempler.length < 12) eksempler.push(`${subdomene}: knr=${knr} fnr=${knr.slice(0, 2)}`);
  }

  const respons = {
    einnsyn_saker: saker?.length ?? 0,
    oppdatert,
    uendret,
    kunne_ikke_geotagge: uten_geo,
    kommune_no_oppdatert,
    eksempler,
    feil: feil.length ? feil.slice(0, 15) : undefined,
  };
  console.log("Backfill ferdig:", respons);
  return new Response(JSON.stringify(respons), {
    headers: { "Content-Type": "application/json" },
  });
});
