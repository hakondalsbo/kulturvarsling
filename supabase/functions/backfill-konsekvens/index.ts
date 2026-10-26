// Batchvis, idempotent backfill av konsekvens, og en skrivebeskyttet eval.
//
// Auth er den samme som hent-saker: header x-cron-secret mot
// HENT_SAKER_CRON_SECRET (Vault-navn hent_saker_cron_secret).
// KONSEKVENS_BACKFILL_SECRET er valgfri og ikke påkrevd. Når den er satt,
// godtas den i x-cron-secret eller x-backfill-secret.
// GET gjør ingenting.
// POST {"eval":true} klassifiserer de 30 fasitsakene med Haiku og skriver ikke
// til databasen. POST uten eval tar én batch og oppdaterer ulåste rader.
// Rader med konsekvens_manuell eller manuelt_redigert røres ikke.
// Rader som allerede har konsekvens, hoppes over.
// mobiliser_naa skrives fra datoen, aldri fra modellen, og aldri på låste rader.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { klassifiserKonsekvens } from "../_shared/konsekvens-kall.ts";
import { FASIT_DATO, FASIT_SAKER } from "../_shared/konsekvens-fasit.ts";
import { oppfriskMobiliserNaa } from "../_shared/konsekvens-lager.ts";
import {
  EVAL_TIDSBUDSJETT_MS,
  KONSEKVENS_BACKFILL_BATCH,
  KONSEKVENS_BACKFILL_MAKS,
  KONSEKVENS_TIMEOUT_MS,
  avslagForKonsekvens,
  kanKlassifisereRad,
  kjørFasitEval,
  osloDato,
} from "../_shared/konsekvens.ts";

const KOLONNER =
  "id, tittel, sammendrag, instans, frist, konsekvens, konsekvens_manuell, manuelt_redigert";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function erEval(body: unknown): boolean {
  return !!body && typeof body === "object" && (body as { eval?: unknown }).eval === true;
}

