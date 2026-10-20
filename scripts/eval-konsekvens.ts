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
  tolkKonsekvensSvar,
  treffrate,
} from "../supabase/functions/_shared/konsekvens.ts";
import { klassifiserKonsekvens } from "../supabase/functions/_shared/konsekvens-kall.ts";

const FASIT_DATO = "2026-10-20";
const her = path.dirname(fileURLToPath(import.meta.url));

type Tekst = {
  id: string;
  tittel: string;
  sammendrag: string | null;
  instans: string | null;
  frist: string | null;
};

type Sak = Tekst & { forventet: string; sikkerhet: string };

function parseCsv(tekst: string): string[][] {
  const rader: string[][] = [];
  let rad: string[] = [];
  let celle = "";
  let sitat = false;
  const ren = tekst.replace(/^\uFEFF/, "");
  for (let i = 0; i < ren.length; i++) {
    const c = ren[i];
    if (sitat) {
      if (c === '"') {
        if (ren[i + 1] === '"') { celle += '"'; i++; }
        else sitat = false;
      } else celle += c;
    } else if (c === '"') sitat = true;
    else if (c === ",") { rad.push(celle); celle = ""; }
    else if (c === "\n") { rad.push(celle); rader.push(rad); rad = []; celle = ""; }
    else if (c !== "\r") celle += c;
  }
  if (celle.length || rad.length) { rad.push(celle); rader.push(rad); }
  return rader.filter((r) => r.some((c) => c.trim()));
}

function lesSaker(): Sak[] {
  const tabell = parseCsv(fs.readFileSync(path.join(her, "konsekvens-stikkprove.csv"), "utf8"));
  const hode = tabell[0];
  const kol = (navn: string) => {
    const i = hode.indexOf(navn);
    if (i < 0) throw new Error(`Mangler kolonne ${navn}`);
    return i;
  };
  const idI = kol("id");
  const verdiI = kol("foreslatt_konsekvens");
  const sikkerI = kol("sikkerhet");
  const tekster = JSON.parse(fs.readFileSync(path.join(her, "konsekvens-tekster.json"), "utf8")) as Tekst[];
  const etterId = new Map(tekster.map((t) => [t.id, t]));
  return tabell.slice(1).map((r) => {
    const id = r[idI];
    const tekst = etterId.get(id);
    if (!tekst) throw new Error(`Mangler tekst for ${id}`);
    return {
      ...tekst,
      sammendrag: tekst.sammendrag ?? "",
      forventet: r[verdiI],
      sikkerhet: r[sikkerI],
    };
  });
}

/** Lokal stand-in. Leser bare tittel og lagret sammendrag, og er ikke fasiten. */
function mockJson(sak: Sak): string {
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

const saker = lesSaker();
const brukMock = !process.env.ANTHROPIC_API_KEY || process.argv.includes("--mock");
const kilde = brukMock ? "mock" : "haiku";

const par = [];
for (const sak of saker) {
  let faktisk: string;
  if (brukMock) {
    faktisk = tolkKonsekvensSvar(mockJson(sak), FASIT_DATO).konsekvens;
  } else {
    const svar = await klassifiserKonsekvens({
      tittel: sak.tittel,
      sammendrag: sak.sammendrag ?? "",
      kildetekst: sak.sammendrag ?? "",
      instans: sak.instans ?? "",
      frist: sak.frist,
      dagensDato: FASIT_DATO,
    }, process.env.ANTHROPIC_API_KEY!, { oppgave: "konsekvens-eval", log: () => {} });
    faktisk = svar.ok ? svar.felt.konsekvens : "til_orientering";
  }
  par.push({ id: sak.id, forventet: sak.forventet, faktisk });
}

const rapport = treffrate(par);
const ut = {
  kilde,
  dagens_dato: FASIT_DATO,
  merknad: brukMock
    ? "Ingen ANTHROPIC_API_KEY. Treffraten er fra en lokal nøkkelord-mock, ikke fra Haiku. Kildeteksten er det lagrede sammendraget, ikke hele dokumentet."
    : "Haiku via samme kall som pipelinen. Kildeteksten er det lagrede sammendraget, ikke hele dokumentet.",
  antall: rapport.antall,
  treff: rapport.treff,
  rate: rapport.rate,
  per_verdi: rapport.per_verdi,
  saker: par,
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
