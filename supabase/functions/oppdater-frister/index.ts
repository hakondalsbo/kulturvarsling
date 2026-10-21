// Lett daglig jobb: oppdater HOERFRIST fra Stortinget, høringsfrist fra
// Regjeringen og Sametinget, og møtedato fra eInnsyn/Bergen. Kjører via
// pg_cron (oppdater-frister-daglig), ikke via Vercel Cron. Feil i ett
// oppslag stopper ikke de andre. Skriver frist, motedato og status.
// Aldri tittel, sammendrag eller kategori. Rader med manuelt_redigert
// får ikke frist, møtedato eller status, heller ikke når feltet er tomt.
// 80653f79, 1cf0dfd3, de0dc5a6, b70f9ea5 og 90a26730 er stengt selv om
// flagget skulle mangle.
//
// Kall som feiler logges i kilde_kjoringer med jobb oppdater-frister,
// feilstatus og HTTP-kode. 403 rapporteres som feil_auth. User-Agent er
// Kulturvarsling/1.0 og byttes ikke, og det brukes ingen proxy.
// Alarm vises i kilde_alarmer_frister, ikke i kilde_alarmer, og
// kilder.sist_status røres ikke. Det er innhentingens status.

import { byggKildeKjoringRad } from "../hent-saker/datofilter.ts";
import {
  feilFraUnntak,
  lesTekstRespons,
  tidligAvslag,
  utledKjoertAv,
  uventetFormat,
  type HenteFeil,
  type KjoertAv,
} from "../hent-saker/kildehelse.ts";
import { finnHøringsfrist, kalenderdag } from "../hent-saker/logikk.ts";
import {
  addIsoDager,
  erRegjeringsHoring,
  MAKS_LISTE_SIDER,
  MAKS_REGJERING_DETALJ,
  MAKS_STORTING_OPPSLAG,
  parseRegjeringenHoringListe,
  parseRegjeringenHoringSide,
  bergenMoteOgSak,
  einnsynMoetesakId,
  erSametingetHoring,
  MAKS_MOTEOPPSLAG,
  MAKS_SAMETING,
  prioriterStorting,
  REGJERINGEN_HORING_LISTE,
  regjeringenInnholdId,
  regjeringenSideUrl,
  skalOppdatereStortingFrist,
  stortingSakId,
  trekkHoringsfrist,
} from "../hent-saker/frister.ts";
import { REDAKTOR_FELT_LAAS, skalSkriveFrist, skalSkriveMotedato } from "../_shared/varselvern.ts";
import {
  harKildeAlarm,
  klassifiserKildeKall,
  utfallFeil,
  utfallOk,
  type KallUtfall,
} from "./kall.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

const TIMEOUT_MS = 20_000;

function jsonSvar(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Rad = {
  id: string;
  kilde: string | null;
  instans: string | null;
  tittel: string | null;
  frist: string | null;
  motedato: string | null;
  manuelt_redigert: boolean | null;
};

type Lest = { tekst: string; httpStatus: number } | { feil: HenteFeil };

const REDAKTOR_ID_FILTER = `(${REDAKTOR_FELT_LAAS.join(",")})`;

async function hentTekst(url: string): Promise<Lest> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "text/html,application/json", "User-Agent": "Kulturvarsling/1.0" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const lest = await lesTekstRespons(res, url);
    if ("feil" in lest) return { feil: lest.feil };
    return { tekst: lest.tekst, httpStatus: res.status };
  } catch (e) {
    return { feil: feilFraUnntak(e, url) };
  }
}

function somUtfall(lest: Lest): KallUtfall {
  if ("feil" in lest) return utfallFeil(lest.feil.type, lest.feil.httpStatus);
  return utfallOk(lest.httpStatus);
}

async function hentStortingFrist(
  sakId: string,
): Promise<{ frist: string | null; feil: HenteFeil | null; httpStatus: number | null }> {
  const url = `https://data.stortinget.no/eksport/sak?sakid=${encodeURIComponent(sakId)}&format=json`;
  const lest = await hentTekst(url);
  if ("feil" in lest) return { frist: null, feil: lest.feil, httpStatus: lest.feil.httpStatus };
  try {
    return { frist: finnHøringsfrist(JSON.parse(lest.tekst)), feil: null, httpStatus: lest.httpStatus };
  } catch {
    const feil = uventetFormat(url, "JSON");
    return { frist: null, feil, httpStatus: feil.httpStatus };
  }
}

