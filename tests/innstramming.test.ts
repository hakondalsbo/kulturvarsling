import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DB = "kv_innstramming_test";
const MIGRASJON = "supabase/migrations/20261024203000_innstramming_rettigheter_og_bekreftet_epost.sql";

function psqlArgs(): string[] | null {
  const kandidater = [
    ["-p", "5433", "-c", "select current_setting('server_version_num')::int"],
    ["-c", "select current_setting('server_version_num')::int"],
  ];
  for (const args of kandidater) {
    try {
      const ut = execFileSync("sudo", ["-u", "postgres", "psql", "-tA", ...args], { encoding: "utf8" });
      if (Number.parseInt(ut.trim(), 10) >= 170000) return args.slice(0, args.indexOf("-c"));
    } catch {
      /* neste */
    }
  }
  return null;
}

test("migrasjonen tar ikke klientrettigheter og har rollback-vern", () => {
  const sql = readFileSync(MIGRASJON, "utf8");
  assert.match(sql, /alter default privileges for role postgres in schema public/);
  assert.match(sql, /revoke all on sequences from anon, authenticated/);
  assert.match(sql, /kilde_kjoringer_id_seq/);
  assert.match(sql, /nyhetsbrev_utsendelser_id_seq/);
  assert.match(sql, /meld_pa_forsok_id_seq/);
  assert.match(sql, /bekreftelse_utsendelser_id_seq/);
  assert.match(sql, /revoke references, trigger, maintain/);
  assert.match(sql, /revoke all on table\s+public\.budsjett_cache/);
  assert.match(sql, /revoke update \(epost\) on table public\.profiler/);
  assert.match(sql, /email_confirmed_at is not null/);
  assert.doesNotMatch(sql, /p\.epost/);
  assert.match(sql, /function public\.mottakere_for_sak\(p_sak_id uuid\)[\s\S]{0,500}security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /alter function public\.mottakere_for_sak\(uuid\) owner to postgres/);
  assert.match(sql, /when insufficient_privilege then/);
  assert.doesNotMatch(sql, /revoke insert on table public\.fulgte_saker/i);
  assert.doesNotMatch(sql, /revoke insert on table public\.aktivitet/i);
  assert.doesNotMatch(sql, /revoke insert on table public\.kampanje_signaturer/i);
  assert.doesNotMatch(sql, /revoke insert on table public\.kampanjer/i);
  assert.doesNotMatch(sql, /revoke insert on table public\.feedback/i);
  assert.doesNotMatch(sql, /revoke insert on table public\.horingssvar/i);
  assert.doesNotMatch(sql, /revoke insert on table public\.kommune_innspill/i);
  assert.doesNotMatch(sql, /drop policy if exists "Les egne horingssvar"/);
  assert.doesNotMatch(sql, /drop policy if exists "Signer"/);
});

test("ROLLBACK-simulering på PostgreSQL 17", (t) => {
  const port = psqlArgs();
  if (!port) {
    t.skip("PostgreSQL 17 er ikke tilgjengelig");
    return;
  }
  const kjør = (args: string[]) => {
    const r = spawnSync("sudo", ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", ...port, ...args], {
      encoding: "utf8",
    });
    const ut = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    if (r.status !== 0) throw new Error(ut);
    return ut;
  };
  kjør(["-d", "postgres", "-c", `drop database if exists ${DB} with (force)`]);
  kjør(["-d", "postgres", "-c", `create database ${DB}`]);
  try {
    const ut = kjør(["-d", DB, "-f", "tests/innstramming-rollback.sql"]);
    assert.equal(ut.includes("FEIL:"), false);
    assert.match(ut, /ok: klientflyter etter innstramming/);
    assert.match(ut, /ok: rollback gjenopprettet rettighetene/);
    assert.match(ut, /ok: bekreftet auth-e-post brukes, ikke profiler\.epost/);
    assert.match(ut, /ok: service_role leser bekreftet e-post uten select på auth\.users/);
    assert.match(ut, /ok: mottakere_for_sak er security definer/);
    assert.match(ut, /ok: rollback: mottakere_for_sak er security invoker igjen/);
    assert.match(ut, /ok: ubekreftet auth-e-post sendes ikke/);
    assert.match(ut, /ok: eget høringssvar ble lagret/);
    assert.match(ut, /ok: eget kommuneinnspill ble lagret/);
    assert.match(ut, /ok: profiler\.epost ble ikke skrevet av authenticated/);
  } finally {
    kjør(["-d", "postgres", "-c", `drop database if exists ${DB} with (force)`]);
  }
});
