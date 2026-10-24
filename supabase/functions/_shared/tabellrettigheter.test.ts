import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function utsagn(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((del) => del.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

test("migrasjonen trekker bare ubrukte skriverettigheter", () => {
  const sql = readFileSync("supabase/migrations/20261024163600_stram_inn_tabellrettigheter.sql", "utf8");
  const kode = utsagn(sql);
  assert.deepEqual(kode, [
    "revoke update, delete, truncate on table public.aktivitet, public.kampanje_signaturer, public.kampanjer, public.feedback from anon, authenticated",
    "revoke insert on table public.kampanjer from anon",
    "revoke update, truncate on table public.fulgte_saker from anon, authenticated",
    "revoke insert, delete, truncate on table public.profiler from anon, authenticated",
    "revoke insert, update, delete, truncate on table public.horingssvar from anon, authenticated",
    "drop policy if exists \"Send horing\" on public.horingssvar",
    "revoke insert, update, delete, truncate on table public.kilder, public.kilde_kjoringer, public.epost_varsler, public.budsjett_cache, public.klartekst_cache, public.kommune_brukere, public.kommuner, public.kommune_horinger from anon, authenticated",
    "revoke insert, update, delete, truncate on table public.kilde_alarmer, public.kilde_alarmer_frister from anon, authenticated",
    "revoke insert, update, delete, truncate on table public.kommune_innspill from anon, authenticated",
    "drop policy if exists \"Send innspill\" on public.kommune_innspill",
  ]);
  const tekst = kode.join("\n");
  assert.doesNotMatch(tekst, /revoke select/);
  assert.doesNotMatch(tekst, /grant /);
  assert.doesNotMatch(tekst, /public\.varsler/);
  assert.doesNotMatch(tekst, /add column/);
  assert.doesNotMatch(tekst, /revoke update on table public\.profiler/);
});
