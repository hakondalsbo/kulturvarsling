/**
 * Varselpreferanser. Samme treffregler som sak_treffer_abonnement og
 * mottakere_for_sak i migrasjonen 20261020155426_varsel_preferanser.sql.
 * Ingen utsending — bare hva som skal lagres, og hvem en senere motor skal lese.
 */

export type SakTreff = {
  kategori?: string | null;
  niva?: string | null;
  fylkesnr?: string | number | null;
  kommunenr?: string | number | null;
  sted?: string | null;
};

export type GeoValg =
  | { type: "alle" }
  | { type: "nasjonalt" }
  | { type: "fylke"; nr?: string | null; navn?: string }
  | { type: "kommune"; sted?: string | null; fylkesnr?: string | null };

export type MottakerGrunn = "sak" | "abonnement";

export type Mottaker = {
  brukerId: string;
  epost: string | null;
  varselFrekvens: string | null;
  grunn: MottakerGrunn;
};

export type ProfilPreferanse = {
  id: string;
  epost?: string | null;
  authEpost?: string | null;
  varsel_frekvens?: string | null;
  varsler_aktive?: boolean | null;
  fagfelt?: string[] | null;
  geografisk?: string[] | null;
};

const NIVA = ["nasjonalt", "fylke", "kommune"] as const;

function tekst(v: string | number | null | undefined): string {
  if (v == null) return "";
  return String(v).trim();
}

export function geoTilToken(geo: GeoValg): string {
  if (geo.type === "fylke" && tekst(geo.nr)) return `fylke:${tekst(geo.nr)}`;
  if (geo.type === "kommune" && tekst(geo.sted)) return `sted:${tekst(geo.sted).toLowerCase()}`;
  if (geo.type === "nasjonalt") return "niva:nasjonalt";
  return "land";
}

export function nivaaFraGeografisk(geografisk: string[] | null | undefined): string[] {
  const g = geografisk ?? [];
  if (g.length === 0 || g.includes("land")) return [...NIVA];
  const ut = new Set<string>();
  for (const tok of g) {
    if (tok === "niva:nasjonalt") ut.add("nasjonalt");
    if (tok === "niva:fylke" || tok.startsWith("fylke:")) ut.add("fylke");
    if (tok === "niva:kommune" || tok.startsWith("kommune:") || tok.startsWith("sted:")) ut.add("kommune");
  }
  return NIVA.filter((n) => ut.has(n));
}

/** Grovt nivå-valg fra innstillinger, uten å miste konkrete fylke/kommune-tokens. */
export function geografiskFraNivaa(nivaa: string[], eksisterende: string[] | null | undefined = []): string[] {
  const valgt = NIVA.filter((n) => nivaa.includes(n));
  if (valgt.length === 0 || valgt.length === NIVA.length) return ["land"];
  const behold = (eksisterende ?? []).filter((tok) => {
    if (tok.startsWith("fylke:")) return valgt.includes("fylke");
    if (tok.startsWith("kommune:") || tok.startsWith("sted:")) return valgt.includes("kommune");
    return false;
  });
  const brede = valgt
    .map((n) => `niva:${n}`)
    .filter((tok) => {
      if (tok === "niva:fylke" && behold.some((b) => b.startsWith("fylke:"))) return false;
      if (tok === "niva:kommune" && behold.some((b) => b.startsWith("kommune:") || b.startsWith("sted:"))) return false;
      return true;
    });
  return [...brede, ...behold];
}

export function leggTilUtvalg(
  fagfelt: string[] | null | undefined,
  geografisk: string[] | null | undefined,
  kat: string,
  geo: GeoValg,
): { fagfelt: string[]; geografisk: string[] } {
  const token = geoTilToken(geo);
  let fag = [...(fagfelt ?? [])];
  if (kat === "alle") fag = [];
  else if (!fag.includes(kat)) fag = [...fag, kat];

  if (token === "land") return { fagfelt: fag, geografisk: ["land"] };
  const geoListe = (geografisk ?? []).filter((t) => t !== "land");
  if (!geoListe.includes(token)) geoListe.push(token);
  return { fagfelt: fag, geografisk: geoListe };
}

