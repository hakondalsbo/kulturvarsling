// Ren logikk for påmelding, avmelding og utsendelse. Ingen Deno- eller
// databasekall, slik at filen kan testes med Node.

export const SAMTYKKE_VERSJON = "nyhetsbrev-2026-10";
/** Teksten de eksisterende venteside-radene faktisk så. */
export const HISTORISK_VERSJON = "venteside-2026-03-15";
/** Pause mellom kall til Resend, omtrent to i sekundet. */
export const BEKREFTELSE_PAUSE_MS = 550;
/** Ett kall får ikke sende mer enn dette. 110 lanseringsadresser ligger under taket. */
export const MAKS_BEKREFTELSER_PER_KALL = 200;
export const FORHANDSVISNING_TOKEN = "00000000-0000-4000-8000-000000000000";
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

const KENDTE_OPPHAV = new Set([
  "https://www.kulturvarsling.no",
  "https://kulturvarsling.no",
]);

export function opphavTillatt(origin: string | null): boolean {
  if (!origin) return true;
  if (KENDTE_OPPHAV.has(origin)) return true;
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

export type BekreftMaal = "lansering" | "nye";

export type BekreftOppdrag =
  | { type: "avvist"; grunn: string }
  | { type: "torrkjor"; maal: BekreftMaal }
  | { type: "test"; maal: BekreftMaal; til: string }
  | { type: "alle"; maal: BekreftMaal };

/**
 * Tom forespørsel, tom streng og en liste er aldri «alle».
 * Massesending krever maal og bekreft: "send". Én adresse krever til.
 */
export function lesBekreftelsesOppdrag(body: unknown): BekreftOppdrag {
  const stopp = "Ingenting er sendt.";
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { type: "avvist", grunn: `Tom forespørsel. ${stopp}` };
  }
  const felt = body as Record<string, unknown>;
  if (Array.isArray(felt.til) || Array.isArray(felt.mottakere) || felt.mottakere != null) {
    return { type: "avvist", grunn: `Mottakerliste godtas ikke. ${stopp}` };
  }
  if (felt.til === "" || felt.til === null) {
    return { type: "avvist", grunn: `Tom mottaker. ${stopp}` };
  }
  const maal = felt.maal === "lansering" || felt.maal === "nye" ? felt.maal : null;
  if (!maal) return { type: "avvist", grunn: `Mangler maal lansering eller nye. ${stopp}` };
  if (typeof felt.til === "string") {
    const til = normaliserEpost(felt.til);
    if (!erGyldigEpost(til)) return { type: "avvist", grunn: `Ugyldig adresse. ${stopp}` };
    return { type: "test", maal, til };
  }
  if (felt.til != null) return { type: "avvist", grunn: `Ugyldig mottaker. ${stopp}` };
  if (felt.bekreft === "send") return { type: "alle", maal };
  return { type: "torrkjor", maal };
}

export function malErUtkast(raw: string): boolean {
  return /\bUTKAST\b/.test(raw);
}

export type LanseringsmalInnhold = {
  emne: string;
  forhandsvisning: string;
  tekst: string;
};

export function parseLanseringsmal(raw: string): LanseringsmalInnhold | { feil: string } {
  const linjer = raw.replace(/^\uFEFF/, "").split(/\r?\n/);
  let emne = "";
  let forhandsvisning = "";
  const brod: string[] = [];
  for (const linje of linjer) {
    const trimmet = linje.trim();
    if (/^UTKAST\b/.test(trimmet)) continue;
    const emneTreff = trimmet.match(/^Emne:\s*(.*)$/);
    if (emneTreff) {
      emne = emneTreff[1].trim();
      continue;
    }
    const prevTreff = trimmet.match(/^Forhåndsvisning:\s*(.*)$/);
    if (prevTreff) {
      forhandsvisning = prevTreff[1].trim();
      continue;
    }
    brod.push(linje);
  }
  const tekst = brod.join("\n").trim();
  if (!emne) return { feil: "Malen mangler Emne:." };
  if (!tekst.includes("{{bekreftelseslenke}}")) return { feil: "Malen mangler {{bekreftelseslenke}}." };
  if (!tekst.includes("{{avmeldingslenke}}")) return { feil: "Malen mangler {{avmeldingslenke}}." };
  return { emne, forhandsvisning, tekst };
}

