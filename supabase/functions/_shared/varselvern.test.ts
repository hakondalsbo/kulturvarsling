import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AVVIST_SAMMENDRAG,
  DATASPILL_VARSEL_ID,
  oppdaterVarsel,
  skalSkriveFrist,
  skalSkriveStatus,
} from "./varselvern.ts";

test("manuelt_redigert beskytter tittel, sammendrag og kategori", () => {
  const rad = {
    id: "80653f79-b471-49ed-b7c3-e98a118531af",
    sammendrag: "Ekte sammendrag om litteraturkapitlene.",
    manuelt_redigert: true,
  };
  const ut = oppdaterVarsel(rad, {
    tittel: "Ny tittel som ikke skal inn",
    sammendrag: "Nytt sammendrag som ikke skal inn",
    kategori: "film",
    frist: "2026-10-28",
    status: "viktig",
    kommunenr: "4601",
    fylkesnr: "46",
    niva: "kommune",
    sted: "Bergen",
  });
  assert.deepEqual(ut, {
    frist: "2026-10-28",
    status: "viktig",
    kommunenr: "4601",
    fylkesnr: "46",
    niva: "kommune",
    sted: "Bergen",
  });
});

test("uflagget rad slipper tekstfeltene igjennom", () => {
  const ut = oppdaterVarsel(
    { id: "abc", sammendrag: "gammel", manuelt_redigert: false },
    { tittel: "Ny", sammendrag: "Ny tekst", kategori: "spill" },
  );
  assert.deepEqual(ut, { tittel: "Ny", sammendrag: "Ny tekst", kategori: "spill" });
});

test("dataspillhøringen kan korrigeres mens sammendraget fortsatt er avvisningsteksten", () => {
  const åpen = oppdaterVarsel(
    {
      id: DATASPILL_VARSEL_ID,
      sammendrag: AVVIST_SAMMENDRAG,
      manuelt_redigert: true,
    },
    {
      tittel: "Høring om dataspill",
      sammendrag: "Ordentlig sammendrag.",
      kategori: "spill",
      frist: "2027-01-12",
      publisert: true,
    },
  );
  assert.equal(åpen.sammendrag, "Ordentlig sammendrag.");
  assert.equal(åpen.kategori, "spill");
  assert.equal(åpen.frist, "2027-01-12");

  const låst = oppdaterVarsel(
    {
      id: DATASPILL_VARSEL_ID,
      sammendrag: "Ordentlig sammendrag.",
      manuelt_redigert: true,
    },
    { sammendrag: "Skal ikke overskrive", kategori: "film", frist: "2027-01-12" },
  );
  assert.deepEqual(låst, { frist: "2027-01-12" });
});

test("godkjente redaktørrader får ikke ny frist eller status", () => {
  const budsjett = {
    id: "80653f79-b471-49ed-b7c3-e98a118531af",
    frist: "2026-10-28",
    manuelt_redigert: true,
  };
  const sametinget = {
    id: "1cf0dfd3-4fc8-4fc0-976f-d733db4b7aae",
    frist: "2026-11-23",
    manuelt_redigert: true,
  };
  assert.equal(skalSkriveFrist(budsjett), false);
  assert.equal(skalSkriveStatus(budsjett), false);
  assert.equal(skalSkriveFrist({ ...budsjett, frist: null, manuelt_redigert: false }), false);
  assert.equal(skalSkriveFrist(sametinget), false);
  assert.equal(skalSkriveStatus(sametinget), false);
});

test("satt frist og status på andre redaktørrader overskrives ikke", () => {
  const rad = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", frist: "2026-12-01", manuelt_redigert: true };
  assert.equal(skalSkriveFrist(rad), false);
  assert.equal(skalSkriveStatus(rad), false);
  assert.equal(skalSkriveFrist({ ...rad, frist: null }), true);
  assert.equal(skalSkriveStatus({ id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", manuelt_redigert: false }), true);
});
