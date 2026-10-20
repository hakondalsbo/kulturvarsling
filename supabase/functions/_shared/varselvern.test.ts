import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("overstyring er security definer, logger hvem, og triggeren feiler i stedet for å forkaste stille", () => {
  const sql = readFileSync("supabase/migrations/20261020250000_overstyr_og_emne.sql", "utf8");
  assert.match(sql, /security definer/);
  assert.match(sql, /app\.varsel_overstyr/);
  assert.match(sql, /varsel_endringslogg/);
  assert.match(sql, /hvem text not null/);
  assert.match(sql, /raise exception 'Kan ikke endre tittel, sammendrag eller kategori/);
  assert.match(sql, /grant execute on function public\.overstyr_varsel\(uuid, text, text, text, text\) to service_role/);
  assert.match(sql, /revoke all on function public\.overstyr_varsel\(uuid, text, text, text, text\) from authenticated/);
  assert.doesNotMatch(sql, /update public\.varsler\s+set[\s\S]*manuelt_redigert/i);
});
