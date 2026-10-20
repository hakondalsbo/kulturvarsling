// Batchvis, idempotent backfill av konsekvens.
// IKKE KJØR MOT PROD. Migrasjon og kjøring venter på Håkons godkjenning.
//
// Krever KONSEKVENS_BACKFILL_SECRET i headeren x-backfill-secret, i tillegg
// til plattformens JWT. GET gjør ingenting. POST tar én batch.
// Rader med konsekvens_manuell eller manuelt_redigert røres ikke.
// Rader som allerede har konsekvens, hoppes over.
// mobiliser_naa skrives fra datoen, aldri fra modellen.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { tidligAvslag } from "../hent-saker/kildehelse.ts";
import { klassifiserKonsekvens } from "../_shared/konsekvens-kall.ts";
import { oppfriskMobiliserNaa } from "../_shared/konsekvens-lager.ts";
import {
  KONSEKVENS_BACKFILL_BATCH,
  KONSEKVENS_BACKFILL_MAKS,
  kanKlassifisereRad,
  osloDato,
} from "../_shared/konsekvens.ts";

const KOLONNER =
  "id, tittel, sammendrag, instans, frist, konsekvens, konsekvens_manuell, manuelt_redigert";
const KOLONNER_UTEN_MANUELT =
  "id, tittel, sammendrag, instans, frist, konsekvens, konsekvens_manuell";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function manglerKolonne(melding: string, kolonne: string): boolean {
  return melding.toLowerCase().includes(kolonne.toLowerCase());
}

Deno.serve(async (req: Request) => {
  const tidlig = tidligAvslag(
    req.method,
    Deno.env.get("KONSEKVENS_BACKFILL_SECRET"),
    req.headers.get("x-backfill-secret"),
  );
  if (tidlig) {
    if (tidlig.status === 200) {
      return json({
        status: "ok",
        jobb: "backfill-konsekvens",
        merk: "GET klassifiserer ingenting. Ikke kall POST mot prod før Håkon har godkjent.",
      });
    }
    if (tidlig.kind === "tekst") return new Response(tidlig.body, { status: tidlig.status });
    return json(tidlig.body, tidlig.status);
  }

  let grense = KONSEKVENS_BACKFILL_BATCH;
  try {
    const tekst = await req.text();
    if (tekst.trim()) {
      const ønsket = Number(JSON.parse(tekst)?.grense);
      if (Number.isFinite(ønsket) && ønsket > 0) {
        grense = Math.min(KONSEKVENS_BACKFILL_MAKS, Math.floor(ønsket));
      }
    }
  } catch {
    return json({ feil: "Ugyldig JSON" }, 400);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ feil: "ANTHROPIC_API_KEY mangler" }, 503);

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
      feil: "Konsekvens-feltene finnes ikke, eller mobiliser-flagget kunne ikke oppdateres. Migrasjonen er ikke kjørt.",
    }, 503);
  }

  async function hentUklassifisert(kolonner: string) {
    return await supabase
      .from("varsler")
      .select(kolonner)
      .is("konsekvens", null)
      .eq("konsekvens_manuell", false)
      .order("opprettet", { ascending: true })
      .limit(grense);
  }

  let liste = await hentUklassifisert(KOLONNER);
  if (liste.error && manglerKolonne(liste.error.message, "manuelt_redigert")) {
    liste = await hentUklassifisert(KOLONNER_UTEN_MANUELT);
  }
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
    .eq("konsekvens_manuell", false);
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
    }, apiKey, { oppgave: "konsekvens-backfill" });

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
    merk: "Backfill er ikke kjørt mot prod fra denne endringen.",
  });
});
