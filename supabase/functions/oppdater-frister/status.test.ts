import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TUNGT_KULTURPOLITISKE_KATEGORIER,
  beregnFristStatus,
  type FristStatusInndata,
} from "./status.ts";

const IDAG = "2026-10-27";
const OM_TO = "2026-10-29";
const OM_TRE = "2026-10-30";
const OM_SYV = "2026-11-03";
const OM_ATTE = "2026-11-04";
const OM_TJUEEN = "2026-11-17";
const OM_TJUETO = "2026-11-18";

const FAG = [
  "scenekunst",
  "musikk",
  "dans",
  "opera",
  "litteratur",
  "film",
  "visuell",
  "museer",
  "spill",
  "kulturarv",
];

function sak(over: FristStatusInndata = {}): FristStatusInndata {
  return { frist: null, motedato: null, handling: null, kategori: null, ...over };
}

test("bare kulturpolitikk er tungt kulturpolitisk", () => {
  assert.deepEqual([...TUNGT_KULTURPOLITISKE_KATEGORIER], ["kulturpolitikk"]);
});

test("møte om 2 dager med bare_orientering er normal", () => {
  assert.equal(
    beregnFristStatus(sak({ motedato: OM_TO, handling: "bare_orientering", kategori: "musikk" }), IDAG),
    "normal",
  );
  assert.equal(
    beregnFristStatus(sak({ motedato: OM_TO, handling: "bare_orientering" }), IDAG),
    "normal",
  );
});

test("møte om 2 dager uten handling er normal for fagkategoriene", () => {
  assert.equal(
    beregnFristStatus(sak({ motedato: OM_TO, handling: null, kategori: "scenekunst" }), IDAG),
    "normal",
  );
  for (const kategori of FAG) {
    assert.equal(
      beregnFristStatus(sak({ motedato: OM_TO, handling: "bare_orientering", kategori }), IDAG),
      "normal",
      kategori,
    );
    assert.equal(
      beregnFristStatus(sak({ motedato: OM_TO, handling: null, kategori }), IDAG),
      "normal",
      kategori,
    );
  }
});

test("handling_mulig med frist om 3 dager er kritisk", () => {
  assert.equal(
    beregnFristStatus(sak({
      frist: OM_TRE,
      motedato: "2026-06-01",
      handling: "handling_mulig",
      kategori: "litteratur",
    }), IDAG),
    "kritisk",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: OM_TRE, handling: "handling_mulig" }), IDAG),
    "kritisk",
  );
});

test("passert frist og passert møte er passert, også med handlingsmulighet", () => {
  assert.equal(
    beregnFristStatus(sak({ frist: "2026-10-26", handling: "handling_mulig", kategori: "kulturpolitikk" }), IDAG),
    "passert",
  );
  assert.equal(
    beregnFristStatus(sak({ motedato: "2026-10-26", handling: "bare_orientering" }), IDAG),
    "passert",
  );
  assert.equal(
    beregnFristStatus(sak({
      frist: "2026-10-26",
      motedato: OM_TO,
      handling: "handling_mulig",
    }), IDAG),
    "passert",
  );
});

test("nær frist uten handlingsmulighet er normal, og kulturpolitikk er viktig", () => {
  assert.equal(
    beregnFristStatus(sak({ frist: OM_TRE, handling: "bare_orientering", kategori: "film" }), IDAG),
    "normal",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: OM_TRE, handling: null, kategori: "museer" }), IDAG),
    "normal",
  );
  assert.equal(
    beregnFristStatus(sak({ motedato: OM_TO, handling: "bare_orientering", kategori: "kulturpolitikk" }), IDAG),
    "viktig",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: OM_TRE, handling: null, kategori: "kulturpolitikk" }), IDAG),
    "viktig",
  );
  assert.equal(
    beregnFristStatus(sak({ motedato: OM_TO, handling: "annet", kategori: "kulturpolitikk" }), IDAG),
    "viktig",
  );
  assert.equal(
    beregnFristStatus(sak({ motedato: OM_TO, handling: "annet", kategori: "dans" }), IDAG),
    "normal",
  );
});