function bekreftKnapp(lenke: string): string {
  const href = escapeHtml(lenke);
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;"><tr><td style="background:#2B4A3F;border-radius:4px;"><a href="${href}" style="display:inline-block;padding:14px 22px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.2;color:#FBF8F2;text-decoration:none;">Bekreft påmelding</a></td></tr></table>`;
}

export function fyllLanseringsmal(
  mal: LanseringsmalInnhold,
  felt: {
    bekreftelseslenke: string;
    avmeldingslenke: string;
    behandlingsansvarlig: string;
    orgnr: string;
    personvern: string;
    avsender: string;
  },
): { emne: string; tekst: string; html: string } {
  const tekst = [
    mal.forhandsvisning,
    "",
    mal.tekst
      .replaceAll(/^[ \t]*\{\{bekreftelseslenke\}\}[ \t]*$/gm, `Bekreft påmelding: ${felt.bekreftelseslenke}`)
      .replaceAll(/^[ \t]*\{\{avmeldingslenke\}\}[ \t]*$/gm, `Meld meg av: ${felt.avmeldingslenke}`)
      .replaceAll("{{avmeldingslenke}}", felt.avmeldingslenke)
      .replaceAll("{{avsender}}", felt.avsender)
      .replaceAll("{{behandlingsansvarlig}}", felt.behandlingsansvarlig)
      .replaceAll("{{orgnr}}", felt.orgnr)
      .replaceAll("{{personvern}}", felt.personvern),
  ].filter((del, indeks) => indeks === 0 ? del.trim() !== "" : true).join("\n").trim();

  const blokker = mal.tekst.split(/\n{2,}/).map((del) => del.trim()).filter(Boolean);
  const htmlDeler = blokker.map((blokk) => {
    if (blokk === "{{bekreftelseslenke}}") return bekreftKnapp(felt.bekreftelseslenke);
    if (blokk === "{{avmeldingslenke}}") {
      const href = escapeHtml(felt.avmeldingslenke);
      return `<p style="margin:24px 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.5;"><a href="${href}" style="color:#2B4A3F;">Meld meg av</a></p>`;
    }
    const html = escapeHtml(blokk)
      .replaceAll("{{avsender}}", escapeHtml(felt.avsender))
      .replaceAll("{{behandlingsansvarlig}}", escapeHtml(felt.behandlingsansvarlig))
      .replaceAll("{{orgnr}}", escapeHtml(felt.orgnr))
      .replaceAll("{{personvern}}", `<a href="${escapeHtml(felt.personvern)}" style="color:#2B4A3F;">${escapeHtml(felt.personvern)}</a>`)
      .replaceAll("\n", "<br>");
    return `<p style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.6;color:#45413B;">${html}</p>`;
  });
  const skjult = mal.forhandsvisning
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(mal.forhandsvisning)}</div>`
    : "";
  const html = `<!doctype html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#FBF8F2;color:#1C1B19;">${skjult}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FBF8F2;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;"><tr><td style="font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:#1C1B19;padding:0 0 20px;">Kulturvarsling</td></tr><tr><td>${htmlDeler.join("")}</td></tr></table></td></tr></table></body></html>`;
  return { emne: mal.emne, tekst, html };
}

/**
 * Bryteren av, tørrkjør, UTKAST eller for stor liste sender ingenting.
 * Testsending av utkast går bare til den ene adressen, og stemples ikke.
 */
