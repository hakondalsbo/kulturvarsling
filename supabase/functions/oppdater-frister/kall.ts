// Klassifisering av kall i oppdater-frister. Ingen nettverk.
//
// Alarm-kolonnen er sann for status feil_* eller delvis. Fristjobben
// skriver jobb = oppdater-frister, så raden havner i
// kilde_alarmer_frister og ikke i innhentingens kilde_alarmer. Derfor:
// - alle kall feilet → feil_http / feil_auth / feil_timeout / feil_parse / feil_nett
// - minst 80 % feilet, men ikke alle → delvis («nesten alle»)
// - spredte feil under 80 % → http_feil, med HTTP-kode, uten alarm
// - enkeltstående 404/500 på én sak (omfang "sak") logges i feilmelding
//   og gjør ikke raden til http_feil, så lenge andelen er under 80 %.
//   Alle kall eller minst 80 % feil er fortsatt kildefeil med alarm.
// 403 er feil_auth. Den rapporteres. Den omgås ikke.

export const NESTEN_ALLE_ANDEL = 0.8;

export type KallType = "ok" | "http" | "auth" | "timeout" | "parse" | "nett";

export type KallUtfall = {
  ok: boolean;
  httpStatus: number | null;
  type: KallType;
  /** "sak" er ett dokument. Listekall er kilde. */
  omfang?: "sak" | "kilde";
};

export type KildeKallResultat = {
  status: string;
  httpStatus: number | null;
  feilmelding: string | null;
  alarm: boolean;
  forsok: number;
  feilede: number;
  vellykket: number;
  /** Rader som fikk ny frist eller møtedato. Aldri nye varsler. */
  oppdatert: number;
};

export function utfallOk(httpStatus: number | null): KallUtfall {
  return { ok: true, httpStatus, type: "ok" };
}

export function utfallFeil(
  type: Exclude<KallType, "ok">,
  httpStatus: number | null,
  omfang?: "sak" | "kilde",
): KallUtfall {
  return { ok: false, httpStatus, type, omfang };
}

/** 404/500 på ett dokument. Kilden kan fortsatt være oppe. */
export function erEnkeltsakHttp(k: KallUtfall): boolean {
  return !k.ok
    && k.omfang === "sak"
    && (k.httpStatus === 404 || k.httpStatus === 500);
}

/**
 * Ny dato som faktisk skiller seg fra den lagrede. Samme dag skrives ikke,
 * og da settes heller ikke endringstidspunktet.
 */
export function planleggDatoSkriving(
  har: string | null | undefined,
  ny: string | null | undefined,
  naa: string,
): { verdi: string; oppdatert: string } | null {
  const neste = String(ny ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(neste)) return null;
  const gammel = har ? String(har).slice(0, 10) : null;
  if (gammel === neste) return null;
  return { verdi: neste, oppdatert: naa };
}

/** Tomt svar fra update er ikke en endring. Feil er ikke en endring. */
export function tolkSkriving(
  error: { message: string } | null,
  rader: unknown[] | null | undefined,
): { feil: string | null; antall: number } {
  if (error) return { feil: error.message, antall: 0 };
  return { feil: null, antall: Array.isArray(rader) ? rader.length : 0 };
}

function dominerende<T>(verdier: T[]): T | null {
  if (verdier.length === 0) return null;
  const tell = new Map<T, number>();
  for (const verdi of verdier) tell.set(verdi, (tell.get(verdi) ?? 0) + 1);
  let best = verdier[0];
  let flest = 0;
  for (const [verdi, antall] of tell) {
    if (antall > flest) {
      best = verdi;
      flest = antall;
    }
  }
  return best;
}

function statusFraType(type: KallType): string {
  if (type === "auth") return "feil_auth";
  if (type === "timeout") return "feil_timeout";
  if (type === "parse") return "feil_parse";
  if (type === "nett") return "feil_nett";
  return "feil_http";
}

function alarmFraStatus(status: string): boolean {
  return status.startsWith("feil_") || status === "delvis";
}

/** Tom liste betyr at kilden ikke ble kalt. Da skrives ingen rad. */
export function klassifiserKildeKall(
  kall: KallUtfall[],
  oppdatert = 0,
): KildeKallResultat | null {
  if (kall.length === 0) return null;
  const feil = kall.filter((k) => !k.ok);
  const vellykket = kall.length - feil.length;
  const sakIsolert = feil.length > 0
    && feil.every(erEnkeltsakHttp)
    && feil.length / kall.length < NESTEN_ALLE_ANDEL;
  if (feil.length === 0 || sakIsolert) {
    const sakHttp = dominerende(
      feil.map((k) => k.httpStatus).filter((s): s is number => s != null),
    );
    return {
      status: oppdatert > 0 ? "ok_oppdatert" : "ok_ingen_oppdatering",
      httpStatus: kall.find((k) => k.ok && k.httpStatus != null)?.httpStatus ?? sakHttp,
      feilmelding: sakIsolert
        ? `${feil.length} av ${kall.length} enkeltsaker svarte HTTP ${sakHttp ?? "feil"} og er logget per sak`
        : null,
      alarm: false,
      forsok: kall.length,
      feilede: feil.length,
      vellykket,
      oppdatert,
    };
  }
  const httpStatus = dominerende(
    feil.map((k) => k.httpStatus).filter((s): s is number => s != null),
  );
  const type = dominerende(feil.map((k) => k.type)) ?? "http";
  const httpTekst = httpStatus != null ? `HTTP ${httpStatus}` : null;
  const alle = feil.length === kall.length;
  const nestenAlle = !alle && feil.length / kall.length >= NESTEN_ALLE_ANDEL;
  const feilmelding = alle
    ? `${httpTekst ?? (type === "timeout" ? "Tidsavbrudd" : "Innhentingen feilet")} (${feil.length} av ${kall.length} kall)`
    : `${feil.length} av ${kall.length} kall feilet${httpTekst ? `; ${httpTekst}` : ""}`;
  const status = alle ? statusFraType(type) : nestenAlle ? "delvis" : "http_feil";
  return {
    status,
    httpStatus,
    feilmelding,
    alarm: alarmFraStatus(status),
    forsok: kall.length,
    feilede: feil.length,
    vellykket,
    oppdatert,
  };
}

export function harKildeAlarm(rader: Array<{ alarm: boolean }>): boolean {
  return rader.some((rad) => rad.alarm);
}
