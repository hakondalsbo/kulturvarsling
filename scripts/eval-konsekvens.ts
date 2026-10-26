// Kjører konsekvens-klassifiseringen mot de 30 fasitsakene.
// Uten ANTHROPIC_API_KEY brukes en lokal nøkkelord-mock, ikke Haiku.
// Kildeteksten er det lagrede sammendraget. Hele kildedokumentet ligger ikke i databasen.
//
//   node --experimental-strip-types scripts/eval-konsekvens.ts
//   ANTHROPIC_API_KEY=... node --experimental-strip-types scripts/eval-konsekvens.ts
//
// Datoen er låst til 20.10.2026, samme dag som fasiten.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KONSEKVENS_NAVN,
  KONSEKVENS_VERDIER,
  kjørFasitEval,
  tolkKonsekvensSvar,
} from "../supabase/functions/_shared/konsekvens.ts";
import { klassifiserKonsekvens } from "../supabase/functions/_shared/konsekvens-kall.ts";
import { FASIT_DATO, FASIT_SAKER, type FasitSak } from "../supabase/functions/_shared/konsekvens-fasit.ts";

const her = path.dirname(fileURLToPath(import.meta.url));

/** Lokal stand-in. Leser bare tittel og lagret sammendrag, og er ikke fasiten. */
function mockJson(sak: FasitSak): string {
  const hay = `${sak.tittel}\n${sak.sammendrag ?? ""}`.toLowerCase();
  let konsekvens = "til_orientering";
  let sikkerhet = "middels";
  if (/innvilgede|tildeling:|orientering om tildelinger/.test(hay)) {
    konsekvens = "til_orientering";
    sikkerhet = "høy";
  }
  if (/barnevern|landbruk|vindkraft|klostergarasjen|meråpne bibliotek|referatsak|oversendelsesforslag|innspel til plan|redegjørelse|budsjettbehov|økonomiske perspektiver|søknader om økte/.test(hay)) {
    konsekvens = "til_orientering";
    sikkerhet = /klostergarasjen|økonomiske perspektiver|budsjettbehov|avvist/.test(hay) ? "lav" : "middels";
  }
  if (/endringer i statsbudsjettet/.test(hay)) {
    konsekvens = "til_orientering";
    sikkerhet = "lav";
  }
  if (/helligdagsfredloven|bydelsreform|oppgavefordeling|oppgaveoverføring|lotteri|dataspill|pengespill/.test(hay)) {
    konsekvens = "stor_endring";
    sikkerhet = "middels";
  }
  if (/kulturkvartalet|reguleringsplan|3,5 %|øker med/.test(hay)) {
    konsekvens = "ny_mulighet";
    sikkerhet = "middels";
  }
  if (/3,2\s*%/.test(hay) && /3,4\s*%/.test(hay)) {
    konsekvens = "kutt_innstramming";
    sikkerhet = "middels";
  }
  let mobiliser_dato: string | null = null;
  let mobiliser_grunn: string | null = null;
  if (sak.frist && /^\d{4}-\d{2}-\d{2}$/.test(sak.frist)) {
    mobiliser_dato = sak.frist;
    mobiliser_grunn = `Frist ${sak.frist}`;
  }
  if (/27\. oktober 2026/.test(hay)) {
    mobiliser_dato = "2026-10-27";
    mobiliser_grunn = "Bystyret behandler saken 27.10.2026";
  }
  return JSON.stringify({
    konsekvens,
    sikkerhet,
    begrunnelse: "Mockvurdering ut fra tittel og lagret sammendrag.",
    mobiliser_naa: false,
    mobiliser_dato,
    mobiliser_grunn,
  });
}

const brukMock = !process.env.ANTHROPIC_API_KEY || process.argv.includes("--mock");
const kilde = brukMock ? "mock" : "haiku";

const rapport = await kjørFasitEval(FASIT_SAKER, async (sak) => {
  if (brukMock) return tolkKonsekvensSvar(mockJson(sak), FASIT_DATO).konsekvens;
  const svar = await klassifiserKonsekvens({
    tittel: sak.tittel,
    sammendrag: sak.sammendrag,
    kildetekst: sak.sammendrag,
    instans: sak.instans,
    frist: sak.frist,
    dagensDato: FASIT_DATO,
  }, process.env.ANTHROPIC_API_KEY!, { oppgave: "konsekvens-eval", log: () => {} });
  return svar.ok ? svar.felt.konsekvens : null;
});

const ut = {
  kilde,
  dagens_dato: FASIT_DATO,
  skrev_til_database: false,
  merknad: brukMock
    ? "Ingen ANTHROPIC_API_KEY. Treffraten er fra en lokal nøkkelord-mock, ikke fra Haiku. Kildeteksten er det lagrede sammendraget, ikke hele dokumentet."
    : "Haiku via samme kall som pipelinen. Kildeteksten er det lagrede sammendraget, ikke hele dokumentet.",
  ...rapport,
};

const maal = path.join(her, "eval-konsekvens-resultat.json");
fs.writeFileSync(maal, JSON.stringify(ut, null, 2));

const prosent = (n: number | null) => n == null ? "–" : `${Math.round(n * 1000) / 10} %`;
console.log(`Kilde: ${kilde}. ${rapport.treff} av ${rapport.antall} (${prosent(rapport.rate)}).`);
for (const verdi of KONSEKVENS_VERDIER) {
  const v = rapport.per_verdi[verdi];
  console.log(`  ${KONSEKVENS_NAVN[verdi]}: ${v.treff}/${v.antall} (${prosent(v.rate)})`);
}
console.log(ut.merknad);
