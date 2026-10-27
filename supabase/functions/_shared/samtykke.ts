// Ren logikk for påmelding, avmelding og utsendelse. Ingen Deno- eller
// databasekall, slik at filen kan testes med Node.

import { erTillattOpprinnelse } from "./cors.ts";

export const SAMTYKKE_VERSJON = "nyhetsbrev-2026-10";
export const PERSONVERN_VERSJON = "personvern-2026-10";
export const KILDE_VENTESIDE = "venteside";
/** Settes ikke av koden. Håkon kan merke gamle rader med denne verdien senere. */
export const KILDE_GAMMEL_LISTE = "gammel_liste_uten_dokumentert_samtykke";

export const RATE_EPOST = 5;
export const RATE_IP = 20;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function erUuid(verdi: string | null | undefined): verdi is string {
  return !!verdi && UUID_RE.test(verdi);
}

export function normaliserEpost(epost: string): string {
  return epost.trim().toLowerCase();
}

export function erGyldigEpost(epost: string): boolean {
  if (epost.length < 3 || epost.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epost);
}

export function escapeHtml(verdi: string): string {
  return verdi
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rensNavn(verdi: unknown): string {
  if (typeof verdi !== "string") return "";
  return verdi.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 80);
}

export type PameldingInput = {
  epost: string;
  fornavn: string;
  etternavn: string;
};

export function validerPamelding(
  body: unknown,
): { ok: true; bot: true } | { ok: true; bot: false; verdi: PameldingInput } | { ok: false; feil: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, feil: "Ugyldig forespørsel." };
  }
  const felt = body as Record<string, unknown>;
  if (typeof felt.kv_hp_felt === "string" && felt.kv_hp_felt.trim() !== "") {
    return { ok: true, bot: true };
  }
  if (felt.samtykke !== true) {
    return { ok: false, feil: "Du må krysse av for samtykke." };
  }
  if (felt.samtykke_tekst_versjon !== SAMTYKKE_VERSJON) {
    return { ok: false, feil: "Samtykketeksten er utdatert. Last siden på nytt." };
  }
  const epost = typeof felt.epost === "string" ? normaliserEpost(felt.epost) : "";
  if (!erGyldigEpost(epost)) {
    return { ok: false, feil: "Skriv inn en gyldig e-postadresse." };
  }
  return {
    ok: true,
    bot: false,
    verdi: {
      epost,
      fornavn: rensNavn(felt.fornavn),
      etternavn: rensNavn(felt.etternavn),
    },
  };
}

export function erBlokkert(epostAntall: number, ipAntall: number): boolean {
  return epostAntall >= RATE_EPOST || ipAntall >= RATE_IP;
}

