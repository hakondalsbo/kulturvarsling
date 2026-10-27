import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("anon og authenticated kan ikke lese signaturer, bare aggregatet", (t) => {
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
  const ut = execFileSync(
    "sudo",
    ["-u", "postgres", "psql", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "tests/mobiliser-rls.sql"],
    { encoding: "utf8" },
  );
  assert.match(ut, /CREATE FUNCTION|DO|COMMIT|You are now connected|setval|INSERT/i);
  assert.doesNotMatch(ut, /ERROR/);
});
