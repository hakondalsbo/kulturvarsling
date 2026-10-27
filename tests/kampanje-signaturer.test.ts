import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const migrasjon = "supabase/migrations/20261024170000_steng_lesing_av_kampanje_signaturer.sql";

test("migrasjonen stenger lesing og anon-innsetting", () => {
  const sql = readFileSync(migrasjon, "utf8");
  assert.match(sql, /drop policy if exists "Les signaturer" on public\.kampanje_signaturer/);
  assert.match(sql, /revoke select \(id, kampanje_id\) on table public\.kampanje_signaturer from anon, authenticated/);
  assert.match(sql, /revoke insert on table public\.kampanje_signaturer from anon/);
  assert.match(sql, /with check \(auth\.uid\(\) = bruker_id\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /security_invoker = true/);
  assert.doesNotMatch(sql, /grant select/i);
  assert.doesNotMatch(sql, /grant insert/i);
});

test("klienten skriver ikke signaturer rett i tabellen", () => {
  const kilde = readFileSync("src/App.tsx", "utf8");
  assert.doesNotMatch(kilde, /rest\/v1\/kampanje_signaturer/);
  assert.doesNotMatch(kilde, /function signKampanje/);
  assert.match(kilde, /Signering er ikke åpen/);
});

test("rettigheter mot lokal Postgres som i prod", (t) => {
  let psql = "psql";
  try {
    execFileSync("sudo", ["-u", "postgres", "psql", "-c", "select 1"], { stdio: "ignore" });
    psql = "sudo";
  } catch {
    try {
      execFileSync("psql", ["-c", "select 1"], { stdio: "ignore" });
    } catch {
      t.skip("lokal Postgres er ikke tilgjengelig");
      return;
    }
  }
  const kjør = (args: string[]) => {
    const bin = psql === "sudo" ? ["-u", "postgres", "psql", ...args] : args;
    try {
      return execFileSync(psql, bin, { encoding: "utf8" });
    } catch (feil) {
      const err = feil as { stdout?: string; stderr?: string; message?: string };
      assert.fail(`${err.stdout ?? ""}\n${err.stderr ?? ""}\n${err.message ?? ""}`);
    }
  };
  kjør(["-c", "drop database if exists signatur_test with (force)"]);
  kjør(["-c", "create database signatur_test"]);
  const ut = kjør(["-d", "signatur_test", "-v", "ON_ERROR_STOP=1", "-f", "tests/kampanje-signaturer.sql"]);
  assert.match(ut, /anon_select\s+\|\s+nektet/);
  assert.match(ut, /anon_insert\s+\|\s+nektet/);
  assert.match(ut, /auth_insert_egen\s+\|\s+ok/);
  assert.match(ut, /auth_insert_annen\s+\|\s+nektet/);
  assert.match(ut, /auth_select\s+\|\s+(nektet|ingen_rader)/);
  assert.match(ut, /anon_telling\s+\|\s+ok/);
  assert.match(ut, /auth_telling\s+\|\s+ok/);
  assert.match(ut, /service_select\s+\|\s+ok/);
});
