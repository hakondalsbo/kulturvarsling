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

test("dag 0 og dag 7 er kritisk bare med handling_mulig", () => {
  assert.equal(
    beregnFristStatus(sak({ frist: IDAG, handling: "handling_mulig" }), IDAG),
    "kritisk",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: IDAG, handling: null }), IDAG),
    "normal",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: IDAG, handling: null, kategori: "kulturpolitikk" }), IDAG),
    "viktig",
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
    "normal",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: OM_ATTE, handling: "bare_orientering", kategori: "kulturpolitikk" }), IDAG),
    "viktig",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: OM_ATTE, handling: "handling_mulig" }), IDAG),
    "viktig",
  );
  assert.equal(
    beregnFristStatus(sak({ motedato: OM_ATTE, handling: null }), IDAG),
    "normal",
  );
});

test("8 til 21 dager følger handling og kategori, og senere er normal", () => {
  assert.equal(
    beregnFristStatus(sak({ frist: OM_TJUEEN, handling: null, kategori: "opera" }), IDAG),
    "normal",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: OM_TJUEEN, handling: "bare_orientering", kategori: "kulturpolitikk" }), IDAG),
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
    beregnFristStatus(sak({ frist: OM_TJUETO, handling: "bare_orientering", kategori: "kulturpolitikk" }), IDAG),
    "normal",
  );
  assert.equal(
    beregnFristStatus(sak({ frist: "2026-12-01", handling: "bare_orientering" }), IDAG),
    "normal",
  );
});

const RANG = { normal: 0, viktig: 1, kritisk: 2 } as const;

function plussDager(iso: string, dager: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) + dager * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

test("status synker ikke når datoen kommer nærmere", () => {
  const typer = [
    { handling: "handling_mulig" as const, kategori: "kulturpolitikk" },
    { handling: "handling_mulig" as const, kategori: "musikk" },
    { handling: "bare_orientering" as const, kategori: "kulturpolitikk" },
    { handling: "bare_orientering" as const, kategori: "musikk" },
    { handling: null, kategori: "kulturpolitikk" },
    { handling: null, kategori: "musikk" },
  ];
  for (const type of typer) {
    let forrige = -1;
    for (let dager = 30; dager >= 0; dager--) {
      const status = beregnFristStatus(
        sak({ frist: plussDager(IDAG, dager), handling: type.handling, kategori: type.kategori }),
        IDAG,
      );
      const naa = RANG[status as keyof typeof RANG];
      assert.notEqual(status, "passert");
      assert.ok(
        naa >= forrige,
        `${type.handling ?? "null"}/${type.kategori} dag ${dager} ga ${status}`,
      );
      forrige = naa;
    }
  }

  const ved = (dager: number, handling: FristStatusInndata["handling"], kategori: string) =>
    beregnFristStatus(sak({ frist: plussDager(IDAG, dager), handling, kategori }), IDAG);

  assert.equal(ved(22, "handling_mulig", "musikk"), "normal");
  assert.equal(ved(21, "handling_mulig", "musikk"), "viktig");
  assert.equal(ved(8, "handling_mulig", "kulturpolitikk"), "viktig");
  assert.equal(ved(7, "handling_mulig", "kulturpolitikk"), "kritisk");
  assert.equal(ved(0, "handling_mulig", "musikk"), "kritisk");

  assert.equal(ved(22, "bare_orientering", "kulturpolitikk"), "normal");
  assert.equal(ved(21, "bare_orientering", "kulturpolitikk"), "viktig");
  assert.equal(ved(2, "bare_orientering", "kulturpolitikk"), "viktig");
  assert.equal(ved(0, null, "kulturpolitikk"), "viktig");

  assert.equal(ved(21, "bare_orientering", "musikk"), "normal");
  assert.equal(ved(8, null, "musikk"), "normal");
  assert.equal(ved(2, "bare_orientering", "musikk"), "normal");
  assert.equal(ved(0, null, "musikk"), "normal");
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
