// Felles kall for pipeline og backfill. Samme modell, prompt og cache-form
// som klartekst-funksjonen, men med tom profil (alle fagfelt, hele landet).
// Feil returneres som null — kalleren skal ikke la dem velte innhentingen.

import { kallClaude } from "../_shared/claude.ts";
import { kildegrunnlag, loggUdokumenterteTall, type Tallavvik } from "../_shared/kildekontroll.ts";
import {
  byggPrompt,
  generellProfilNokkel,
  klartekstSomTekst,
  KLARTEKST_MAKS_TOKENS,
  KLARTEKST_MODELL,
  lagInnholdsNokkel,
  parseKlartekstSvar,
  trekkUtTekst,
  type KlartekstSvar,
} from "./logikk.ts";

/** Sonnet er dyrere enn relevansfilterets Haiku. Nye saker over taket venter på backfill. */
export const MAKS_KLARTEKST_PER_KJORING = 8;

export type SakForKlartekst = {
  tittel: string;
  sammendrag?: string | null;
  instans?: string | null;
  frist?: string | null;
  niva?: string | null;
  sted?: string | null;
};

export type GenerellKlartekst = {
  svar: KlartekstSvar;
  profilNokkel: string;
  innhold: string;
  tallavvik: Tallavvik;
};

export async function genererGenerellKlartekst(
  sak: SakForKlartekst,
  apiKey: string,
): Promise<GenerellKlartekst | null> {
  try {
    const prompt = byggPrompt(sak, null);
    const res = await kallClaude({
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: KLARTEKST_MODELL,
        max_tokens: KLARTEKST_MAKS_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    }, "klartekst");
    if (!res.ok) {
      console.error(`Klartekst pipeline HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const parsed = parseKlartekstSvar(trekkUtTekst(data.content));
    if (!parsed) return null;
    // Flagget stopper ikke klarteksten. Cache-raden skrives likevel.
    // Kalleren lagrer avviket i varsel_sperringer når den har varsel-id.
    const tallavvik = loggUdokumenterteTall(
      "klartekst",
      klartekstSomTekst(parsed),
      kildegrunnlag([sak.tittel, sak.sammendrag, sak.instans, sak.frist, sak.sted]),
      sak.tittel,
    );
    return {
      svar: parsed,
      profilNokkel: generellProfilNokkel(),
      innhold: await lagInnholdsNokkel(prompt, KLARTEKST_MODELL),
      tallavvik,
    };
  } catch (e) {
    console.error("Klartekst pipeline:", String(e).slice(0, 200));
    return null;
  }
}

export async function lagreKlartekstCache(
  supabase: { from: (tabell: string) => any },
  varselId: string,
  generert: GenerellKlartekst,
): Promise<string | null> {
  const { error } = await supabase.from("klartekst_cache").upsert(
    {
      varsel_id: varselId,
      profil_nokkel: generert.profilNokkel,
      svar: { ...generert.svar, _innhold: generert.innhold },
    },
    { onConflict: "varsel_id,profil_nokkel" },
  );
  return error ? (error.message ?? "cache-skriving feilet") : null;
}
