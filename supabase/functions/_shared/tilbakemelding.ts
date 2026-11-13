// Ren logikk for tilbakemelding. Ingen Deno-kall, så npm test kan kjøre den.
// Admin-eposter kommer inn som argument. De skal aldri hardkodes.

export const TILBAKEMELDING_TYPER = [
  { id: "forslag", label: "Forslag til justering" },
  { id: "feil", label: "Feil / noe som ikke virker" },
  { id: "mangler", label: "Mangler sak eller kilde" },
  { id: "utdatert", label: "Utdatert info / frist" },
  { id: "annet", label: "Annet" },
] as const;

export const TILBAKEMELDING_STATUSER = [
  { id: "ny", label: "Ny" },
  { id: "sett", label: "Sett" },
  { id: "planlagt", label: "Planlagt" },
  { id: "lost", label: "Løst" },
  { id: "avvist", label: "Avvist" },
] as const;

export type TilbakemeldingType = (typeof TILBAKEMELDING_TYPER)[number]["id"];
export type TilbakemeldingStatus = (typeof TILBAKEMELDING_STATUSER)[number]["id"];

export const TEKST_MIN = 8;
export const TEKST_MAKS = 2000;
export const SIDE_MAKS = 200;
export const SAK_TITTEL_MAKS = 300;
export const SAK_ID_MAKS = 80;
export const COOLDOWN_MS = 20_000;
export const FART_TILBAKEMELDING_IP = 8;
export const FART_TILBAKEMELDING_BRUKER = 6;

const TYPER = new Set<string>(TILBAKEMELDING_TYPER.map((t) => t.id));
const STATUSER = new Set<string>(TILBAKEMELDING_STATUSER.map((s) => s.id));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TilbakemeldingInnlegg = {
  type: TilbakemeldingType;
  tekst: string;
  side: string | null;
  sakTittel: string | null;
  sakId: string | null;
};

export type TilbakemeldingRad = {
  id: string;
  type: string;
  tekst: string;
  sak_tittel: string | null;
  sak_id: string | null;
  side: string | null;
  status: string;
  opprettet: string;
  bruker_id: string | null;
};

export function erTilbakemeldingType(verdi: unknown): verdi is TilbakemeldingType {
  return typeof verdi === "string" && TYPER.has(verdi);
}

export function erTilbakemeldingStatus(verdi: unknown): verdi is TilbakemeldingStatus {
  return typeof verdi === "string" && STATUSER.has(verdi);
}

export function typeEtikett(id: string): string {
  return TILBAKEMELDING_TYPER.find((t) => t.id === id)?.label ?? id;
}

export function statusEtikett(id: string): string {
  return TILBAKEMELDING_STATUSER.find((s) => s.id === id)?.label ?? id;
}

function utenStyring(verdi: string): string {
  return verdi.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

export function validerTilbakemelding(body: unknown): { ok: true; verdi: TilbakemeldingInnlegg } | { ok: false; feil: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, feil: "Ugyldig forespørsel." };
  }
  const rad = body as Record<string, unknown>;
  if (!erTilbakemeldingType(rad.type)) return { ok: false, feil: "Velg en kategori." };
  if (typeof rad.tekst !== "string") return { ok: false, feil: "Skriv en kort beskrivelse." };
  const tekst = utenStyring(rad.tekst);
  if (tekst.length < TEKST_MIN) return { ok: false, feil: `Skriv minst ${TEKST_MIN} tegn.` };
  if (tekst.length > TEKST_MAKS) return { ok: false, feil: `Teksten kan være høyst ${TEKST_MAKS} tegn.` };

  let side: string | null = null;
  if (rad.side != null && rad.side !== "") {
    if (typeof rad.side !== "string") return { ok: false, feil: "Ugyldig side." };
    side = utenStyring(rad.side);
    if (!side.startsWith("/") || side.includes("://") || side.length > SIDE_MAKS) {
      return { ok: false, feil: "Ugyldig side." };
    }
  }

  let sakTittel: string | null = null;
  if (rad.sak_tittel != null && rad.sak_tittel !== "") {
    if (typeof rad.sak_tittel !== "string") return { ok: false, feil: "Ugyldig sak." };
    sakTittel = utenStyring(rad.sak_tittel).slice(0, SAK_TITTEL_MAKS);
    if (!sakTittel) sakTittel = null;
  }

  let sakId: string | null = null;
  if (rad.sak_id != null && rad.sak_id !== "") {
    if (typeof rad.sak_id !== "string") return { ok: false, feil: "Ugyldig sak." };
    sakId = utenStyring(rad.sak_id);
    if (!sakId || sakId.length > SAK_ID_MAKS || !/^[\w.:-]+$/.test(sakId)) {
      return { ok: false, feil: "Ugyldig sak." };
    }
  }

  return { ok: true, verdi: { type: rad.type, tekst, side, sakTittel, sakId } };
}

