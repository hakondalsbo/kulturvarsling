import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AVVIST_SAMMENDRAG,
  DATASPILL_VARSEL_ID,
  oppdaterVarsel,
  skalSkriveFrist,
  skalSkriveMotedato,
  skalSkriveStatus,
} from "./varselvern.ts";

test("godkjente redaktørrader beholder tittel, sammendrag, kategori, frist og status", () => {
  const rad = {
    id: "80653f79-b471-49ed-b7c3-e98a118531af",
    sammendrag: "Ekte sammendrag om litteraturkapitlene.",
    manuelt_redigert: true,
  };
  const ut = oppdaterVarsel(rad, {
    tittel: "Ny tittel som ikke skal inn",
    sammendrag: "Nytt sammendrag som ikke skal inn",
    kategori: "film",
    frist: "2026-12-01",
    motedato: "2026-10-27",
    status: "kritisk",
    kommunenr: "4601",
    fylkesnr: "46",
    niva: "kommune",
    sted: "Bergen",
  });
  assert.deepEqual(ut, {
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

test("dataspillhøringen 90a26730 overskrives ikke, heller ikke fra avvisningsteksten", () => {
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
      status: "normal",
      publisert: true,
    },
  );
  assert.deepEqual(åpen, { publisert: true });
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
  const flere = [
    "de0dc5a6-fb44-4d5c-aebd-76b9ea10c085",
    "b70f9ea5-b8f2-4a1d-8c6a-2ccf1ec4bf8c",
    "90a26730-e886-4a10-a1e5-a08aedaabd17",
  ];
  assert.equal(skalSkriveFrist(budsjett), false);
  assert.equal(skalSkriveStatus(budsjett), false);
  assert.equal(skalSkriveFrist({ ...budsjett, frist: null, manuelt_redigert: false }), false);
  assert.equal(skalSkriveFrist(sametinget), false);
  assert.equal(skalSkriveStatus(sametinget), false);
  for (const id of flere) {
    assert.equal(skalSkriveFrist({ id, frist: null, manuelt_redigert: false }), false);
    assert.equal(skalSkriveStatus({ id, manuelt_redigert: true }), false);
  }
});

test("satt frist og status på andre redaktørrader overskrives ikke", () => {
  const rad = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", frist: "2026-12-01", manuelt_redigert: true };
  assert.equal(skalSkriveFrist(rad), false);
  assert.equal(skalSkriveStatus(rad), false);
  assert.equal(skalSkriveStatus({ id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", manuelt_redigert: false }), true);
});

test("tom frist og tom møtedato på en manuelt redigert rad skrives ikke", () => {
  const rad = {
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    frist: null,
    motedato: null,
    manuelt_redigert: true,
  };
  assert.equal(skalSkriveFrist(rad), false);
  assert.equal(skalSkriveMotedato(rad), false);
  assert.equal(skalSkriveStatus(rad), false);
  assert.deepEqual(oppdaterVarsel(rad, {
    frist: "2026-11-23",
    motedato: "2026-10-27",
    status: "kritisk",
    tittel: "Ny tittel",
    sammendrag: "Nytt sammendrag",
    kategori: "kulturarv",
    kilde_id: "2522cd41-b313-443d-9a4a-9dabd9b73119",
  }), {
    kilde_id: "2522cd41-b313-443d-9a4a-9dabd9b73119",
  });
  const bergenhus = {
    id: "de0dc5a6-fb44-4d5c-aebd-76b9ea10c085",
    frist: null,
    motedato: null,
    manuelt_redigert: true,
  };
  assert.equal(skalSkriveMotedato(bergenhus), false);
  assert.deepEqual(oppdaterVarsel(bergenhus, { motedato: "2026-10-27", frist: "2026-10-27" }), {});
});

test("overstyring er security definer, logger hvem, og triggeren feiler i stedet for å forkaste stille", () => {
  const sql = readFileSync("supabase/migrations/20261020250000_overstyr_og_emne.sql", "utf8");
  assert.match(sql, /security definer/);
  assert.match(sql, /app\.varsel_overstyr/);
  assert.match(sql, /varsel_endringslogg/);
  assert.match(sql, /hvem text not null/);
  assert.match(sql, /raise exception 'Kan ikke endre tittel, sammendrag, kategori, frist, møtedato eller status/);
  assert.match(sql, /new\.frist is distinct from old\.frist/);
  assert.match(sql, /new\.motedato is distinct from old\.motedato/);
  assert.match(sql, /new\.status is distinct from old\.status/);
  assert.match(sql, /grant execute on function public\.overstyr_varsel\(uuid, text, text, text, text, date, date, text\) to service_role/);
  assert.match(sql, /revoke all on function public\.overstyr_varsel\(uuid, text, text, text, text, date, date, text\) from authenticated/);
  assert.match(sql, /p_status not in \('kritisk', 'viktig', 'normal', 'passert'\)/);
  assert.doesNotMatch(sql, /update public\.varsler\s+set[\s\S]*manuelt_redigert/i);
  assert.doesNotMatch(sql, /feil_manglende_frist/);
});

test("manglende høringsfrist er kjørestatus, ikke en varsler.status", () => {
  const sql = readFileSync("supabase/migrations/20261020260000_kilde_manglende_frist.sql", "utf8");
  assert.match(sql, /kilde_kjoringer\.status/);
  assert.match(sql, /feil_manglende_frist/);
  assert.doesNotMatch(sql, /varsler_status_check/);
  assert.doesNotMatch(sql, /alter table public\.varsler/i);
});
