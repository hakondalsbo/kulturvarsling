// Komitéhøringer fra data.stortinget.no. robots.txt tillater hele stien.
// Nattkjøringen kaller eksport/horinger og, for ukjente saker, inntil 10
// eksport/sak. Den kaller ikke eksport/horingsprogram (der ligger personnavn).
//
// Kall per kjøring: 1 liste (oktober–august) eller 2 i september (inneværende
// sesjon og sesjonen som starter 1. oktober), pluss 0–10 sak-oppslag.
// Pause 400 ms mellom kall etter det første. Feil stopper resten av løpet.
// Treff som allerede er vurdert, beholdes.
//
// hentHoringsprogram tåler HTTP 500 på ukjent id og kaster programpunkt-tekst.
// Den er ikke med i hentStortingetHoringer.

import {
  feilFraUnntak,
  lesTekstRespons,
  sesjonIdStemmer,
  uventetFormat,
  type AdapterUtfall,
  type HenteFeil,
} from "./kildehelse.ts";
import {
  erKulturRelevant,
  kildeNokkel,
  statusForSak,
  stortingsSesjoner,
} from "./logikk.ts";

export const HORING_PAUSE_MS = 400;
export const HORING_MAKS_SAKOPPSLAG = 10;
export const HORING_AVHOLDT_MS = 14 * 24 * 60 * 60 * 1000;
const STORTING_TIMEOUT_MS = 25_000;
const STORTING_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Kulturvarsling/1.0",
};

export const LINJE_DELTA = "Frist for å søke om å delta: ";
export const LINJE_INNSPILL = "Frist for skriftlig innspill: ";

const FALSK_KULTUR = /kontroll og kultur i utenrikstjenesten/i;
const KOMITE_I_TITTEL = /familie-\s*og\s*kulturkomit[eé]\w*/gi;
const SPRAK = /hovudspråk|hovedspråk|§\s*120\s*b|språkpolitikk|nasjonalspråk/i;
const BARNEVERN_FAMILIE = /barnevern|familievern|\bfamilie\b/i;
const AAPEN_STATUS = new Set([
  "planlagt",
  "planlagt med forbehold",
  "aktiv",
  "påbegynt",
  "pågår",
]);

const MAANED = [
  "januar", "februar", "mars", "april", "mai", "juni",
  "juli", "august", "september", "oktober", "november", "desember",
];

export type HoringType = "komite" | "kontroll";

export type HoringTid = { sted: string | null; tidspunkt: string | null };

export type HoringSideRad = {
  horing_id: number;
  komite_id: string | null;
  komite_navn: string | null;
  type: HoringType | null;
  skriftlig: boolean | null;
  horing_status: string | null;
  frist_delta: string | null;
  frist_innspill: string | null;
  tidspunkter: HoringTid[];
  sak_ider: number[];
};

export type HoringItem = {
  tittel: string;
  instans: string;
  kilde: string;
  frist: string | null;
  motedato: string | null;
  sammendrag_raa: string;
  kilde_id: string;
  niva: "nasjonalt";
  sted: "Stortinget";
  sakstype: "horing";
  forhåndsgodkjent: true;
  handling: "handling_mulig" | "bare_orientering";
  sakIder: number[];
  horing: HoringSideRad;
  publisert_dato: null;
};

export type KlassifisertHoring =
  | { slag: "med"; item: HoringItem }
  | { slag: "avlyst"; kilde: string; horing: HoringSideRad }
  | { slag: "hopp" }
  | { slag: "usikker"; sakIder: number[] };

type HentFn = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export function horingSideUrl(id: number): string {
  return `https://www.stortinget.no/no/Hva-skjer-pa-Stortinget/Horing/horing/?h=${id}`;
}