export function cooldownIgjen(nå: number, sist: number | null, vindu = COOLDOWN_MS): number {
  if (sist == null || !Number.isFinite(sist)) return 0;
  return Math.max(0, vindu - (nå - sist));
}

/** Brukes bare når de nye kolonnene ikke finnes ennå. Konteksten legges øverst i teksten. */
export function tekstMedKontekst(inn: TilbakemeldingInnlegg): string {
  const linjer: string[] = [];
  if (inn.side) linjer.push(`Side: ${inn.side}`);
  if (inn.sakTittel) linjer.push(`Sak: ${inn.sakTittel}`);
  if (inn.sakId) linjer.push(`Sak-id: ${inn.sakId}`);
  if (linjer.length === 0) return inn.tekst;
  return `${linjer.join("\n")}\n\n${inn.tekst}`;
}

export function erManglendeKolonne(melding: string | null | undefined): boolean {
  if (!melding) return false;
  return /column|schema cache|PGRST204/i.test(melding);
}

/**
 * Tom liste, ubekreftet e-post eller ukjent adresse gir ikke tilgang.
 * Sammenligningen er hele adressen, uten jokertegn.
 */
export function erAdminEpost(
  epost: string | null | undefined,
  liste: string | null | undefined,
  bekreftet: boolean,
): boolean {
  if (!bekreftet || !epost || !liste) return false;
  const normalisert = epost.trim().toLowerCase();
  if (!normalisert.includes("@") || /\s/.test(normalisert)) return false;
  const tillatt = liste
    .split(",")
    .map((del) => del.trim().toLowerCase())
    .filter((del) => del.includes("@") && !/\s/.test(del));
  return tillatt.includes(normalisert);
}

export type AdminKall =
  | { handling: "list"; status: TilbakemeldingStatus | null; type: TilbakemeldingType | null }
  | { handling: "status"; id: string; status: TilbakemeldingStatus };

export function lesAdminKall(body: unknown): AdminKall | { feil: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { feil: "Ugyldig forespørsel." };
  const rad = body as Record<string, unknown>;
  if (rad.handling === "list") {
    const status = rad.status == null || rad.status === "" ? null : rad.status;
    const type = rad.type == null || rad.type === "" ? null : rad.type;
    if (status != null && !erTilbakemeldingStatus(status)) return { feil: "Ugyldig status." };
    if (type != null && !erTilbakemeldingType(type)) return { feil: "Ugyldig type." };
    return { handling: "list", status: status as TilbakemeldingStatus | null, type: type as TilbakemeldingType | null };
  }
  if (rad.handling === "status") {
    if (typeof rad.id !== "string" || !UUID.test(rad.id)) return { feil: "Ugyldig id." };
    if (!erTilbakemeldingStatus(rad.status)) return { feil: "Ugyldig status." };
    return { handling: "status", id: rad.id, status: rad.status };
  }
  return { feil: "Ukjent handling." };
}

export function filtrerRader(
  rader: readonly TilbakemeldingRad[],
  filter: { status?: string | null; type?: string | null },
): TilbakemeldingRad[] {
  return rader.filter((rad) => {
    if (filter.status && rad.status !== filter.status) return false;
    if (filter.type && rad.type !== filter.type) return false;
    return true;
  });
}

type InsertResultat = { error: { message?: string } | null };

export async function forsokLagre(
  db: { insert: (rad: Record<string, unknown>) => Promise<InsertResultat> },
  inn: TilbakemeldingInnlegg,
  brukerId: string | null,
): Promise<"ok" | "feil"> {
  const felles = {
    bruker_id: brukerId,
    type: inn.type,
    sak_tittel: inn.sakTittel,
  };
  const full = await db.insert({
    ...felles,
    tekst: inn.tekst,
    side: inn.side,
    sak_id: inn.sakId,
  });
  if (!full.error) return "ok";
  if (!erManglendeKolonne(full.error.message)) return "feil";
  const gammel = await db.insert({ ...felles, tekst: tekstMedKontekst(inn) });
  return gammel.error ? "feil" : "ok";
}

