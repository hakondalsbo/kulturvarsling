// Klartekst (VEIKART E2): «Hva betyr dette for deg?»
// POST {varsel_id, profil: {fagfelt, org_type, fylke?}} →
//   {svar: {hva_skjer, hvem_pavirkes, tall_belop, frist, hva_kan_du_gjore}, cachet}
// Svaret caches per sak + profiltype i klartekst_cache slik at samme
// kombinasjon aldri koster to Claude-kall.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  byggPrompt,
  lagProfilNokkel,
  parseKlartekstSvar,
  trekkUtTekst,
} from "./logikk.ts";

// Kalles fra nettleseren (i motsetning til hent-saker) — trenger CORS.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function svar(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function spørClaude(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        // Sonnet 5 tenker adaptivt som standard, og tenke-tokens teller mot
        // max_tokens — gi rom nok til både tenking og selve JSON-svaret.
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const kropp = await res.text().catch(() => "");
      console.error(`Claude API HTTP ${res.status}: ${kropp.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    return trekkUtTekst(data.content);
  } catch (e) {
    console.error("Claude-kall feilet:", String(e).slice(0, 200));
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return svar({ feil: "Bruk POST" }, 405);

  try {
    const { varsel_id, profil } = await req.json().catch(() => ({}));
    if (!varsel_id || typeof varsel_id !== "string") {
      return svar({ feil: "varsel_id mangler" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const nokkel = lagProfilNokkel(profil);

    // 1) Cache-oppslag — samme sak + profiltype skal aldri koste to kall
    const { data: cachet } = await supabase
      .from("klartekst_cache")
      .select("svar")
      .eq("varsel_id", varsel_id)
      .eq("profil_nokkel", nokkel)
      .maybeSingle();
    if (cachet?.svar) return svar({ svar: cachet.svar, cachet: true });

    // 2) Hent saken. Service role omgår RLS — filtrer selv på publisert
    //    så upubliserte/avviste rader aldri lekker ut.
    const { data: sak, error: sakFeil } = await supabase
      .from("varsler")
      .select("tittel, sammendrag, instans, frist, niva, sted")
      .eq("id", varsel_id)
      .eq("publisert", true)
      .maybeSingle();
    if (sakFeil) {
      console.error("Oppslag i varsler feilet:", sakFeil.message);
      return svar({ feil: "Databasefeil ved oppslag" }, 500);
    }
    if (!sak) return svar({ feil: "Fant ikke saken" }, 404);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      console.error("ANTHROPIC_API_KEY mangler");
      return svar({ feil: "AI-laget er ikke konfigurert" }, 500);
    }

    // 3) Claude — ett nytt forsøk ved feil, samme mønster som hent-saker
    let tekst = await spørClaude(byggPrompt(sak, profil), apiKey);
    if (!tekst) tekst = await spørClaude(byggPrompt(sak, profil), apiKey);
    const parsed = tekst ? parseKlartekstSvar(tekst) : null;
    if (!parsed) {
      console.error("Uparsbart Claude-svar:", (tekst ?? "").slice(0, 200));
      return svar({ feil: "AI-laget er utilgjengelig akkurat nå — prøv igjen om litt" }, 502);
    }

    // 4) Cache svaret. Upsert: to samtidige kall på samme kombinasjon
    //    skal ikke feile på unique-skranken.
    const { error: cacheFeil } = await supabase.from("klartekst_cache").upsert(
      { varsel_id, profil_nokkel: nokkel, svar: parsed },
      { onConflict: "varsel_id,profil_nokkel" },
    );
    if (cacheFeil) console.error("Cache-lagring feilet:", cacheFeil.message);

    return svar({ svar: parsed, cachet: false });
  } catch (e) {
    console.error("Kritisk feil:", e);
    return svar({ feil: String(e) }, 500);
  }
});