/** Inneværende sesjon. I september også sesjonen som starter 1. oktober. */
export function horingSesjoner(nå = Date.now()): string[] {
  const inne = stortingsSesjoner(nå)[0];
  const deler = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
  }).format(new Date(nå));
  const [årTekst, månedTekst] = deler.split("-");
  const måned = Number(månedTekst);
  if (måned !== 9) return [inne];
  const år = Number(årTekst);
  return [inne, `${år}-${år + 1}`];
}

export function forventetHoringKall(nå = Date.now()): {
  lister: number;
  sakOppslagMaks: number;
  program: 0;
  maks: number;
} {
  const lister = horingSesjoner(nå).length;
  return {
    lister,
    sakOppslagMaks: HORING_MAKS_SAKOPPSLAG,
    program: 0,
    maks: lister + HORING_MAKS_SAKOPPSLAG,
  };
}

export function horingTidspunkt(verdi: string | null | undefined): string | null {
  if (!verdi) return null;
  const s = verdi.trim();
  if (!s || s.startsWith("0001-") || s.includes("-62135596800000")) return null;
  const epoch = s.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);
  if (epoch) {
    const ms = Number(epoch[1]);
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1970) return null;
    return d.toISOString();
  }
  const medSone = s.match(
    /^(\d{4})-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/,
  );
  if (medSone) {
    if (Number(medSone[1]) < 1970) return null;
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  const naiv = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (naiv) {
    const år = Number(naiv[1]);
    if (år < 1970) return null;
    return osloVeggTilUtc(
      år,
      Number(naiv[2]),
      Number(naiv[3]),
      Number(naiv[4]),
      Number(naiv[5]),
      Number(naiv[6] ?? 0),
    );
  }
  return null;
}