export function opphavTillatt(origin: string | null): boolean {
  if (!origin) return true;
  if (erTillattOpprinnelse(origin)) return true;
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function lesToken(url: URL, body: string, contentType: string): string | null {
  const fraUrl = url.searchParams.get("t");
  if (fraUrl) return fraUrl;
  if (contentType.includes("application/json") && body) {
    try {
      const json = JSON.parse(body) as Record<string, unknown>;
      if (typeof json.token === "string") return json.token;
      if (typeof json.t === "string") return json.t;
    } catch {
      return null;
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded") && body) {
    return new URLSearchParams(body).get("t");
  }
  return null;
}

export function erOneClick(body: string, contentType: string): boolean {
  if (!contentType.includes("application/x-www-form-urlencoded")) return false;
  return new URLSearchParams(body).get("List-Unsubscribe") === "One-Click";
}

export function skalSkriveAvmelding(metode: string): boolean {
  return metode.toUpperCase() === "POST";
}

export type Bekreftelsesutfall = "bekreft" | "allerede" | "avmeldt";

/**
 * En gammel bekreftelseslenke skal ikke gjøre om en avmelding.
 * Nytt samtykke (samtykke_gitt_at etter avmeldt_at) kan bekreftes på nytt.
 */
export function bekreftelsesutfall(rad: {
  bekreftet_at: string | null;
  avmeldt_at: string | null;
  samtykke_gitt_at: string | null;
}): Bekreftelsesutfall {
  const nyttSamtykke = Boolean(
    rad.avmeldt_at && rad.samtykke_gitt_at && rad.samtykke_gitt_at > rad.avmeldt_at,
  );
  if (rad.avmeldt_at && !nyttSamtykke) return "avmeldt";
  if (rad.avmeldt_at && nyttSamtykke) return "bekreft";
  if (rad.bekreftet_at) return "allerede";
  return "bekreft";
}

export type Pameldingsrad = {
  id: number;
  epost: string | null;
  avmeldings_token: string | null;
  samtykke_gitt_at: string | null;
  bekreftet_at: string | null;
  avmeldt_at: string | null;
};

export type Hoppgrunn =
  | "uten_samtykke"
  | "ubekreftet"
  | "avmeldt"
  | "uten_token"
  | "ugyldig"
  | "duplikat";

/** Mottaker som har passert filteret: gyldig e-post og avmeldingstoken. */
export type KvalifisertMottaker = Pameldingsrad & {
  epost: string;
  avmeldings_token: string;
};

export type Utsendelsesplan = {
  mottakere: KvalifisertMottaker[];
  hoppetOver: { id: number; epost: string; grunn: Hoppgrunn }[];
};

/**
 * Bare dokumentert, bekreftet og ikke-avmeldt. Én rad per adresse, laveste id.
 * Avmeldte og ubekreftede blir med i hoppetOver, ikke i mottakere.
 */
export function planleggUtsendelse(rader: Pameldingsrad[]): Utsendelsesplan {
  const sett = new Map<string, KvalifisertMottaker>();
  const hoppetOver: Utsendelsesplan["hoppetOver"] = [];
  const sortert = [...rader].sort((a, b) => a.id - b.id);
  for (const rad of sortert) {
    const epost = normaliserEpost(rad.epost ?? "");
    const token = rad.avmeldings_token;
    let grunn: Hoppgrunn | null = null;
    if (!erGyldigEpost(epost)) grunn = "ugyldig";
    else if (!rad.samtykke_gitt_at) grunn = "uten_samtykke";
    else if (rad.avmeldt_at) grunn = "avmeldt";
    else if (!rad.bekreftet_at) grunn = "ubekreftet";
    else if (!erUuid(token)) grunn = "uten_token";
    else if (sett.has(epost)) grunn = "duplikat";
    if (grunn) {
      hoppetOver.push({ id: rad.id, epost, grunn });
      continue;
    }
    // Samme sjekk som over. Den smalner token til string for typen.
    if (!erUuid(token)) continue;
    sett.set(epost, { ...rad, epost, avmeldings_token: token });
  }
  return { mottakere: [...sett.values()], hoppetOver };
}

export function filtrerMottakere(rader: Pameldingsrad[]): KvalifisertMottaker[] {
  return planleggUtsendelse(rader).mottakere;
}

/** Hovedbryteren er av med mindre hemmeligheten UTSENDING_AKTIV er nøyaktig "true". */
export function utsendingErAktiv(verdi: string | undefined | null): boolean {
  return typeof verdi === "string" && verdi.trim().toLowerCase() === "true";
}

export function dryRunLogg(mottakere: Pameldingsrad[]): {
  send: false;
  status: "dry_run";
  rader: { pamelding_id: number; status: "dry_run" }[];
} {
  return {
    send: false,
    status: "dry_run",
    rader: mottakere.map((rad) => ({ pamelding_id: rad.id, status: "dry_run" as const })),
  };
}

export function oppsummerHopp(
  hoppetOver: Utsendelsesplan["hoppetOver"],
): Record<Hoppgrunn, number> {
  const tall: Record<Hoppgrunn, number> = {
    uten_samtykke: 0,
    ubekreftet: 0,
    avmeldt: 0,
    uten_token: 0,
    ugyldig: 0,
    duplikat: 0,
  };
  for (const rad of hoppetOver) tall[rad.grunn] += 1;
  return tall;
}

export type UtsendelsesModus = "test" | "en" | "alle" | "avvist";

export function utsendelsesModus(body: unknown): UtsendelsesModus {
  if (!body || typeof body !== "object") return "avvist";
  const felt = body as Record<string, unknown>;
  if (felt.test === true) return "test";
  if (typeof felt.til === "string" && felt.til.trim()) {
    return erGyldigEpost(normaliserEpost(felt.til)) ? "en" : "avvist";
  }
  if (felt.bekreft === "send") return "alle";
  return "avvist";
}

export function hemmeligheterStemmer(
  oppgitt: string | null,
  forventet: string | undefined | null,
): boolean {
  if (!forventet || oppgitt == null) return false;
  const lengde = Math.max(oppgitt.length, forventet.length);
  let diff = oppgitt.length === forventet.length ? 0 : 1;
  for (let i = 0; i < lengde; i++) {
    diff |= (oppgitt.charCodeAt(i) || 0) ^ (forventet.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function listUnsubscribeHeaders(funksjonUrl: string): {
  "List-Unsubscribe": string;
  "List-Unsubscribe-Post": string;
} {
  return {
    "List-Unsubscribe": `<${funksjonUrl}>, <mailto:avmelding@kulturvarsling.no?subject=avmeld>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export function avmeldingsSide(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/avmelding?t=${encodeURIComponent(token)}`;
}

export function avmeldingsFunksjon(supabaseUrl: string, token: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/avmeld?t=${encodeURIComponent(token)}`;
}

export function bekreftelsesSide(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/bekreft?t=${encodeURIComponent(token)}`;
}

export type EpostMedAvmelding = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: {
    "List-Unsubscribe": string;
    "List-Unsubscribe-Post": string;
  };
};

function tokenFraLenke(lenke: string): string | null {
  try {
    return new URL(lenke).searchParams.get("t");
  } catch {
    return null;
  }
}

/**
 * Alle utgående brev (bekreftelse, nyhetsbrev/ukesbrev og varsler) skal
 * gjennom her. Uten avmeldingslenke med token blir brevet ikke bygd.
 */
export function lagEpost(input: {
  fra: string;
  til: string;
  emne: string;
  html: string;
  tekst: string;
  side: string;
  funksjon: string;
}): EpostMedAvmelding {
  if (!erUuid(tokenFraLenke(input.side)) || !erUuid(tokenFraLenke(input.funksjon))) {
    throw new Error("E-post krever avmeldingslenke med token");
  }
  const href = escapeHtml(input.side);
  const html = input.html.includes(input.side)
    ? input.html
    : `${input.html}<p><a href="${href}">Meld meg av</a></p>`;
  const text = input.tekst.includes(input.side)
    ? input.tekst
    : `${input.tekst}\n\nMeld deg av: ${input.side}`;
  return {
    from: input.fra,
    to: input.til,
    subject: input.emne,
    html,
    text,
    headers: listUnsubscribeHeaders(input.funksjon),
  };
}

export const MELDING_VENTENDE_BEKREFTELSE =
  "Takk! Du er registrert. Du får en e-post for å bekrefte påmeldingen så snart utsendingen er klar.";

/**
 * Lagringen har lyktes. Brukeren får aldri en feil av at e-posten ikke gikk.
 * Uten sendt e-post forblir bekreftelse_sendt_at null.
 */
export function svarEtterLagretPamelding(epostSendt: boolean): {
  ok: true;
  status: 200;
  melding: string;
} {
  return {
    ok: true,
    status: 200,
    melding: epostSendt
      ? "Sjekk e-posten din og klikk på bekreftelseslenken. Du er ikke på listen før den er bekreftet."
      : MELDING_VENTENDE_BEKREFTELSE,
  };
}

/** Allerede bekreftet rad. Ikke lov en bekreftelses-e-post som ikke ble sendt. */
export function svarAlleredeRegistrert(epostSendt: boolean): {
  ok: true;
  status: 200;
  melding: string;
} {
  return {
    ok: true,
    status: 200,
    melding: epostSendt
      ? "Sjekk e-posten din. Adressen er allerede bekreftet."
      : "Takk! Du er allerede registrert og bekreftet.",
  };
}

export function loggNarResendMangler(kontekst: "meld-pa" | "send-bekreftelser" | "nyhetsbrev"): string {
  if (kontekst === "nyhetsbrev") {
    return "nyhetsbrev: RESEND_API_KEY mangler. Ingenting er sendt.";
  }
  return `${kontekst}: RESEND_API_KEY mangler. E-post sendes ikke. Påmeldingen blir liggende med bekreftelse_sendt_at null.`;
}

export function bekreftelsesBrev(lenke: string, bunn: string): { emne: string; html: string; tekst: string } {
  const href = escapeHtml(lenke);
  const bunnHtml = escapeHtml(bunn);
  return {
    emne: "Bekreft påmelding til Kulturvarsling",
    html: `<!doctype html><html lang="no"><body style="font-family:Georgia,serif;background:#FBF8F2;color:#1C1B19;padding:32px;">
    <p>Bekreft at du vil motta nyhetsbrev fra Kulturvarsling.</p>
    <p><a href="${href}">Bekreft påmeldingen</a></p>
    <p style="color:#6B665C;font-size:14px;">Hvis du ikke ba om dette, kan du se bort fra e-posten. Ingenting sendes før lenken er bekreftet.</p>
    <p style="color:#6B665C;font-size:14px;">${bunnHtml}</p>
  </body></html>`,
    tekst: `Bekreft påmeldingen ved å åpne lenken:\n${lenke}\n\nIngenting sendes før lenken er bekreftet.\n\n${bunn}`,
  };
}

export type Bekreftelsesrad = {
  id: number;
  epost: string | null;
  avmeldings_token: string | null;
  bekreftelses_token: string | null;
  samtykke_gitt_at: string | null;
  samtykke_tekst_versjon: string | null;
  bekreftet_at: string | null;
  avmeldt_at: string | null;
  bekreftelse_sendt_at: string | null;
};

export type VentendeBekreftelse = {
  id: number;
  epost: string;
  avmeldings_token: string;
  bekreftelses_token: string;
  ovrigeIder: number[];
};

/**
 * Rader som venter på bekreftelses-e-post. Historisk tekstversjon,
 * ubekreftet samtykke, avmeldte og allerede sendte tas ikke med.
 * Én e-post per adresse, laveste id. Øvrige id-er stemples sammen med den.
 */
export function velgVentendeBekreftelser(
  rader: Bekreftelsesrad[],
  allerede: { ids?: ReadonlySet<number>; eposter?: ReadonlySet<string> } = {},
): VentendeBekreftelse[] {
  const blokkertId = allerede.ids ?? new Set<number>();
  const blokkertEpost = new Set<string>();
  for (const adresse of allerede.eposter ?? []) {
    const epost = normaliserEpost(adresse);
    if (erGyldigEpost(epost)) blokkertEpost.add(epost);
  }
  for (const rad of rader) {
    const epost = normaliserEpost(rad.epost ?? "");
    if (!erGyldigEpost(epost)) continue;
    if (rad.bekreftelse_sendt_at || blokkertId.has(rad.id)) blokkertEpost.add(epost);
  }
  const grupper = new Map<string, VentendeBekreftelse>();
  const sortert = [...rader].sort((a, b) => a.id - b.id);
  for (const rad of sortert) {
    const epost = normaliserEpost(rad.epost ?? "");
    if (!erGyldigEpost(epost) || blokkertEpost.has(epost)) continue;
    if (!rad.samtykke_gitt_at) continue;
    if (rad.samtykke_tekst_versjon !== SAMTYKKE_VERSJON) continue;
    if (rad.bekreftet_at || rad.avmeldt_at || rad.bekreftelse_sendt_at) continue;
    if (!erUuid(rad.bekreftelses_token) || !erUuid(rad.avmeldings_token)) continue;
    const finnes = grupper.get(epost);
    if (finnes) {
      finnes.ovrigeIder.push(rad.id);
      continue;
    }
    grupper.set(epost, {
      id: rad.id,
      epost,
      avmeldings_token: rad.avmeldings_token,
      bekreftelses_token: rad.bekreftelses_token,
      ovrigeIder: [],
    });
  }
  return [...grupper.values()];
}

/** Suksess bare når skrivingen faktisk gikk gjennom. */
export function svarEtterSkriving(
  feil: string | null,
): { ok: true } | { ok: false; status: number; feil: string } {
  if (feil) return { ok: false, status: 500, feil };
  return { ok: true };
}

/** Tabeller som ikke slettes av CASCADE, fordi fremmednøkkelen setter NULL. */
export const SLETT_FØR_BRUKER = ["horingssvar", "feedback"] as const;
