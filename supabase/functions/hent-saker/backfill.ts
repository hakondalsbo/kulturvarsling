// Engangs-backfill for regjeringen-hullet 29.09–19.10.2026 og to kjente
// Stortinget-rader. Kjøres bare når hent-saker får
// { "backfill": "regjeringen-2026-10" } og x-cron-secret.
// Idempotent mot kilde_nokkel: nye rader settes inn med ON CONFLICT DO NOTHING,
// og oppdateringer er betinget av placeholder-tekst eller manglende frist.

import {
  dedupEtterKilde,
  erRegjeringenRelevant,
  kategoriFraTittel,
  kildeNokkel,
  statusFraFrist,
  type RssItem,
} from "./logikk.ts";
import { hentFeeder, hentRegjeringenSide, parseOgBerik, REGJERINGEN_FEEDS } from "./regjeringen.ts";
import {
  AVVIST_SAMMENDRAG,
  DATASPILL_VARSEL_ID,
  erRedaktorFeltLaast,
  oppdaterVarsel,
  skalSkriveFrist,
  skalSkriveStatus,
  type VarselVern,
} from "../_shared/varselvern.ts";

export const BACKFILL_KODE = "regjeringen-2026-10";
export const BACKFILL_FRA = "29.09.2026";
export const BACKFILL_TIL = "19.10.2026";

export const MEDIEPOLITIKK_VARSEL_ID = "e05a0843-c5bc-42d8-9a3d-4a5df3f25096";
export const STATSBUDSJETT_VARSEL_ID = "80653f79-b471-49ed-b7c3-e98a118531af";
export const STATSBUDSJETT_FRIST = "2026-10-28";
export const DATASPILL_FRIST = "2027-01-12";

export const DATASPILL_SAMMENDRAG =
  "Kultur- og likestillingsdepartementet har sendt på høring Lotteri- og stiftelsestilsynets utredning om pengespill-lignende elementer i dataspill, blant annet lootbokser. Høringsfristen er 12. januar 2027.";

export const MEDIEPOLITIKK_SAMMENDRAG =
  "Kultur- og likestillingsministeren redegjør for Stortinget om mediepolitikk og ytringsfrihet. Saken gjelder rammevilkårene for mediene og det offentlige ordskiftet.";

export type EksisterendeVarsel = VarselVern & {
  id: string;
  kilde: string | null;
  tittel?: string | null;
  kategori?: string | null;
  frist?: string | null;
  publisert?: boolean | null;
};

export type BackfillPlan = {
  nye: Record<string, unknown>[];
  oppdateringer: Array<{ id: string; felt: Record<string, unknown> }>;
};

export function backfillFeeds(): Array<{ url: string; instans: string }> {
  return REGJERINGEN_FEEDS.filter((f) => f.vindu).map((f) => ({
    url: `${f.url}&from=${BACKFILL_FRA}&to=${BACKFILL_TIL}`,
    instans: f.instans,
  }));
}

function nyRad(item: RssItem, nå: number): Record<string, unknown> {
  const sammendrag = item.sammendrag_raa?.slice(0, 400) || item.tittel;
  return {
    tittel: item.tittel,
    sammendrag,
    instans: item.instans,
    kilde: item.kilde,
    frist: item.frist ?? null,
    kategori: kategoriFraTittel(item.tittel, item.sammendrag_raa),
    niva: "nasjonalt",
    sted: "Nasjonalt",
    status: statusFraFrist(item.frist, nå),
    publisert: true,
    sakstype: sakstypeFraInstans(item.instans),
  };
}

function sakstypeFraInstans(instans: string): string | null {
  const lav = instans.toLowerCase();
  if (lav.includes("høring")) return "horing";
  if (lav.includes("tilskudd")) return "tilskudd";
  if (lav.includes("budsjett") || lav.includes("proposisjon")) return "budsjett";
  if (lav.includes("nyhet")) return "nyhet";
  return null;
}

function leggTil(
  oppdateringer: BackfillPlan["oppdateringer"],
  id: string,
  felt: Record<string, unknown>,
) {
  if (Object.keys(felt).length === 0) return;
  const finnes = oppdateringer.find((o) => o.id === id);
  if (finnes) Object.assign(finnes.felt, felt);
  else oppdateringer.push({ id, felt });
}

/**
 * Rene reglene for hva backfillen skriver. Eksisterende kilde-URL hopper over
 * innsetting. Tekstfelt på manuelt_redigert røres ikke, men en tom frist settes.
 */
