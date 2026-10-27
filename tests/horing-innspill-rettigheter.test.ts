import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const DB = "kv_horing_rettighet_test";

function psql(args: string[], input?: string) {
  return execFileSync("sudo", ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", ...args], {
    input,
    encoding: "utf8",
  });
}

test("innloggede skriver bare egne rader, anon nektes, andre grants står", (t) => {
  try {
    execFileSync("sudo", ["-u", "postgres", "psql", "-c", "select 1"], { stdio: "ignore" });
  } catch {
    try {
      execFileSync("psql", ["-c", "select 1"], { stdio: "ignore" });
    } catch {
      t.skip("lokal Postgres er ikke tilgjengelig");
      return;
    }
  }
  psql(["-d", "postgres", "-c", `drop database if exists ${DB} with (force)`]);
  psql(["-d", "postgres", "-c", `create database ${DB}`]);
  try {
    const ut = psql(["-d", DB, "-f", "tests/horing-innspill-rettigheter.sql"]);
    assert.equal(ut.includes("ERROR"), false);
  } finally {
    psql(["-d", "postgres", "-c", `drop database if exists ${DB} with (force)`]);
  }
});
