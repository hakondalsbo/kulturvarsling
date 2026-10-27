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
  assert.match(sql, /revoke update, delete, truncate on public\.varsel_endringslogg from service_role, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.overstyr_varsel\(uuid, text, text, text, text, date, date, text\) to service_role/);
  assert.match(sql, /revoke all on function public\.overstyr_varsel\(uuid, text, text, text, text, date, date, text\) from authenticated/);
  assert.match(sql, /p_status not in \('kritisk', 'viktig', 'normal', 'passert'\)/);
  assert.doesNotMatch(sql, /update public\.varsler\s+set[\s\S]*manuelt_redigert/i);
  assert.doesNotMatch(sql, /feil_manglende_frist/);
});

/** Samme coalesce som overstyr_varsel. Tom streng hoppes over. claims-JSON vinner over den gamle innstillingen. */
function rolleFraKall(input: {
  jwtClaims: string | null;
  jwtClaimRole: string | null;
  sessionUser: string;
}): string {
  const claims = input.jwtClaims == null || input.jwtClaims === "" ? null : input.jwtClaims;
  const fraClaims = claims == null
    ? null
    : (JSON.parse(claims) as { role?: string | null }).role ?? null;
  const gammel = input.jwtClaimRole == null || input.jwtClaimRole === "" ? null : input.jwtClaimRole;
  return fraClaims ?? gammel ?? input.sessionUser;
}

function overstyrTillatt(rolle: string): boolean {
  return rolle === "service_role" || rolle === "postgres";
}

test("rollesjekken leser claims-JSON og faller tilbake til den gamle innstillingen", () => {
  const sql = readFileSync("supabase/migrations/20261020250000_overstyr_og_emne.sql", "utf8");
  assert.match(
    sql,
    /coalesce\(\s*nullif\(current_setting\('request\.jwt\.claims', true\), ''\)::json->>'role',\s*nullif\(current_setting\('request\.jwt\.claim\.role', true\), ''\),\s*session_user\s*\)/,
  );
  assert.match(sql, /rolle not in \('service_role', 'postgres'\)/);
  assert.doesNotMatch(sql, /supabase_admin/);

  assert.equal(overstyrTillatt(rolleFraKall({
    jwtClaims: '{"role":"service_role"}',
    jwtClaimRole: null,
    sessionUser: "authenticator",
  })), true);
  assert.equal(overstyrTillatt(rolleFraKall({
    jwtClaims: "",
    jwtClaimRole: "service_role",
    sessionUser: "authenticator",
  })), true);
  assert.equal(overstyrTillatt(rolleFraKall({
    jwtClaims: null,
    jwtClaimRole: null,
    sessionUser: "authenticator",
  })), false);
  assert.equal(overstyrTillatt(rolleFraKall({
    jwtClaims: null,
    jwtClaimRole: null,
    sessionUser: "postgres",
  })), true);
  assert.equal(overstyrTillatt(rolleFraKall({
    jwtClaims: '{"role":"authenticated"}',
    jwtClaimRole: "service_role",
    sessionUser: "postgres",
  })), false);
  assert.equal(overstyrTillatt(rolleFraKall({
    jwtClaims: null,
    jwtClaimRole: null,
    sessionUser: "supabase_admin",
  })), false);
});

test("handling er nullable uten default, og triggeren sperrer den ikke", () => {
  const sql = readFileSync("supabase/migrations/20261024155500_varsel_handling.sql", "utf8");
  const trigger = readFileSync("supabase/migrations/20261020250000_overstyr_og_emne.sql", "utf8");
  assert.match(sql, /create type public\.varsel_handling as enum \(\s*'handling_mulig',\s*'bare_orientering'\s*\)/);
  assert.match(sql, /add column handling public\.varsel_handling/);
  assert.match(sql, /grant usage on type public\.varsel_handling to anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /default/i);
  assert.doesNotMatch(sql, /not null/i);
  assert.doesNotMatch(sql, /update public\.varsler/i);
  assert.doesNotMatch(sql, /create or replace function public\.overstyr_varsel/);
  assert.doesNotMatch(trigger, /new\.handling/);
  assert.match(trigger, /new\.tittel is distinct from old\.tittel/);
  assert.match(trigger, /new\.status is distinct from old\.status/);
  const hent = readFileSync("supabase/functions/hent-saker/index.ts", "utf8");
  const frist = readFileSync("supabase/functions/oppdater-frister/index.ts", "utf8");
  assert.match(hent, /stortinget-horinger/);
  assert.match(hent, /rad\.handling = item\.handling/);
  // oppdater-frister leser handling for status. Kolonnen skrives ikke.
  assert.match(frist, /beregnFristStatus\(/);
  assert.doesNotMatch(frist, /\.update\(\{[^}]*\bhandling\b/);
});

test("anon og authenticated mister skriving på varsler, lesing blir stående", () => {
  const sql = readFileSync("supabase/migrations/20261024160600_varsler_ingen_skriving_for_anon.sql", "utf8");
  const utsagn = sql
    .split("\n")
    .map((linje) => linje.replace(/--.*$/, "").trim())
    .filter(Boolean);
  assert.deepEqual(utsagn, [
    "revoke insert, update, delete, truncate on public.varsler from anon, authenticated;",
  ]);
});

test("automatiske oppdateringer skriver ikke fase", () => {
  const åpen = oppdaterVarsel(
    { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", manuelt_redigert: false },
    { fase: "vedtak", kilde_id: "2522cd41-b313-443d-9a4a-9dabd9b73119", status: "normal" },
  );
  assert.equal("fase" in åpen, false);
  assert.equal(åpen.status, "normal");
  const låst = oppdaterVarsel(
    { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", manuelt_redigert: true },
    { fase: "vedtak", kilde_id: "2522cd41-b313-443d-9a4a-9dabd9b73119" },
  );
  assert.deepEqual(låst, { kilde_id: "2522cd41-b313-443d-9a4a-9dabd9b73119" });
});

test("manglende høringsfrist er kjørestatus, ikke en varsler.status", () => {
  const sql = readFileSync("supabase/migrations/20261020260000_kilde_manglende_frist.sql", "utf8");
  assert.match(sql, /kilde_kjoringer\.status/);
  assert.match(sql, /feil_manglende_frist/);
  assert.doesNotMatch(sql, /varsler_status_check/);
  assert.doesNotMatch(sql, /alter table public\.varsler/i);
});