export function osloKalenderdag(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function formatOslo(iso: string): string {
  const deler = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const les = (type: string) => deler.find((p) => p.type === type)?.value ?? "";
  const dag = String(Number(les("day")));
  const mnd = MAANED[Number(les("month")) - 1] ?? les("month");
  const time = les("hour").padStart(2, "0");
  const min = les("minute").padStart(2, "0");
  return `${dag}. ${mnd} ${les("year")} kl. ${time}.${min}`;
}

export function utenHoringKomiteNavn(tekst: string): string {
  return tekst.replace(KOMITE_I_TITTEL, " ");
}

export type KulturCtx = {
  komiteId?: string | null;
  sakTekster: string[];
  sakIder?: number[];
  kjenteSakIder?: ReadonlySet<number>;
  emneErKultur?: boolean | null;
};

/** Famkult-barnevern uten kulturord er ute, også når sak-id er kjent. */
export function skalViseHoring(v: KulturCtx): boolean {
  return kulturVurdering(v) === "inne";
}

function kulturVurdering(v: KulturCtx): "inne" | "ute" | "ukjent" {
  const tekst = v.sakTekster.join(" ");
  if (FALSK_KULTUR.test(tekst)) return "ute";
  const ren = utenHoringKomiteNavn(tekst);
  const sprak = SPRAK.test(ren);
  const kultur = erKulturRelevant(ren) || sprak;
  const budsjett = v.komiteId === "FAMKULT" && /statsbudsjett/i.test(ren);
  const barnevernFamilie = BARNEVERN_FAMILIE.test(ren);
  if (barnevernFamilie && !kultur && !budsjett) return "ute";
  if (kultur || budsjett) return "inne";
  const kjent = (v.sakIder ?? []).some((id) => v.kjenteSakIder?.has(id));
  if (kjent) return "inne";
  if (v.emneErKultur === true) return "inne";
  return "ukjent";
}

export function horingTypeTekst(type: unknown): HoringType | null {
  if (type === 1 || type === "1" || type === "komite") return "komite";
  if (type === 2 || type === "2" || type === "kontroll") return "kontroll";
  return null;
}

export function lesSkriftlig(verdi: unknown): boolean | null {
  if (verdi === true || verdi === "true") return true;
  if (verdi === false || verdi === "false") return false;
  return null;
}

export function handlingForHoring(
  type: HoringType | null,
  delta: string | null,
  innspill: string | null,
  nå: number,
): "handling_mulig" | "bare_orientering" {
  if (type === "kontroll") return "bare_orientering";
  const åpen = [delta, innspill].some((iso) => iso != null && Date.parse(iso) >= nå);
  return åpen ? "handling_mulig" : "bare_orientering";
}

export function nærmesteFristDato(
  delta: string | null,
  innspill: string | null,
  nå: number,
): string | null {
  const kandidater = [delta, innspill].filter((iso): iso is string => !!iso);
  if (!kandidater.length) return null;
  const åpne = kandidater
    .filter((iso) => Date.parse(iso) >= nå)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const valgt = åpne[0] ?? innspill ?? delta;
  return valgt ? osloKalenderdag(valgt) : null;
}

type Parsed = {
  id: number;
  komiteId: string | null;
  komiteNavn: string | null;
  type: HoringType | null;
  skriftlig: boolean | null;
  horingStatus: string | null;
  status: string | null;
  fristDelta: string | null;
  fristInnspill: string | null;
  tidspunkter: HoringTid[];
  sakIder: number[];
  sakTekster: string[];
  tittel: string;
  start: string | null;
};

export function klassifiserHoring(
  rå: unknown,
  ctx: { nå?: number; kjenteSakIder?: ReadonlySet<number>; emneErKultur?: boolean | null } = {},
): KlassifisertHoring {
  const parsed = lesHoring(rå);
  if (!parsed) return { slag: "hopp" };
  const nå = ctx.nå ?? Date.now();
  if (erAvlyst(parsed)) {
    return { slag: "avlyst", kilde: horingSideUrl(parsed.id), horing: sideFraParsed(parsed) };
  }
  if (!iVindu(parsed, nå) || !parsed.tittel) return { slag: "hopp" };
  const vurdering = kulturVurdering({
    komiteId: parsed.komiteId,
    sakTekster: parsed.sakTekster,
    sakIder: parsed.sakIder,
    kjenteSakIder: ctx.kjenteSakIder,
    emneErKultur: ctx.emneErKultur,
  });
  if (vurdering === "ute") return { slag: "hopp" };
  if (vurdering === "inne") return { slag: "med", item: tilItem(parsed, nå) };
  if (parsed.sakIder.length && ctx.emneErKultur == null) {
    return { slag: "usikker", sakIder: parsed.sakIder };
  }
  return { slag: "hopp" };
}

export function stortingSakIdFraUrl(kilde: string | null | undefined): string | null {
  if (!kilde) return null;
  const m = kilde.match(/[?&]p=(\d+)/i);
  return m?.[1] ?? null;
}

function erSakKart(
  saker: ReadonlyMap<string, string> | ReadonlyArray<{ stortingSakId: string; varselId: string }>,
): saker is ReadonlyMap<string, string> {
  return !Array.isArray(saker);
}

export function hovedsakForHoring(
  sakIder: ReadonlyArray<number> | null | undefined,
  saker: ReadonlyMap<string, string> | ReadonlyArray<{ stortingSakId: string; varselId: string }>,
): string | null {
  const map: ReadonlyMap<string, string> = erSakKart(saker)
    ? saker
    : new Map(saker.map((s) => [s.stortingSakId, s.varselId]));
  for (const id of sakIder ?? []) {
    const treff = map.get(String(id));
    if (treff) return treff;
  }
  return null;
}

export function planleggHoringLagring(inn: {
  items: Array<{
    kilde?: string | null;
    frist?: string | null;
    motedato?: string | null;
    handling?: string | null;
    sammendrag_raa?: string | null;
    sakIder?: number[] | null;
    horing?: HoringSideRad | null;
  }>;
  avlyste?: ReadonlyArray<{ kilde: string; horing: Record<string, unknown> }>;
  eksisterende: Array<{ id?: string | null; kilde?: string | null; manuelt_redigert?: boolean | null }>;
  nyeIder: Array<{ kilde: string; id: string }>;
  saker: Array<{ stortingSakId: string; varselId: string }>;
  nå?: number;
}): {
  varselOppdateringer: Array<{ id: string; felt: Record<string, unknown> }>;
  siderader: Array<Record<string, unknown>>;
  avlystTilRedaktor: Array<{ horing_id: number; horing_status: string | null; varsel_id: string }>;
} {
  const nå = inn.nå ?? Date.now();
  const sist = new Date(nå).toISOString();
  const kjente = new Map<string, { id: string; manuell: boolean }>();
  for (const rad of inn.eksisterende) {
    const n = kildeNokkel(rad.kilde ?? null);
    if (!n || !rad.id) continue;
    kjente.set(n, { id: rad.id, manuell: rad.manuelt_redigert === true });
  }
  for (const ny of inn.nyeIder) {
    const n = kildeNokkel(ny.kilde) ?? ny.kilde;
    const gammel = kjente.get(n);
    kjente.set(n, { id: ny.id, manuell: gammel?.manuell === true });
  }
  const sakMap = new Map(inn.saker.map((s) => [s.stortingSakId, s.varselId]));
  const varselOppdateringer: Array<{ id: string; felt: Record<string, unknown> }> = [];
  const siderader: Array<Record<string, unknown>> = [];
  const avlystTilRedaktor: Array<{ horing_id: number; horing_status: string | null; varsel_id: string }> = [];

  for (const item of inn.items) {
    if (!item.horing || typeof item.horing.horing_id !== "number") continue;
    const n = kildeNokkel(item.kilde ?? null);
    const treff = n ? kjente.get(n) : undefined;
    if (!treff) continue;
    siderader.push(sideTilRad(item.horing, treff.id, sist));
    if (treff.manuell) continue;
    const handling = item.handling === "handling_mulig" || item.handling === "bare_orientering"
      ? item.handling
      : null;
    const felt: Record<string, unknown> = {
      frist: item.frist ?? null,
      motedato: item.motedato ?? null,
      status: statusForSak(item.frist, item.motedato, nå),
    };
    if (handling) felt.handling = handling;
    if (typeof item.sammendrag_raa === "string" && item.sammendrag_raa) {
      felt.sammendrag = item.sammendrag_raa;
    }
    const hoved = hovedsakForHoring(item.sakIder, sakMap);
    if (hoved) felt.hovedsak_id = hoved;
    varselOppdateringer.push({ id: treff.id, felt });
  }

  for (const avlyst of inn.avlyste ?? []) {
    const n = kildeNokkel(avlyst.kilde);
    const treff = n ? kjente.get(n) : undefined;
    if (!treff) continue;
    const horing = avlyst.horing;
    const horingId = typeof horing.horing_id === "number" ? horing.horing_id : null;
    if (horingId == null) continue;
    siderader.push({
      ...horing,
      horing_status: typeof horing.horing_status === "string" ? horing.horing_status : "Avlyst",
      varsel_id: treff.id,
      sist_sett: sist,
    });
    avlystTilRedaktor.push({
      horing_id: horingId,
      horing_status: typeof horing.horing_status === "string" ? horing.horing_status : "Avlyst",
      varsel_id: treff.id,
    });
  }

  return { varselOppdateringer, siderader, avlystTilRedaktor };
}

/**
 * Programmet inneholder navn. Vi tar bare sted og tid, og ukjent id (HTTP 500)
 * er ikke et krasj. Nattkjøringen bruker ikke denne funksjonen.
 */
export async function hentHoringsprogram(
  horingId: number,
  hent: HentFn = fetch,
): Promise<
  | { ok: true; horingId: number; tidspunkter: HoringTid[] }
  | { ok: false; ukjent: boolean; status: number | null }
> {
  const url =
    `https://data.stortinget.no/eksport/horingsprogram?horingid=${encodeURIComponent(String(horingId))}&format=json`;
  try {
    const res = await hent(url, {
      headers: STORTING_HEADERS,
      signal: AbortSignal.timeout(STORTING_TIMEOUT_MS),
    });
    if (res.status === 500) return { ok: false, ukjent: true, status: 500 };
    if (!res.ok) return { ok: false, ukjent: false, status: res.status };
    const data = JSON.parse(await res.text()) as { horingsprogram_liste?: unknown };
    const liste = somListe(data?.horingsprogram_liste);
    const tidspunkter = liste.map((p) => ({
      sted: typeof p?.sted === "string" ? p.sted : null,
      tidspunkt: horingTidspunkt(typeof p?.dato === "string" ? p.dato : null),
    }));
    return { ok: true, horingId, tidspunkter };
  } catch {
    return { ok: false, ukjent: false, status: null };
  }
}

export async function hentStortingetHoringer(opts: {
  hent?: HentFn;
  pause?: (ms: number) => Promise<void>;
  nå?: number;
  kjenteSakIder?: Iterable<number>;
} = {}): Promise<AdapterUtfall> {
  const hent = opts.hent ?? fetch;
  const pause = opts.pause ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const nå = opts.nå ?? Date.now();
  const kjente = new Set(opts.kjenteSakIder ?? []);
  const sesjoner = horingSesjoner(nå);
  let raatt = 0;
  let forsok = 0;
  let vellykket = 0;
  let httpStatus: number | null = null;
  const feil: HenteFeil[] = [];
  const råHoringer: unknown[] = [];
  const settId = new Set<number>();
  let stopp = false;

  for (let i = 0; i < sesjoner.length && !stopp; i++) {
    if (i > 0) await pause(HORING_PAUSE_MS);
    const sesjon = sesjoner[i];
    const url =
      `https://data.stortinget.no/eksport/horinger?sesjonid=${encodeURIComponent(sesjon)}&format=json`;
    forsok++;
    let res: { ok: boolean; status: number; text: () => Promise<string> };
    try {
      res = await hent(url, {
        headers: STORTING_HEADERS,
        signal: AbortSignal.timeout(STORTING_TIMEOUT_MS),
      });
    } catch (e) {
      feil.push(feilFraUnntak(e, url));
      stopp = true;
      break;
    }
    const lest = await lesTekstRespons(res, url);
    if ("feil" in lest) {
      feil.push(lest.feil);
      stopp = true;
      break;
    }
    if (lest.tekst.trimStart().startsWith("<")) {
      feil.push(uventetFormat(url, "XML i stedet for JSON"));
      stopp = true;
      break;
    }
    let data: unknown;
    try {
      data = JSON.parse(lest.tekst);
    } catch (e) {
      feil.push(feilFraUnntak(e, url));
      stopp = true;
      break;
    }
    if (!sesjonIdStemmer(data, sesjon)) {
      feil.push(uventetFormat(url, "sesjon_id stemmer ikke"));
      stopp = true;
      break;
    }
    const liste = lesHoringerListe(data);
    if ("feil" in liste) {
      feil.push(uventetFormat(url, liste.feil));
      stopp = true;
      break;
    }
    vellykket++;
    httpStatus = res.status;
    raatt += liste.horinger.length;
    for (const rå of liste.horinger) {
      const id = typeof (rå as { id?: unknown })?.id === "number" ? (rå as { id: number }).id : null;
      if (id != null && settId.has(id)) continue;
      if (id != null) settId.add(id);
      råHoringer.push(rå);
    }
  }

  if (stopp && vellykket === 0) return tomt(raatt, feil, forsok, vellykket);

  const items: HoringItem[] = [];
  const avlysteHoringer: Array<{ kilde: string; horing: Record<string, unknown> }> = [];
  const usikre: Array<{ sakIder: number[]; rå: unknown }> = [];
  for (const rå of råHoringer) {
    const klass = klassifiserHoring(rå, { nå, kjenteSakIder: kjente });
    if (klass.slag === "med") items.push(klass.item);
    else if (klass.slag === "avlyst") {
      avlysteHoringer.push({ kilde: klass.kilde, horing: klass.horing });
    } else if (klass.slag === "usikker") usikre.push({ sakIder: klass.sakIder, rå });
  }

  if (stopp) {
    return {
      items,
      raattAntall: raatt,
      antallEtterFilter: items.length,
      feil,
      forsok,
      vellykket,
      httpStatus: feil[0]?.httpStatus ?? httpStatus,
      avlysteHoringer,
    };
  }

  usikre.sort((a, b) => {
    const aFam = komiteId(a.rå) === "FAMKULT" ? 1 : 0;
    const bFam = komiteId(b.rå) === "FAMKULT" ? 1 : 0;
    return aFam - bFam;
  });
  const oppslag: number[] = [];
  const settSak = new Set<number>();
  for (const u of usikre) {
    for (const id of u.sakIder) {
      if (settSak.has(id) || oppslag.length >= HORING_MAKS_SAKOPPSLAG) continue;
      settSak.add(id);
      oppslag.push(id);
    }
  }
  const emne = new Map<number, boolean>();
  const leggTilEtterEmne = () => {
    for (const u of usikre) {
      const sett = u.sakIder.some((id) => emne.has(id));
      if (!sett) continue;
      const kultur = u.sakIder.some((id) => emne.get(id) === true);
      const klass = klassifiserHoring(u.rå, { nå, kjenteSakIder: kjente, emneErKultur: kultur });
      if (klass.slag === "med") items.push(klass.item);
    }
  };
  for (const sakId of oppslag) {
    await pause(HORING_PAUSE_MS);
    const url =
      `https://data.stortinget.no/eksport/sak?sakid=${encodeURIComponent(String(sakId))}&format=json`;
    forsok++;
    try {
      const res = await hent(url, {
        headers: STORTING_HEADERS,
        signal: AbortSignal.timeout(STORTING_TIMEOUT_MS),
      });
      const lest = await lesTekstRespons(res, url);
      if ("feil" in lest) {
        feil.push(lest.feil);
        leggTilEtterEmne();
        return {
          items,
          raattAntall: raatt,
          antallEtterFilter: items.length,
          feil,
          forsok,
          vellykket,
          httpStatus: lest.feil.httpStatus ?? httpStatus,
          avlysteHoringer,
        };
      }
      const data = JSON.parse(lest.tekst) as unknown;
      emne.set(sakId, sakHarKulturEmne(data));
      vellykket++;
    } catch (e) {
      feil.push(feilFraUnntak(e, url));
      leggTilEtterEmne();
      return {
        items,
        raattAntall: raatt,
        antallEtterFilter: items.length,
        feil,
        forsok,
        vellykket,
        httpStatus,
        avlysteHoringer,
      };
    }
  }

  leggTilEtterEmne();

  return {
    items,
    raattAntall: raatt,
    antallEtterFilter: items.length,
    feil,
    forsok,
    vellykket,
    httpStatus,
    avlysteHoringer,
  };
}

function tomt(raatt: number, feil: HenteFeil[], forsok: number, vellykket: number): AdapterUtfall {
  return {
    items: [],
    raattAntall: raatt,
    antallEtterFilter: 0,
    feil,
    forsok,
    vellykket,
    httpStatus: feil[0]?.httpStatus ?? null,
    avlysteHoringer: [],
  };
}

function lesHoringerListe(data: unknown): { horinger: unknown[] } | { feil: string } {
  if (!data || typeof data !== "object") return { feil: "mangler rot-objekt" };
  const liste = (data as { horinger_liste?: unknown }).horinger_liste;
  if (Array.isArray(liste)) return { horinger: liste };
  return { feil: "mangler horinger_liste" };
}

function sakHarKulturEmne(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const rot = data as { emne_liste?: unknown; sak?: { emne_liste?: unknown } };
  const rå = rot.emne_liste ?? rot.sak?.emne_liste;
  const emner = Array.isArray(rå)
    ? rå
    : rå && typeof rå === "object" && Array.isArray((rå as { emne?: unknown }).emne)
      ? (rå as { emne: unknown[] }).emne
      : [];
  return emner.some((e) => {
    const emne = e as { id?: unknown; navn?: unknown };
    return emne?.id === 6 || (typeof emne?.navn === "string" && /^kultur$/i.test(emne.navn));
  });
}

function komiteId(rå: unknown): string | null {
  const id = (rå as { komite?: { id?: unknown } })?.komite?.id;
  return typeof id === "string" ? id : null;
}

function somListe(verdi: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(verdi)) return verdi.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>;
  if (verdi && typeof verdi === "object") return [verdi as Record<string, unknown>];
  return [];
}