export type LeverUtfall = { ok: true; kanal: "funksjon" | "direkte" } | { ok: false; melding: string };

type Hent = (url: string, init: RequestInit) => Promise<Response>;

function meldingFra(body: unknown, standard: string): string {
  if (body && typeof body === "object") {
    const rad = body as Record<string, unknown>;
    if (typeof rad.feil === "string" && rad.feil.trim()) return rad.feil;
    if (typeof rad.message === "string" && rad.message.trim()) return rad.message;
  }
  return standard;
}

/**
 * Prøver edge-funksjonen først. 404 og nettverksfeil faller tilbake til
 * direkte innsetting i de kolonnene som finnes i dag, så skjemaet ikke
 * feiler hardt før funksjonen er deployet.
 */
export async function leverTilbakemelding(input: {
  hent: Hent;
  supabaseUrl: string;
  anonNokkel: string;
  token: string | null;
  brukerId: string | null;
  innlegg: unknown;
  nå?: number;
  sistSendt?: number | null;
}): Promise<LeverUtfall> {
  const validert = validerTilbakemelding(input.innlegg);
  if (!validert.ok) return { ok: false, melding: validert.feil };
  const vent = cooldownIgjen(input.nå ?? Date.now(), input.sistSendt ?? null);
  if (vent > 0) return { ok: false, melding: "Vent et øyeblikk før du sender en ny tilbakemelding." };

  const inn = validert.verdi;
  const origin = input.supabaseUrl.replace(/\/$/, "");
  const token = input.token || input.anonNokkel;
  const headere = {
    apikey: input.anonNokkel,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  let status: number | null = null;
  let body: unknown = null;
  try {
    const res = await input.hent(`${origin}/functions/v1/send-tilbakemelding`, {
      method: "POST",
      headers: headere,
      body: JSON.stringify({
        type: inn.type,
        tekst: inn.tekst,
        side: inn.side,
        sak_tittel: inn.sakTittel,
        sak_id: inn.sakId,
      }),
    });
    status = res.status;
    try { body = await res.json(); } catch { body = null; }
  } catch {
    status = null;
  }

  if (status != null && status !== 404) {
    if (status >= 200 && status < 300) return { ok: true, kanal: "funksjon" };
    if (status === 429) return { ok: false, melding: meldingFra(body, "Du har sendt flere tilbakemeldinger på kort tid. Vent litt og prøv igjen.") };
    return { ok: false, melding: meldingFra(body, "Kunne ikke lagre tilbakemeldingen. Prøv igjen.") };
  }

  try {
    const res = await input.hent(`${origin}/rest/v1/feedback`, {
      method: "POST",
      headers: { ...headere, Prefer: "return=minimal" },
      body: JSON.stringify({
        bruker_id: input.brukerId,
        type: inn.type,
        tekst: tekstMedKontekst(inn),
        sak_tittel: inn.sakTittel,
      }),
    });
    if (res.ok) return { ok: true, kanal: "direkte" };
    let feil: unknown = null;
    try { feil = await res.json(); } catch { feil = null; }
    return { ok: false, melding: meldingFra(feil, "Kunne ikke lagre tilbakemeldingen. Prøv igjen.") };
  } catch {
    return { ok: false, melding: "Kunne ikke nå serveren. Prøv igjen." };
  }
}

/** Eksempelrader til skjermbilder og lokal forhåndsvisning. Ingenting hentes fra databasen. */
export const DEMO_TILBAKEMELDINGER: TilbakemeldingRad[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    type: "forslag",
    tekst: "Fristen på forsiden kunne stått tydeligere ved siden av tittelen.",
    sak_tittel: null,
    sak_id: null,
    side: "/",
    status: "ny",
    opprettet: "2026-11-13T08:15:00.000Z",
    bruker_id: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    type: "feil",
    tekst: "Forklaringen lot seg ikke åpne da jeg sto på saken.",
    sak_tittel: "Høring i Familie- og kulturkomiteen om kulturloven",
    sak_id: "famkult-horing",
    side: "/arkiv",
    status: "sett",
    opprettet: "2026-11-12T14:40:00.000Z",
    bruker_id: "33333333-3333-4333-8333-333333333333",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    type: "mangler",
    tekst: "Savner saken om kulturskole i Bergen.",
    sak_tittel: null,
    sak_id: null,
    side: "/min-side",
    status: "planlagt",
    opprettet: "2026-11-11T09:05:00.000Z",
    bruker_id: null,
  },
];