export function utsendelsesBeslutning(args: {
  oppdrag: BekreftOppdrag;
  aktiv: boolean;
  utkast: boolean;
  antall: number;
}): { send: false; grunn: string; sandkasse: boolean } | { send: true; sandkasse: boolean } {
  const sandkasse = args.oppdrag.type === "test" && (args.utkast || args.antall === 0);
  if (args.oppdrag.type === "avvist") return { send: false, grunn: args.oppdrag.grunn, sandkasse: false };
  if (!args.aktiv) {
    return { send: false, grunn: "UTSENDING_AKTIV er av. Ingenting er sendt.", sandkasse };
  }
  if (args.oppdrag.type === "torrkjor") {
    return { send: false, grunn: "Tørrkjør. Ingenting er sendt.", sandkasse: false };
  }
  if (args.oppdrag.type === "alle" && args.oppdrag.maal === "lansering" && args.utkast) {
    return { send: false, grunn: "Malen er merket UTKAST. Massesending er stoppet. Ingenting er sendt.", sandkasse: false };
  }
  if (args.oppdrag.type === "alle" && args.antall > MAKS_BEKREFTELSER_PER_KALL) {
    return { send: false, grunn: "For mange mottakere til én kjøring. Ingenting er sendt.", sandkasse: false };
  }
  if (args.oppdrag.type === "alle" && args.antall === 0) {
    return { send: false, grunn: "Ingen kvalifiserte mottakere. Ingenting er sendt.", sandkasse: false };
  }
  return { send: true, sandkasse };
}

export type Lanseringsrad = {
  id: number;
  epost: string | null;
  avmeldings_token: string | null;
  bekreftelses_token: string | null;
  samtykke_tekst_versjon: string | null;
  bekreftet_at: string | null;
  avmeldt_at: string | null;
  bekreftelse_sendt_at: string | null;
};

export type Lanseringsvalg = {
  id: number;
  epost: string;
  avmeldings_token: string | null;
  bekreftelses_token: string | null;
  ovrigeIder: number[];
};

/**
 * Gamle ubekreftede rader med venteside-teksten. Ikke nye skjema,
 * ikke bekreftede, ikke avmeldte, og aldri en adresse som allerede
 * har fått lanseringsmail. Laveste id får brevet.
 */
export function velgLanseringsmottakere(
  rader: Lanseringsrad[],
  allerede: { eposter?: ReadonlySet<string> } = {},
): Lanseringsvalg[] {
  const blokkert = new Set<string>();
  for (const adresse of allerede.eposter ?? []) {
    const epost = normaliserEpost(adresse);
    if (erGyldigEpost(epost)) blokkert.add(epost);
  }
  for (const rad of rader) {
    const epost = normaliserEpost(rad.epost ?? "");
    if (erGyldigEpost(epost) && rad.bekreftelse_sendt_at) blokkert.add(epost);
  }
  const grupper = new Map<string, Lanseringsvalg>();
  const sortert = [...rader].sort((a, b) => a.id - b.id);
  for (const rad of sortert) {
    const epost = normaliserEpost(rad.epost ?? "");
    if (!erGyldigEpost(epost) || blokkert.has(epost)) continue;
    if (rad.samtykke_tekst_versjon !== HISTORISK_VERSJON) continue;
    if (rad.bekreftet_at || rad.avmeldt_at || rad.bekreftelse_sendt_at) continue;
    const finnes = grupper.get(epost);
    if (finnes) {
      finnes.ovrigeIder.push(rad.id);
      continue;
    }
    grupper.set(epost, {
      id: rad.id,
      epost,
      avmeldings_token: erUuid(rad.avmeldings_token) ? rad.avmeldings_token : null,
      bekreftelses_token: erUuid(rad.bekreftelses_token) ? rad.bekreftelses_token : null,
      ovrigeIder: [],
    });
  }
  return [...grupper.values()];
}

/** Klikk på bekreftelseslenken. Eksisterende samtykketidspunkt beholdes. */
export function feltVedBekreftelse(
  rad: { samtykke_gitt_at: string | null },
  naa: string,
): { bekreftet_at: string; avmeldt_at: null; samtykke_gitt_at: string } {
  return {
    bekreftet_at: naa,
    avmeldt_at: null,
    samtykke_gitt_at: rad.samtykke_gitt_at ?? naa,
  };
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
