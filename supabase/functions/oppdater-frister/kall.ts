// Klassifisering av kall i oppdater-frister. Ingen nettverk.
//
// Alarm-kolonnen er sann for status feil_* eller delvis. Fristjobben
// skriver jobb = oppdater-frister, så raden havner i
// kilde_alarmer_frister og ikke i innhentingens kilde_alarmer. Derfor:
// - alle kall feilet → feil_http / feil_auth / feil_timeout / feil_parse / feil_nett
// - minst 80 % feilet, men ikke alle → delvis («nesten alle»)
// - spredte feil under 80 % → http_feil, med HTTP-kode, uten alarm
// 403 er feil_auth. Den rapporteres. Den omgås ikke.

export const NESTEN_ALLE_ANDEL = 0.8;

export type KallType = "ok" | "http" | "auth" | "timeout" | "parse" | "nett";

export type KallUtfall = {
  ok: boolean;
  httpStatus: number | null;
  type: KallType;
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

export function utfallFeil(type: Exclude<KallType, "ok">, httpStatus: number | null): KallUtfall {
  return { ok: false, httpStatus, type };
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
  if (feil.length === 0) {
    return {
      status: oppdatert > 0 ? "ok_oppdatert" : "ok_ingen_oppdatering",
      httpStatus: kall.find((k) => k.httpStatus != null)?.httpStatus ?? null,
      feilmelding: null,
      alarm: false,
      forsok: kall.length,
      feilede: 0,
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