export function planleggBackfill(input: {
  items: RssItem[];
  eksisterende: EksisterendeVarsel[];
  nå?: number;
}): BackfillPlan {
  const nå = input.nå ?? Date.now();
  const relevante = input.items.filter((i) =>
    erRegjeringenRelevant(i.tittel, i.sammendrag_raa)
  );
  const kjente = new Set(
    input.eksisterende
      .map((r) => kildeNokkel(r.kilde))
      .filter((n): n is string => !!n),
  );
  const nye = dedupEtterKilde(relevante, kjente).map((item) => nyRad(item, nå));

  const oppdateringer: BackfillPlan["oppdateringer"] = [];
  const etterKilde = new Map<string, EksisterendeVarsel>();
  for (const rad of input.eksisterende) {
    const n = kildeNokkel(rad.kilde);
    if (n) etterKilde.set(n, rad);
  }
  for (const item of relevante) {
    const n = kildeNokkel(item.kilde);
    const rad = n ? etterKilde.get(n) : undefined;
    if (!rad || rad.frist || !item.frist || !skalSkriveFrist(rad)) continue;
    const felt: Record<string, unknown> = { frist: item.frist };
    if (skalSkriveStatus(rad)) felt.status = statusFraFrist(item.frist, nå);
    leggTil(oppdateringer, rad.id, oppdaterVarsel(rad, felt));
  }

  const dataspill = input.eksisterende.find((r) => r.id === DATASPILL_VARSEL_ID);
  if (
    dataspill &&
    dataspill.sammendrag === AVVIST_SAMMENDRAG &&
    !erRedaktorFeltLaast(dataspill.id)
  ) {
    const frist = dataspill.frist ?? DATASPILL_FRIST;
    leggTil(oppdateringer, dataspill.id, oppdaterVarsel(dataspill, {
      sammendrag: DATASPILL_SAMMENDRAG,
      frist,
      publisert: true,
      kategori: dataspill.kategori || "spill",
      status: statusFraFrist(frist, nå),
      manuelt_redigert: true,
    }));
  }

  const medie = input.eksisterende.find((r) => r.id === MEDIEPOLITIKK_VARSEL_ID);
  if (medie && medie.sammendrag === AVVIST_SAMMENDRAG) {
    leggTil(oppdateringer, medie.id, oppdaterVarsel(medie, {
      sammendrag: MEDIEPOLITIKK_SAMMENDRAG,
      publisert: true,
    }));
  }

  // 80653f79 er godkjent med frist 28.10 og status viktig. skalSkriveFrist
  // er false for den id-en, også om fristen skulle mangle.
  const budsjett = input.eksisterende.find((r) => r.id === STATSBUDSJETT_VARSEL_ID);
  if (budsjett && !budsjett.frist && skalSkriveFrist(budsjett)) {
    const felt: Record<string, unknown> = { frist: STATSBUDSJETT_FRIST };
    if (skalSkriveStatus(budsjett)) felt.status = statusFraFrist(STATSBUDSJETT_FRIST, nå);
    leggTil(oppdateringer, budsjett.id, oppdaterVarsel(budsjett, felt));
  }

  return { nye, oppdateringer };
}

type Db = {
  from: (t: string) => any;
};

export async function kjorRegjeringenBackfill(
  supabase: Db,
  hentSide: (url: string) => Promise<string | null> = hentRegjeringenSide,
): Promise<Record<string, unknown>> {
  const utfall = await hentFeeder(backfillFeeds(), async (url) => {
    const res = await fetch(url, { headers: { "User-Agent": "Kulturvarsling/1.0" } });
    const kropp = res.ok ? await res.text() : "";
    return { status: res.status, kropp };
  });
  const beriket = await parseOgBerik(utfall.items, hentSide);
  const { data, error } = await supabase
    .from("varsler")
    .select("id, kilde, tittel, sammendrag, kategori, frist, publisert, manuelt_redigert");
  if (error) {
    return { feil: "Eksisterende saker kunne ikke hentes. Backfill er ikke kjørt.", detalj: error.message };
  }
  const plan = planleggBackfill({
    items: beriket,
    eksisterende: (data ?? []) as EksisterendeVarsel[],
  });

  let lagret = 0;
  const feil: string[] = [];
  for (const rad of plan.nye) {
    const { error: ins } = await supabase.from("varsler").upsert(rad, {
      onConflict: "kilde_nokkel",
      ignoreDuplicates: true,
    });
    if (ins) feil.push(`${String(rad.tittel).slice(0, 80)}: ${ins.message}`);
    else lagret++;
  }
  let oppdatert = 0;
  for (const op of plan.oppdateringer) {
    const { error: upd } = await supabase.from("varsler").update(op.felt).eq("id", op.id);
    if (upd) feil.push(`${op.id}: ${upd.message}`);
    else oppdatert++;
  }

  return {
    backfill: BACKFILL_KODE,
    periode: `${BACKFILL_FRA}–${BACKFILL_TIL}`,
    funnet: utfall.raattAntall,
    relevante: beriket.filter((i) => erRegjeringenRelevant(i.tittel, i.sammendrag_raa)).length,
    planlagt_nye: plan.nye.length,
    planlagt_oppdateringer: plan.oppdateringer.length,
    lagret,
    oppdatert,
    feed_feil: utfall.feil.map((f) => f.melding),
    feil: feil.length ? feil.slice(0, 10) : undefined,
  };
}
