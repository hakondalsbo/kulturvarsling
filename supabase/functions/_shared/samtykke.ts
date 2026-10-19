// Ren logikk for påmelding, avmelding og utsendelse. Ingen Deno- eller
// databasekall, slik at filen kan testes med Node.

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

/** Bare dokumentert, bekreftet og ikke-avmeldt. Én rad per adresse, laveste id. */
export function filtrerMottakere(rader: Pameldingsrad[]): Pameldingsrad[] {
  const sett = new Map<string, Pameldingsrad>();
  const sortert = [...rader].sort((a, b) => a.id - b.id);
  for (const rad of sortert) {
    if (!rad.samtykke_gitt_at || !rad.bekreftet_at || rad.avmeldt_at) continue;
    if (!erUuid(rad.avmeldings_token)) continue;
    const epost = normaliserEpost(rad.epost ?? "");
    if (!erGyldigEpost(epost)) continue;
    if (sett.has(epost)) continue;
    sett.set(epost, { ...rad, epost });
  }
  return [...sett.values()];
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

/** Suksess bare når skrivingen faktisk gikk gjennom. */
export function svarEtterSkriving(
  feil: string | null,
): { ok: true } | { ok: false; status: number; feil: string } {
  if (feil) return { ok: false, status: 500, feil };
  return { ok: true };
}

/** Tabeller som ikke slettes av CASCADE, fordi fremmednøkkelen setter NULL. */
export const SLETT_FØR_BRUKER = ["horingssvar", "feedback"] as const;
