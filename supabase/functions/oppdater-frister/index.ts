// Lett daglig jobb: oppdater HOERFRIST fra Stortinget, høringsfrist fra
// Regjeringen og Sametinget, og møtedato fra eInnsyn/Bergen. Kjører via
// pg_cron (oppdater-frister-daglig), ikke via Vercel Cron. Feil i ett
// oppslag stopper ikke de andre. Skriver frist, motedato og status.
// Aldri tittel, sammendrag eller kategori. Rader med manuelt_redigert
// beholder satt frist og status. 80653f79 og 1cf0dfd3 skrives ikke.

import { tidligAvslag } from "../hent-saker/kildehelse.ts";
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
import { REDAKTOR_FELT_LAAS, skalSkriveFrist } from "../_shared/varselvern.ts";
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

const REDAKTOR_ID_FILTER = `(${REDAKTOR_FELT_LAAS.join(",")})`;

async function hentTekst(url: string): Promise<{ tekst: string } | { feil: string }> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "text/html,application/json", "User-Agent": "Kulturvarsling/1.0" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { feil: `HTTP ${res.status}` };
    const tekst = await res.text();
    if (!tekst.trim()) return { feil: "Tom kropp" };
    return { tekst };
  } catch (e) {
    return { feil: String(e).slice(0, 120) };
  }
}

async function hentStortingFrist(sakId: string): Promise<{ frist: string | null; feil: string | null }> {
  const url = `https://data.stortinget.no/eksport/sak?sakid=${encodeURIComponent(sakId)}&format=json`;
  const lest = await hentTekst(url);
  if ("feil" in lest) return { frist: null, feil: lest.feil };
  try {
    return { frist: finnHøringsfrist(JSON.parse(lest.tekst)), feil: null };
  } catch {
    return { frist: null, feil: "Uventet format" };
  }
}

async function oppdaterFrist(
  supabase: { from: (t: string) => any },
  id: string,
  frist: string,
): Promise<string | null> {
  const { error } = await supabase.from("varsler").update({ frist }).eq("id", id);
  return error ? error.message : null;
}

async function oppdaterMotedato(
  supabase: { from: (t: string) => any },
  id: string,
  motedato: string,
): Promise<string | null> {
  const { error } = await supabase.from("varsler").update({ motedato }).eq("id", id);
  return error ? error.message : null;
}

function isoDato(verdi: unknown): string | null {
  const iso = String(verdi ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

async function hentEinnsynMotedato(sakId: string): Promise<string | null> {
  const sak = await hentTekst(`https://api.einnsyn.no/moetesak/${encodeURIComponent(sakId)}`);
  if ("feil" in sak) return null;
  let mappe = "";
  try {
    mappe = String(JSON.parse(sak.tekst)?.moetemappe ?? "");
  } catch {
    return null;
  }
  if (!mappe) return null;
  const m = await hentTekst(`https://api.einnsyn.no/moetemappe/${encodeURIComponent(mappe)}`);
  if ("feil" in m) return null;
  try {
    return isoDato(JSON.parse(m.tekst)?.moetedato);
  } catch {
    return null;
  }
}

async function hentBergenDatoer(): Promise<Map<string, string>> {
  const ut = new Map<string, string>();
  const år = new Date().getFullYear();
  const lest = await hentTekst(
    `https://www.bergen.kommune.no/politikere-utvalg/api/agendapunkter?tittel=kultur&year=${år}&rows=150`,
  );
  if ("feil" in lest) return ut;
  try {
    const data = JSON.parse(lest.tekst);
    const liste = Array.isArray(data) ? data : (data.items ?? data.agendapunkter ?? []);
    if (!Array.isArray(liste)) return ut;
    for (const punkt of liste) {
      const iso = isoDato(punkt?.moteDato);
      if (punkt?.moteId && punkt?.kildeId && iso) ut.set(`${punkt.moteId}/${punkt.kildeId}`, iso);
    }
  } catch {
    return ut;
  }
  return ut;
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
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const idag = kalenderdag(Date.now());

  const stortinget = { kandidater: 0, oppdatert: 0, uendret: 0, feil: 0 };
  const regjeringen = { liste_treff: 0, oppdatert: 0, detalj_forsok: 0, uendret: 0, feil: 0 };
  const sametinget = { kandidater: 0, oppdatert: 0, uendret: 0, feil: 0 };
  const moter = { bergen: 0, einnsyn: 0, oppdatert: 0, feil: 0 };

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
      if ("feil" in lest) {
        console.error(`Regjeringen liste side ${side}: ${lest.feil}`);
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
        if ("feil" in lest) {
          console.error(`Regjeringen detalj ${innholdId}: ${lest.feil}`);
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
      if (oppslag.feil) {
        console.error(`Stortinget sak ${sakId}: ${oppslag.feil}`);
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
      if ("feil" in lest) {
        console.error(`Sametinget ${rad.id}: ${lest.feil}`);
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
        rad.frist = frist;
      }
    }

    const trengerMote = rader.filter((r) => !r.motedato);
    if (trengerMote.some((r) => bergenMoteOgSak(r.kilde))) {
      const datoer = await hentBergenDatoer();
      for (const rad of trengerMote) {
        const nokkel = bergenMoteOgSak(rad.kilde);
        if (!nokkel) continue;
        const dato = datoer.get(`${nokkel.mote}/${nokkel.sak}`);
        if (!dato) continue;
        moter.bergen++;
        const feil = await oppdaterMotedato(supabase, rad.id, dato);
        if (feil) {
          console.error(`motedato ${rad.id}: ${feil}`);
          moter.feil++;
        } else {
          moter.oppdatert++;
          rad.motedato = dato;
        }
      }
    }
    for (const rad of trengerMote) {
      if (moter.einnsyn >= MAKS_MOTEOPPSLAG) break;
      const sakId = einnsynMoetesakId(rad.kilde);
      if (!sakId || rad.motedato) continue;
      moter.einnsyn++;
      const dato = await hentEinnsynMotedato(sakId);
      if (!dato) continue;
      const feil = await oppdaterMotedato(supabase, rad.id, dato);
      if (feil) {
        console.error(`motedato ${rad.id}: ${feil}`);
        moter.feil++;
      } else {
        moter.oppdatert++;
        rad.motedato = dato;
      }
    }

    const status = await merkFristStatus(supabase, idag);
    return jsonSvar({
      kjørt: new Date().toISOString(),
      idag,
      stortinget,
      regjeringen,
      sametinget,
      moter,
      status,
    });
  } catch (e) {
    console.error("oppdater-frister:", String(e).slice(0, 200));
    return jsonSvar({
      feil: "Fristoppdateringen feilet",
      stortinget,
      regjeringen,
      sametinget,
      moter,
    }, 500);
  }
});
