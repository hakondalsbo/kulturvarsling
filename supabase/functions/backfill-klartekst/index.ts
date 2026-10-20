// Manuell, sikret backfill av generell klartekst for publiserte saker.
// Krever KLARTEKST_BACKFILL_SECRET i x-cron-secret. Ingen cron kaller denne.
// Ikke kjør den herfra — den er bare mekanismen.
// Skriver kun klartekst_cache. Oppdaterer aldri varsler.tittel, sammendrag
// eller kategori, så en rad med manuelt_redigert=true beholder redaktørens tekst.

import { tidligAvslag } from "../hent-saker/kildehelse.ts";
import {
  genererGenerellKlartekst,
  lagreKlartekstCache,
  type SakForKlartekst,
} from "../klartekst/generer.ts";
import { begrensBatch, generellProfilNokkel } from "../klartekst/logikk.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

function jsonSvar(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type SakRad = SakForKlartekst & { id: string };

Deno.serve(async (req: Request) => {
  const tidlig = tidligAvslag(
    req.method,
    Deno.env.get("KLARTEKST_BACKFILL_SECRET"),
    req.headers.get("x-cron-secret"),
  );
  if (tidlig) {
    if (tidlig.status === 503) {
      console.error("Kritisk konfigurasjonsfeil: KLARTEKST_BACKFILL_SECRET mangler");
    }
    if (tidlig.kind === "tekst") return new Response(tidlig.body, { status: tidlig.status });
    return jsonSvar(tidlig.body, tidlig.status);
  }

  let batch = begrensBatch(undefined);
  try {
    const tekst = await req.text();
    if (tekst.trim()) batch = begrensBatch(JSON.parse(tekst)?.batch);
  } catch {
    return jsonSvar({ feil: "Ugyldig JSON" }, 400);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !supabaseUrl || !serviceRoleKey) {
    return jsonSvar({ feil: "Tjenesten er ikke konfigurert" }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const profilNokkel = generellProfilNokkel();

  try {
    const { data: saker, error: sakFeil } = await supabase
      .from("varsler")
      .select("id, tittel, sammendrag, instans, frist, niva, sted")
      .eq("publisert", true)
      .order("opprettet", { ascending: false })
      .limit(500);
    if (sakFeil) return jsonSvar({ feil: "Kunne ikke hente saker" }, 503);

    const rader = (saker ?? []) as SakRad[];
    const ider = rader.map((s) => s.id);
    const har = new Set<string>();
    if (ider.length > 0) {
      const { data: cache, error: cacheFeil } = await supabase
        .from("klartekst_cache")
        .select("varsel_id")
        .eq("profil_nokkel", profilNokkel)
        .in("varsel_id", ider);
      if (cacheFeil) return jsonSvar({ feil: "Kunne ikke hente klartekst-cache" }, 503);
      for (const rad of cache ?? []) har.add(String((rad as { varsel_id: string }).varsel_id));
    }

    const mangler = rader.filter((s) => s.id && !har.has(s.id));
    const valgt = mangler.slice(0, batch);
    let lagret = 0;
    let feilet = 0;

    for (const sak of valgt) {
      try {
        const generert = await genererGenerellKlartekst(sak, apiKey);
        if (!generert) {
          feilet++;
          continue;
        }
        const cacheFeil = await lagreKlartekstCache(supabase, sak.id, generert);
        if (cacheFeil) {
          console.error("klartekst_cache:", cacheFeil);
          feilet++;
          continue;
        }
        lagret++;
      } catch (e) {
        console.error("backfill-klartekst:", String(e).slice(0, 200));
        feilet++;
      }
    }

    return jsonSvar({
      kjørt: new Date().toISOString(),
      profil_nokkel: profilNokkel,
      batch,
      manglet: mangler.length,
      forsokt: valgt.length,
      lagret,
      feilet,
      gjenstar: Math.max(0, mangler.length - lagret),
    });
  } catch (e) {
    console.error("backfill-klartekst uventet:", String(e).slice(0, 200));
    return jsonSvar({ feil: "Uventet feil" }, 500);
  }
});