export function utvalgErDekket(
  varslerAktive: boolean,
  fagfelt: string[] | null | undefined,
  geografisk: string[] | null | undefined,
  kat: string,
  geo: GeoValg,
): boolean {
  if (!varslerAktive) return false;
  const fag = fagfelt ?? [];
  const fagOk = kat === "alle" ? fag.length === 0 : fag.length === 0 || fag.includes(kat);
  if (!fagOk) return false;
  const liste = geografisk ?? [];
  if (liste.length === 0 || liste.includes("land")) return true;
  const token = geoTilToken(geo);
  if (liste.includes(token)) return true;
  if (token.startsWith("fylke:") && liste.includes("niva:fylke")) return true;
  if (token.startsWith("sted:") && liste.includes("niva:kommune")) return true;
  if (token === "niva:nasjonalt" && liste.includes("niva:nasjonalt")) return true;
  return false;
}

export function sakTrefferAbonnement(
  sak: SakTreff,
  fagfelt: string[] | null | undefined,
  geografisk: string[] | null | undefined,
): boolean {
  const fag = fagfelt ?? [];
  const geo = geografisk ?? [];
  const kategori = sak.kategori ?? null;
  if (fag.length > 0 && (kategori == null || !fag.includes(kategori))) return false;
  if (geo.length === 0 || geo.includes("land")) return true;
  const niva = tekst(sak.niva);
  const fylke = tekst(sak.fylkesnr);
  const kommune = tekst(sak.kommunenr);
  const sted = tekst(sak.sted).toLowerCase();
  return geo.some((tok) => {
    if (niva && tok === `niva:${niva}`) return true;
    if (fylke && tok === `fylke:${fylke}`) return true;
    if (kommune && tok === `kommune:${kommune}`) return true;
    if (sted && tok === `sted:${sted}`) return true;
    return false;
  });
}

function leveringsEpost(profil: ProfilPreferanse): string | null {
  const egen = tekst(profil.epost);
  if (egen) return egen;
  const auth = tekst(profil.authEpost);
  return auth || null;
}

/**
 * Samme utvalg som mottakere_for_sak: følgere alltid, abonnement bare når
 * varsler er aktive og saken treffer. Frekvens filtreres ikke.
 */
export function mottakereForSak(
  sak: SakTreff & { id: string },
  profiler: ProfilPreferanse[],
  fulgte: Array<{ brukerId: string; sakId: string }>,
): Mottaker[] {
  const folgere = new Set(fulgte.filter((f) => f.sakId === sak.id).map((f) => f.brukerId));
  const ut: Mottaker[] = [];
  for (const profil of profiler) {
    const folger = folgere.has(profil.id);
    const abonn = !!profil.varsler_aktive && sakTrefferAbonnement(sak, profil.fagfelt, profil.geografisk);
    if (!folger && !abonn) continue;
    ut.push({
      brukerId: profil.id,
      epost: leveringsEpost(profil),
      varselFrekvens: profil.varsel_frekvens ?? null,
      grunn: folger ? "sak" : "abonnement",
    });
  }
  ut.sort((a, b) => a.brukerId.localeCompare(b.brukerId));
  return ut;
}

export function preferanserFraProfil(profil: {
  fagfelt?: string[] | null;
  geografisk?: string[] | null;
  varsler_aktive?: boolean | null;
  varsel_frekvens?: string | null;
  epost?: string | null;
} | null | undefined) {
  const fagfelt = profil?.fagfelt ?? [];
  const geografisk = profil?.geografisk ?? [];
  const varslerAktive = !!profil?.varsler_aktive;
  return {
    fagfelt,
    geografisk,
    varslerAktive,
    varselFrekvens: profil?.varsel_frekvens || "daglig",
    varselKat: fagfelt,
    varselNivå: nivaaFraGeografisk(geografisk),
    varselEpost: varslerAktive ? tekst(profil?.epost) : "",
  };
}