async function oppdaterFrist(
  supabase: { from: (t: string) => any },
  id: string,
  frist: string,
): Promise<string | null> {
  const { error } = await supabase.from("varsler").update({ frist }).eq("id", id).eq("manuelt_redigert", false);
  return error ? error.message : null;
}

async function oppdaterMotedato(
  supabase: { from: (t: string) => any },
  id: string,
  motedato: string,
): Promise<string | null> {
  const { error } = await supabase.from("varsler").update({ motedato }).eq("id", id).eq("manuelt_redigert", false);
  return error ? error.message : null;
}

function isoDato(verdi: unknown): string | null {
  const iso = String(verdi ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

async function hentEinnsynMotedato(sakId: string): Promise<{ dato: string | null; kall: KallUtfall[] }> {
  const kall: KallUtfall[] = [];
  const sakUrl = `https://api.einnsyn.no/moetesak/${encodeURIComponent(sakId)}`;
  const sak = await hentTekst(sakUrl);
  if ("feil" in sak) {
    kall.push(somUtfall(sak));
    return { dato: null, kall };
  }
  let mappe = "";
  try {
    mappe = String(JSON.parse(sak.tekst)?.moetemappe ?? "");
  } catch {
    kall.push(utfallFeil("parse", sak.httpStatus));
    return { dato: null, kall };
  }
  kall.push(utfallOk(sak.httpStatus));
  if (!mappe) return { dato: null, kall };
  const m = await hentTekst(`https://api.einnsyn.no/moetemappe/${encodeURIComponent(mappe)}`);
  if ("feil" in m) {
    kall.push(somUtfall(m));
    return { dato: null, kall };
  }
  try {
    return { dato: isoDato(JSON.parse(m.tekst)?.moetedato), kall: [...kall, utfallOk(m.httpStatus)] };
  } catch {
    kall.push(utfallFeil("parse", m.httpStatus));
    return { dato: null, kall };
  }
}

async function hentBergenDatoer(): Promise<{ datoer: Map<string, string>; utfall: KallUtfall }> {
  const ut = new Map<string, string>();
  const år = new Date().getFullYear();
  const lest = await hentTekst(
    `https://www.bergen.kommune.no/politikere-utvalg/api/agendapunkter?tittel=kultur&year=${år}&rows=150`,
  );
  if ("feil" in lest) return { datoer: ut, utfall: somUtfall(lest) };
  try {
    const data = JSON.parse(lest.tekst);
    const liste = Array.isArray(data) ? data : (data.items ?? data.agendapunkter ?? []);
    if (!Array.isArray(liste)) return { datoer: ut, utfall: utfallFeil("parse", lest.httpStatus) };
    for (const punkt of liste) {
      const iso = isoDato(punkt?.moteDato);
      if (punkt?.moteId && punkt?.kildeId && iso) ut.set(`${punkt.moteId}/${punkt.kildeId}`, iso);
    }
    return { datoer: ut, utfall: utfallOk(lest.httpStatus) };
  } catch {
    return { datoer: ut, utfall: utfallFeil("parse", lest.httpStatus) };
  }
}

/** Frist vinner over møtedato. Uten begge blir status normal, aldri kritisk. Redaktørstatus blir stående. */
async function merkFristStatus(
  supabase: { from: (t: string) => any },
  idag: string,
): Promise<Record<string, number>> {
  const om7 = addIsoDager(idag, 7);
  const om21 = addIsoDager(idag, 21);
  const tell = async (sporring: any) => {
    const { data, error } = await sporring.select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).length as number;
  };
  const statusOp = (status: string) =>
    supabase.from("varsler").update({ status })
      .eq("manuelt_redigert", false)
      .not("id", "in", REDAKTOR_ID_FILTER)
      .neq("status", status);
  const fraFrist = (status: string, smal: (q: any) => any) =>
    tell(smal(statusOp(status).not("frist", "is", null)));
  const fraMote = (status: string, smal: (q: any) => any) =>
    tell(smal(statusOp(status).is("frist", null).not("motedato", "is", null)));
  const utenDato = await tell(
    statusOp("normal").is("frist", null).is("motedato", null),
  );
  return {
    passert: await fraFrist("passert", (q) => q.lt("frist", idag))
      + await fraMote("passert", (q) => q.lt("motedato", idag)),
    kritisk: await fraFrist("kritisk", (q) => q.gte("frist", idag).lte("frist", om7))
      + await fraMote("kritisk", (q) => q.gte("motedato", idag).lte("motedato", om7)),
    viktig: await fraFrist("viktig", (q) => q.gt("frist", om7).lte("frist", om21))
      + await fraMote("viktig", (q) => q.gt("motedato", om7).lte("motedato", om21)),
    normal: await fraFrist("normal", (q) => q.gt("frist", om21))
      + await fraMote("normal", (q) => q.gt("motedato", om21))
      + utenDato,
  };
}

async function lesKjoertAv(req: Request): Promise<KjoertAv> {
  let utlostAv: unknown;
  try {
    const tekst = await req.text();
    if (tekst.trim()) utlostAv = JSON.parse(tekst)?.utlost_av;
  } catch {
    utlostAv = undefined;
  }
  return utledKjoertAv({
    utlostAv,
    headerUtlostAv: req.headers.get("x-utlost-av"),
    vercelCronHeader: req.headers.get("x-vercel-cron"),
  });
}

type KildeStatusRad = {
  adapter: string;
  status: string;
  http_status: number | null;
  feilmelding: string | null;
  alarm: boolean;
  forsok: number;
  feilede: number;
};

async function loggKildeKall(
  supabase: { from: (t: string) => any },
  kall: Map<string, KallUtfall[]>,
  oppdatert: Map<string, number>,
  startet: Map<string, number>,
  kjoertAv: KjoertAv,
): Promise<{ rader: KildeStatusRad[]; loggFeil: string | null }> {
  const rader: KildeStatusRad[] = [];
  const adaptere = [...kall.keys()];
  if (adaptere.length === 0) return { rader, loggFeil: null };
  const { data, error } = await supabase.from("kilder").select("id, adapter").in("adapter", adaptere);
  if (error) return { rader, loggFeil: error.message };
  const idEtterAdapter = new Map<string, string>(
    (data ?? []).map((rad: { id: string; adapter: string }) => [rad.adapter, rad.id]),
  );
  let loggFeil: string | null = null;
  for (const adapter of adaptere) {
    const klass = klassifiserKildeKall(kall.get(adapter) ?? [], oppdatert.get(adapter) ?? 0);
    if (!klass) continue;
    const rad: KildeStatusRad = {
      adapter,
      status: klass.status,
      http_status: klass.httpStatus,
      feilmelding: klass.feilmelding,
      alarm: klass.alarm,
      forsok: klass.forsok,
      feilede: klass.feilede,
    };
    rader.push(rad);
    const kildeId = idEtterAdapter.get(adapter);
    if (!kildeId) {
      loggFeil = loggFeil ?? `Ingen rad i kilder for adapter ${adapter}`;
      console.error(loggFeil);
      continue;
    }
    const start = startet.get(adapter) ?? Date.now();
    const { error: ins } = await supabase.from("kilde_kjoringer").insert(
      byggKildeKjoringRad({
        kildeId,
        status: klass.status,
        antallFunnet: klass.forsok,
        antallEtterFilter: klass.vellykket,
        antallNye: oppdatert.get(adapter) ?? 0,
        feilmelding: klass.feilmelding,
        httpStatus: klass.httpStatus,
        varighetMs: Date.now() - start,
        kjoertAv,
        kjoeringstype: "vanlig",
        jobb: "oppdater-frister",
      }),
    );
    if (ins) {
      loggFeil = ins.message;
      console.error(`kilde_kjoringer ${adapter}:`, ins.message);
    }
  }
  return { rader, loggFeil };
}

Deno.serve(async (req: Request) => {
  const tidlig = tidligAvslag(
    req.method,
    Deno.env.get("HENT_SAKER_CRON_SECRET"),
    req.headers.get("x-cron-secret"),
  );
  if (tidlig) {
    if (tidlig.status === 503) {
      console.error("Kritisk konfigurasjonsfeil: HENT_SAKER_CRON_SECRET mangler");
    }
    if (tidlig.kind === "tekst") return new Response(tidlig.body, { status: tidlig.status });
    return jsonSvar(tidlig.body, tidlig.status);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonSvar({ feil: "Tjenesten er ikke konfigurert" }, 503);
  }
  const kjoertAv = await lesKjoertAv(req);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const idag = kalenderdag(Date.now());

  const stortinget = { kandidater: 0, oppdatert: 0, uendret: 0, feil: 0 };
  const regjeringen = { liste_treff: 0, oppdatert: 0, detalj_forsok: 0, uendret: 0, feil: 0 };
  const sametinget = { kandidater: 0, oppdatert: 0, uendret: 0, feil: 0 };
  const moter = { bergen: 0, einnsyn: 0, oppdatert: 0, feil: 0 };
  const kall = new Map<string, KallUtfall[]>();
  const startet = new Map<string, number>();
  const oppdatertPerKilde = new Map<string, number>();
  const merk = (adapter: string, utfall: KallUtfall) => {
    if (!startet.has(adapter)) startet.set(adapter, Date.now());
    const liste = kall.get(adapter) ?? [];
    liste.push(utfall);
    kall.set(adapter, liste);
  };
  const merkOppdatert = (adapter: string) => {
    oppdatertPerKilde.set(adapter, (oppdatertPerKilde.get(adapter) ?? 0) + 1);
  };

  try {
    const { data, error } = await supabase
      .from("varsler")
      .select("id, kilde, instans, tittel, frist, motedato, manuelt_redigert")
      .or("kilde.ilike.%stortinget.no%,kilde.ilike.%regjeringen.no%,kilde.ilike.%sametinget.no%,kilde.ilike.%einnsyn.no%,kilde.ilike.%bergen.kommune.no%");
    if (error) return jsonSvar({ feil: "Kunne ikke hente saker" }, 503);
    const rader = (data ?? []) as Rad[];

    const fristPerId = new Map<string, string>();
    for (let side = 1; side <= MAKS_LISTE_SIDER; side++) {
      const lest = await hentTekst(`${REGJERINGEN_HORING_LISTE}${side}`);
      merk("regjeringen-rss", somUtfall(lest));
      if ("feil" in lest) {
        console.error(`Regjeringen liste side ${side}: ${lest.feil.melding}`);
        regjeringen.feil++;
        continue;
      }
      for (const item of parseRegjeringenHoringListe(lest.tekst)) {
        if (item.frist) fristPerId.set(item.innholdId, item.frist);
      }
    }
    regjeringen.liste_treff = fristPerId.size;

    for (const rad of rader.filter((r) => erRegjeringsHoring(r.kilde, r.instans) && skalSkriveFrist(r))) {
      const innholdId = regjeringenInnholdId(rad.kilde);
      let frist = innholdId ? fristPerId.get(innholdId) ?? null : null;
      if (!frist && !rad.frist && regjeringen.detalj_forsok < MAKS_REGJERING_DETALJ) {
        const url = regjeringenSideUrl(rad.kilde);
        regjeringen.detalj_forsok++;
        if (!url) {
          regjeringen.feil++;
          continue;
        }
        const lest = await hentTekst(url);
        merk("regjeringen-rss", somUtfall(lest));
        if ("feil" in lest) {
          console.error(`Regjeringen detalj ${innholdId}: ${lest.feil.melding}`);
          regjeringen.feil++;
          continue;
        }
        frist = parseRegjeringenHoringSide(lest.tekst);
      }
      const har = rad.frist?.slice(0, 10) ?? null;
      if (!frist || frist === har) {
        regjeringen.uendret++;
        continue;
      }
      const feil = await oppdaterFrist(supabase, rad.id, frist);
      if (feil) {
        console.error(`frist ${rad.id}: ${feil}`);
        regjeringen.feil++;
      } else {
        regjeringen.oppdatert++;
        merkOppdatert("regjeringen-rss");
        rad.frist = frist;
      }
    }

    const kandidater = prioriterStorting(
      rader.filter((r) =>
        skalSkriveFrist(r) && stortingSakId(r.kilde) && skalOppdatereStortingFrist(r.frist, idag)
      ),
    ).slice(0, MAKS_STORTING_OPPSLAG);
    stortinget.kandidater = kandidater.length;
    for (const rad of kandidater) {
      const sakId = stortingSakId(rad.kilde);
      if (!sakId) continue;
      const oppslag = await hentStortingFrist(sakId);
      merk(
        "stortinget-saker",
        oppslag.feil
          ? utfallFeil(oppslag.feil.type, oppslag.feil.httpStatus)
          : utfallOk(oppslag.httpStatus),
      );
      if (oppslag.feil) {
        console.error(`Stortinget sak ${sakId}: ${oppslag.feil.melding}`);
        stortinget.feil++;
        continue;
      }
      const har = rad.frist?.slice(0, 10) ?? null;
      if (!oppslag.frist || oppslag.frist === har) {
        stortinget.uendret++;
        continue;
      }
      const feil = await oppdaterFrist(supabase, rad.id, oppslag.frist);
      if (feil) {
        console.error(`frist ${rad.id}: ${feil}`);
        stortinget.feil++;
      } else {
        stortinget.oppdatert++;
        merkOppdatert("stortinget-saker");
        rad.frist = oppslag.frist;
      }
    }

    const sametingKandidater = rader
      .filter((r) => erSametingetHoring(r.kilde, r.tittel) && !r.frist && skalSkriveFrist(r))
      .slice(0, MAKS_SAMETING);
    sametinget.kandidater = sametingKandidater.length;
    for (const rad of sametingKandidater) {
      if (!rad.kilde) continue;
      const lest = await hentTekst(rad.kilde);
      merk("sametinget", somUtfall(lest));
      if ("feil" in lest) {
        console.error(`Sametinget ${rad.id}: ${lest.feil.melding}`);
        sametinget.feil++;
        continue;
      }
      const frist = trekkHoringsfrist(lest.tekst);
      if (!frist) {
        sametinget.uendret++;
        continue;
      }
      const feil = await oppdaterFrist(supabase, rad.id, frist);
      if (feil) {
        console.error(`frist ${rad.id}: ${feil}`);
        sametinget.feil++;
      } else {
        sametinget.oppdatert++;
        merkOppdatert("sametinget");
        rad.frist = frist;
      }
    }

    const trengerMote = rader.filter((r) => !r.motedato && skalSkriveMotedato(r));
    if (trengerMote.some((r) => bergenMoteOgSak(r.kilde))) {
      const hentet = await hentBergenDatoer();
      merk("bergen", hentet.utfall);
      if (!hentet.utfall.ok) moter.feil++;
      for (const rad of trengerMote) {
        const nokkel = bergenMoteOgSak(rad.kilde);
        if (!nokkel) continue;
        const dato = hentet.datoer.get(`${nokkel.mote}/${nokkel.sak}`);
        if (!dato) continue;
        moter.bergen++;
        const feil = await oppdaterMotedato(supabase, rad.id, dato);
        if (feil) {
          console.error(`motedato ${rad.id}: ${feil}`);
          moter.feil++;
        } else {
          moter.oppdatert++;
          merkOppdatert("bergen");
          rad.motedato = dato;
        }
      }
    }
    for (const rad of trengerMote) {
      if (moter.einnsyn >= MAKS_MOTEOPPSLAG) break;
      const sakId = einnsynMoetesakId(rad.kilde);
      if (!sakId || rad.motedato) continue;
      moter.einnsyn++;
      const hentet = await hentEinnsynMotedato(sakId);
      for (const utfall of hentet.kall) merk("einnsyn", utfall);
      if (hentet.kall.some((utfall) => !utfall.ok)) moter.feil++;
      if (!hentet.dato) continue;
      const feil = await oppdaterMotedato(supabase, rad.id, hentet.dato);
      if (feil) {
        console.error(`motedato ${rad.id}: ${feil}`);
        moter.feil++;
      } else {
        moter.oppdatert++;
        merkOppdatert("einnsyn");
        rad.motedato = hentet.dato;
      }
    }

    const status = await merkFristStatus(supabase, idag);
    const logg = await loggKildeKall(supabase, kall, oppdatertPerKilde, startet, kjoertAv);
    const kropp = {
      kjørt: new Date().toISOString(),
      kjoert_av: kjoertAv,
      idag,
      stortinget,
      regjeringen,
      sametinget,
      moter,
      status,
      kilde_status: logg.rader,
      logg_feil: logg.loggFeil ?? undefined,
    };
    const http = harKildeAlarm(logg.rader) || logg.loggFeil ? 502 : 200;
    return jsonSvar(kropp, http);
  } catch (e) {
    console.error("oppdater-frister:", String(e).slice(0, 200));
    const logg = await loggKildeKall(supabase, kall, oppdatertPerKilde, startet, kjoertAv).catch((loggE) => {
      console.error("kilde_kjoringer:", String(loggE).slice(0, 200));
      return { rader: [] as KildeStatusRad[], loggFeil: String(loggE).slice(0, 200) };
    });
    return jsonSvar({
      feil: "Fristoppdateringen feilet",
      stortinget,
      regjeringen,
      sametinget,
      moter,
      kilde_status: logg.rader,
      logg_feil: logg.loggFeil ?? undefined,
    }, 500);
  }
});