function lesHoring(rå: unknown): Parsed | null {
  if (!rå || typeof rå !== "object") return null;
  const h = rå as Record<string, unknown>;
  const id = typeof h.id === "number" ? h.id : Number(h.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const komite = h.komite && typeof h.komite === "object" ? h.komite as { id?: unknown; navn?: unknown } : {};
  const saker = somListe(h.horing_sak_info_liste);
  const sakTekster = saker.map((s) =>
    [s.sak_korttittel, s.sak_tittel, s.sak_henvisning].filter((x) => typeof x === "string").join(" ")
  );
  const titler = saker
    .map((s) => (typeof s.sak_korttittel === "string" && s.sak_korttittel.trim())
      || (typeof s.sak_tittel === "string" && s.sak_tittel.trim())
      || "")
    .filter(Boolean);
  const sakIder = saker
    .map((s) => typeof s.sak_id === "number" ? s.sak_id : Number(s.sak_id))
    .filter((n) => Number.isInteger(n) && n > 0);
  return {
    id,
    komiteId: typeof komite.id === "string" ? komite.id : null,
    komiteNavn: typeof komite.navn === "string" ? komite.navn : null,
    type: horingTypeTekst(h.type),
    skriftlig: lesSkriftlig(h.skriftlig),
    horingStatus: typeof h.horing_status === "string" ? h.horing_status : null,
    status: h.status == null ? null : String(h.status),
    fristDelta: horingTidspunkt(typeof h.anmodningsfrist_dato_tid === "string" ? h.anmodningsfrist_dato_tid : null),
    fristInnspill: horingTidspunkt(typeof h.innspillsfrist === "string" ? h.innspillsfrist : null),
    tidspunkter: somListe(h.horingstidspunkt_liste).map((t) => ({
      sted: typeof t.sted === "string" ? t.sted : null,
      tidspunkt: horingTidspunkt(typeof t.tidspunkt === "string" ? t.tidspunkt : null),
    })),
    sakIder,
    sakTekster,
    tittel: titler.join("; ").slice(0, 300),
    start: horingTidspunkt(typeof h.start_dato === "string" ? h.start_dato : null),
  };
}

function erAvlyst(p: Parsed): boolean {
  return (p.status ?? "").toLowerCase() === "avlyst" || (p.horingStatus ?? "").toLowerCase() === "avlyst";
}

function iVindu(p: Parsed, nå: number): boolean {
  const status = (p.horingStatus ?? "").trim().toLowerCase();
  if (AAPEN_STATUS.has(status)) return true;
  if (status !== "avholdt") return false;
  const siste = seneste(p);
  if (!siste) return false;
  return Date.parse(siste) > nå - HORING_AVHOLDT_MS;
}

function seneste(p: Parsed): string | null {
  const tider = [
    p.fristDelta,
    p.fristInnspill,
    p.start,
    ...p.tidspunkter.map((t) => t.tidspunkt),
  ].filter((iso): iso is string => !!iso);
  if (!tider.length) return null;
  return tider.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

function sideFraParsed(p: Parsed): HoringSideRad {
  return {
    horing_id: p.id,
    komite_id: p.komiteId,
    komite_navn: p.komiteNavn,
    type: p.type,
    skriftlig: p.skriftlig,
    horing_status: p.horingStatus,
    frist_delta: p.fristDelta,
    frist_innspill: p.fristInnspill,
    tidspunkter: p.tidspunkter,
    sak_ider: p.sakIder,
  };
}

function tilItem(p: Parsed, nå: number): HoringItem {
  const motedato = p.skriftlig === true
    ? null
    : førsteMote(p.tidspunkter);
  const linjer = [
    p.skriftlig === true ? "Skriftlig høring." : p.skriftlig === false ? "Muntlig høring." : "Høring.",
  ];
  if (p.komiteNavn) linjer.push(`${p.komiteNavn}.`);
  if (p.fristDelta) linjer.push(`${LINJE_DELTA}${formatOslo(p.fristDelta)}.`);
  if (p.fristInnspill) linjer.push(`${LINJE_INNSPILL}${formatOslo(p.fristInnspill)}.`);
  if (p.skriftlig !== true) {
    for (const t of p.tidspunkter) {
      if (!t.tidspunkt) continue;
      if ((t.sted ?? "").trim().toLowerCase() === "skriftlig") continue;
      const sted = t.sted ? `, ${t.sted}` : "";
      linjer.push(`Tidspunkt: ${formatOslo(t.tidspunkt)}${sted}.`);
    }
  }
  return {
    tittel: `Høring: ${p.tittel}`,
    instans: p.komiteNavn ? `${p.komiteNavn}, Stortinget` : "Stortinget",
    kilde: horingSideUrl(p.id),
    frist: nærmesteFristDato(p.fristDelta, p.fristInnspill, nå),
    motedato,
    sammendrag_raa: linjer.join("\n"),
    kilde_id: `stortinget-horing-${p.id}`,
    niva: "nasjonalt",
    sted: "Stortinget",
    sakstype: "horing",
    forhåndsgodkjent: true,
    handling: handlingForHoring(p.type, p.fristDelta, p.fristInnspill, nå),
    sakIder: p.sakIder,
    horing: sideFraParsed(p),
    publisert_dato: null,
  };
}

function førsteMote(tidspunkter: HoringTid[]): string | null {
  for (const t of tidspunkter) {
    if (!t.tidspunkt) continue;
    if ((t.sted ?? "").trim().toLowerCase() === "skriftlig") continue;
    return osloKalenderdag(t.tidspunkt);
  }
  return null;
}

function sideTilRad(h: HoringSideRad, varselId: string, sist: string): Record<string, unknown> {
  return {
    horing_id: h.horing_id,
    varsel_id: varselId,
    komite_id: h.komite_id,
    komite_navn: h.komite_navn,
    type: h.type,
    skriftlig: h.skriftlig,
    horing_status: h.horing_status,
    frist_delta: h.frist_delta,
    frist_innspill: h.frist_innspill,
    tidspunkter: h.tidspunkter,
    sak_ider: h.sak_ider,
    sist_sett: sist,
  };
}

function osloOffsetMinutter(ms: number): number {
  const del = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Oslo",
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(ms));
  const navn = del.find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = navn.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 60;
  const fortegn = m[1] === "-" ? -1 : 1;
  return fortegn * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

function osloVeggTilUtc(
  år: number,
  mnd: number,
  dag: number,
  time: number,
  min: number,
  sek: number,
): string | null {
  let ms = Date.UTC(år, mnd - 1, dag, time, min, sek);
  for (let i = 0; i < 2; i++) {
    ms = Date.UTC(år, mnd - 1, dag, time, min, sek) - osloOffsetMinutter(ms) * 60_000;
  }
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
