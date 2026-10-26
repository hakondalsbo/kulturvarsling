import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const fil = "supabase/migrations/20261026235000_fartsgrense_kampanje_rolle.sql";

test("kampanjefartsgrensen leser innlogget rolle, ikke eieren", () => {
  const sql = readFileSync(fil, "utf8");
  const kode = sql.replace(/--.*$/gm, "");
  assert.match(kode, /auth\.role\(\)/);
  assert.match(kode, /current_setting\('role', true\)/);
  assert.match(kode, /auth\.uid\(\)/);
  assert.match(kode, /rolle not in \('anon', 'authenticated'\)/);
  assert.doesNotMatch(kode, /current_user/);
  assert.match(kode, /create or replace function privat\.fartsgrense_kampanje/);
  assert.match(kode, /drop trigger if exists fartsgrense_foreslaa_kampanje/);
  assert.doesNotMatch(kode, /meld_pa_forsok|mobiliser_forsok|drop table/i);
});

test("authenticated blir telt og stoppet, service_role og postgres slipper", (t) => {
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
  kjør(["-c", "drop database if exists fartsgrense_kampanje_test with (force)"]);
  kjør(["-c", "create database fartsgrense_kampanje_test"]);
  const ut = kjør([
    "-d",
    "fartsgrense_kampanje_test",
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    "tests/fartsgrense-kampanje.sql",
  ]);
  assert.match(ut, /uten_jwt\s+\|\s+1/);
  assert.match(ut, /auth_bruker\s+\|\s+5/);
  assert.match(ut, /auth_stoppet\s+\|\s+ja/);
  assert.match(ut, /annen_bruker\s+\|\s+6/);
  assert.match(ut, /service_urort\s+\|\s+ja/);
  assert.match(ut, /postgres_urort\s+\|\s+ja/);
  assert.match(ut, /trigger_en\s+\|\s+1/);
  assert.match(ut, /kjort_to_ganger\s+\|\s+ja/);
  assert.doesNotMatch(ut, /ERROR/);
});