Deno.serve(async (req: Request) => {
  const tidlig = avslagForKonsekvens(
    req.method,
    req.headers.get("x-cron-secret"),
    req.headers.get("x-backfill-secret"),
    Deno.env.get("HENT_SAKER_CRON_SECRET"),
    Deno.env.get("KONSEKVENS_BACKFILL_SECRET"),
  );
  if (tidlig) {
    if (tidlig.status === 200) {
      return json({
        status: "ok",
        jobb: "backfill-konsekvens",
        auth: "x-cron-secret",
        merk: "GET klassifiserer ingenting. POST {\"eval\":true} skriver ikke til databasen. Hemmeligheten er HENT_SAKER_CRON_SECRET.",
      });
    }
    if (tidlig.kind === "tekst") return new Response(tidlig.body, { status: tidlig.status });
    return json(tidlig.body, tidlig.status);
  }

  let body: unknown = {};
  try {
    const tekst = await req.text();
    if (tekst.trim()) body = JSON.parse(tekst);
  } catch {
    return json({ feil: "Ugyldig JSON" }, 400);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ feil: "ANTHROPIC_API_KEY mangler" }, 503);

  if (erEval(body)) {
    const rapport = await kjørFasitEval(
      FASIT_SAKER,
      async (sak) => {
        const svar = await klassifiserKonsekvens({
          tittel: sak.tittel,
          sammendrag: sak.sammendrag,
          kildetekst: sak.sammendrag,
          instans: sak.instans,
          frist: sak.frist,
          dagensDato: FASIT_DATO,
        }, apiKey, {
          oppgave: "konsekvens-eval",
          timeoutMs: KONSEKVENS_TIMEOUT_MS,
          log: () => {},
        });
        if (!svar.ok) return { konsekvens: null, begrunnelse: null, tokens: svar.tokens };
        return {
          konsekvens: svar.felt.konsekvens,
          begrunnelse: svar.felt.konsekvens_begrunnelse,
          tokens: svar.tokens,
        };
      },
      Date.now,
      EVAL_TIDSBUDSJETT_MS,
    );
    return json({
      eval: true,
      kilde: "haiku",
      dagens_dato: FASIT_DATO,
      skrev_til_database: false,
      tidsbudsjett_ms: EVAL_TIDSBUDSJETT_MS,
      merknad: "Kildeteksten er det lagrede sammendraget, ikke hele dokumentet. Utsatte saker inngår ikke i treffraten.",
      ...rapport,
    });
  }

  let grense = KONSEKVENS_BACKFILL_BATCH;
  const ønsket = Number((body as { grense?: unknown }).grense);
  if (Number.isFinite(ønsket) && ønsket > 0) {
    grense = Math.min(KONSEKVENS_BACKFILL_MAKS, Math.floor(ønsket));
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const iDag = osloDato();

  let mobiliserOppdatert = 0;
  try {
    mobiliserOppdatert = await oppfriskMobiliserNaa(supabase, iDag);
  } catch (e) {
    console.error("mobiliser-oppfrisk:", e);
    return json({
      feil: "Konsekvens-feltene finnes ikke, eller mobiliser-flagget kunne ikke oppdateres.",
    }, 503);
  }

  const liste = await supabase
    .from("varsler")
    .select(KOLONNER)
    .is("konsekvens", null)
    .eq("konsekvens_manuell", false)
    .eq("manuelt_redigert", false)
    .order("opprettet", { ascending: true })
    .limit(grense);
  if (liste.error) {
    console.error("backfill-les:", liste.error.message);
    return json({ feil: "Sakene kunne ikke hentes." }, 503);
  }

  type SakRad = {
    id: string;
    tittel: string | null;
    sammendrag: string | null;
    instans: string | null;
    frist: string | null;
    konsekvens: string | null;
    konsekvens_manuell: boolean | null;
    manuelt_redigert?: boolean | null;
  };
  const rader = (liste.data ?? []) as unknown as SakRad[];

  const { count, error: tellFeil } = await supabase
    .from("varsler")
    .select("id", { count: "exact", head: true })
    .is("konsekvens", null)
    .eq("konsekvens_manuell", false)
    .eq("manuelt_redigert", false);
  if (tellFeil) {
    console.error("backfill-tell:", tellFeil.message);
    return json({ feil: "Gjenstående saker kunne ikke telles." }, 503);
  }

  let oppdatert = 0;
  let hoppetOver = 0;
  const utsatt: string[] = [];
  const feil: string[] = [];

  for (const rad of rader) {
    if (!kanKlassifisereRad(rad)) {
      hoppetOver++;
      continue;
    }
    const svar = await klassifiserKonsekvens({
      tittel: rad.tittel ?? "",
      sammendrag: rad.sammendrag ?? "",
      kildetekst: rad.sammendrag ?? "",
      instans: rad.instans ?? "",
      frist: rad.frist ?? null,
      dagensDato: iDag,
    }, apiKey, { oppgave: "konsekvens-backfill", timeoutMs: KONSEKVENS_TIMEOUT_MS });

    if (!svar.ok) {
      utsatt.push(rad.id);
      feil.push(`${rad.id}: konsekvens utsatt (${svar.grunn})`);
      if (svar.status === 429) break;
      continue;
    }

    const { data: skrevet, error: skrivFeil } = await supabase
      .from("varsler")
      .update(svar.felt)
      .eq("id", rad.id)
      .eq("konsekvens_manuell", false)
      .eq("manuelt_redigert", false)
      .is("konsekvens", null)
      .select("id");
    if (skrivFeil) {
      feil.push(`${rad.id}: kunne ikke lagres`);
      console.error("backfill-skriv:", skrivFeil.message);
      continue;
    }
    if (!skrevet?.length) hoppetOver++;
    else oppdatert++;
  }

  return json({
    dagens_dato: iDag,
    mobiliser_oppdatert: mobiliserOppdatert,
    behandlet: rader.length,
    oppdatert,
    hoppet_over: hoppetOver,
    utsatt,
    gjenstaar: count ?? null,
    feil: feil.length ? feil : undefined,
    merk: "Backfill skriver bare ulåste rader uten konsekvens.",
  });
});