test("kulturpolitikk med handling_mulig innen 7 dager er fortsatt kritisk", () => {
  assert.equal(
    beregnFristStatus(sak({
      motedato: OM_TO,
      handling: "handling_mulig",
      kategori: "kulturpolitikk",
    }), IDAG),
    "kritisk",
  );
});

test("dag 0 og dag 7 følger samme nærvindu, dag 8 er viktig som før", () => {
  assert.equal(
    beregnFristStatus(sak({ frist: IDAG, handling: "handling_mulig" }), IDAG),
    "kritisk",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: IDAG, handling: null }), IDAG),
    "normal",
  );
  assert.equal(
    beregnFristStatus(sak({ motedato: OM_SYV, handling: "handling_mulig" }), IDAG),
    "kritisk",
  );
  assert.equal(
    beregnFristStatus(sak({ motedato: OM_SYV, handling: "bare_orientering", kategori: "spill" }), IDAG),
    "normal",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: OM_SYV, handling: null, kategori: "kulturpolitikk" }), IDAG),
    "viktig",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: OM_ATTE, handling: "bare_orientering", kategori: "musikk" }), IDAG),
    "viktig",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: OM_ATTE, handling: "handling_mulig" }), IDAG),
    "viktig",
  );
  assert.equal(
    beregnFristStatus(sak({ motedato: OM_ATTE, handling: null }), IDAG),
    "viktig",
  );
});

test("8 til 21 dager er viktig og lenger frem er normal, uavhengig av handling", () => {
  assert.equal(
    beregnFristStatus(sak({ frist: OM_TJUEEN, handling: null, kategori: "opera" }), IDAG),
    "viktig",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: OM_TJUEEN, handling: "handling_mulig" }), IDAG),
    "viktig",
  );
  assert.equal(
    beregnFristStatus(sak({ motedato: OM_TJUETO, handling: "handling_mulig", kategori: "kulturpolitikk" }), IDAG),
    "normal",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: "2026-12-01", handling: "bare_orientering" }), IDAG),
    "normal",
  );
});

test("uten dato er normal, og frist vinner over et nærmere møte", () => {
  assert.equal(beregnFristStatus(sak(), IDAG), "normal");
  assert.equal(
    beregnFristStatus(sak({ handling: "handling_mulig", kategori: "kulturpolitikk" }), IDAG),
    "normal",
  );
  assert.equal(
    beregnFristStatus(sak({
      frist: "2026-12-01",
      motedato: OM_TO,
      handling: "handling_mulig",
      kategori: "kulturpolitikk",
    }), IDAG),
    "normal",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: "ikke-en-dato", motedato: OM_TO, handling: "handling_mulig" }), IDAG),
    "normal",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: "", motedato: OM_TO, handling: "handling_mulig" }), IDAG),
    "kritisk",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: "2026-10-30T22:00:00.000Z", handling: "handling_mulig" }), IDAG),
    "kritisk",
  );
});

test("statusjobben bruker beregningen og skriver ikke handling", () => {
  const kilde = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(kilde, /beregnFristStatus\(/);
  assert.match(kilde, /select\("id, frist, motedato, handling, kategori, status"\)/);
  assert.match(kilde, /\.eq\("publisert", true\)/);
  assert.match(kilde, /\.eq\("manuelt_redigert", false\)/);
  assert.match(kilde, /REDAKTOR_ID_FILTER/);
  assert.doesNotMatch(kilde, /\.update\(\{[^}]*\bhandling\b/);
  assert.doesNotMatch(kilde, /\.update\(\{[^}]*\bmanuelt_redigert\b/);
  assert.doesNotMatch(kilde, /\.update\(\{[^}]*\bkategori\b/);
});
