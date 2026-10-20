import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AVVIST_SAMMENDRAG,
  DATASPILL_VARSEL_ID,
  oppdaterVarsel,
} from "./varselvern.ts";

test("manuelt_redigert beskytter tittel, sammendrag og kategori for klartekst, backfill-geografi og fristoppdatering", () => {
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
