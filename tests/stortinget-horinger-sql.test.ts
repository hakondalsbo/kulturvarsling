import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const tabell = readFileSync("supabase/migrations/20261024220000_stortinget_horinger.sql", "utf8");
const folg = readFileSync("supabase/migrations/20261024221000_fulgte_komiteer.sql", "utf8");

test("stortinget_horinger har to frister, RLS og ingen lesing for anon", () => {
  assert.match(tabell, /create table public\.stortinget_horinger/);
  assert.match(tabell, /frist_delta timestamptz/);
  assert.match(tabell, /frist_innspill timestamptz/);
  assert.match(tabell, /enable row level security/);
  assert.match(tabell, /revoke all on table public\.stortinget_horinger from public/);
  assert.match(tabell, /revoke all on table public\.stortinget_horinger from anon/);
  assert.match(tabell, /revoke all on table public\.stortinget_horinger from authenticated/);
  assert.match(tabell, /grant select, insert, update on table public\.stortinget_horinger to service_role/);
  assert.equal(/create policy[\s\S]*stortinget_horinger/i.test(tabell), false);
  assert.match(tabell, /'stortinget-horinger'/);
  assert.match(tabell, /forventer_treff/);
  assert.match(tabell, /false/);
  assert.match(tabell, /\/horing\//);
  assert.match(tabell, /h=' \|\| m\[1\]/);
  assert.match(tabell, /p=' \|\| m\[1\]/);
  assert.equal(tabell.includes("påmeldingsfrist"), false);
  assert.match(tabell, /Frist for å søke om å delta/);
});

test("følg komité er av, og anon kan ikke skrive", () => {
  assert.match(folg, /'folg_komite', false/);
  assert.match(folg, /create table public\.fulgte_komiteer/);
  assert.match(folg, /references auth\.users/);
  assert.match(folg, /komite_id ~ '\^\[A-ZÆØÅ0-9\]\{2,16\}\$'/);
  assert.match(folg, /enable row level security/);
  assert.match(folg, /revoke all on table public\.fulgte_komiteer from public, anon, authenticated/);
  assert.match(folg, /grant select, insert, delete on table public\.fulgte_komiteer to authenticated/);
  assert.equal(/grant [^;]* on table public\.fulgte_komiteer to anon/.test(folg), false);
  assert.match(folg, /auth\.uid\(\) = bruker_id/);
  assert.match(folg, /privat\.folg_komite_aktiv\(\)/);
  assert.match(folg, /security definer/);
  assert.match(folg, /set search_path = ''/);
  assert.match(folg, /email_confirmed_at/);
  assert.match(folg, /'komite'::text/);
  assert.match(folg, /'sok'::text/);
  assert.match(folg, /and privat\.folg_komite_aktiv\(\)/);
  assert.match(folg, /v\.instans, v\.kilde, p\.organ, p\.komiteer/);
  assert.match(folg, /revoke all on function public\.mottakere_for_sak\(uuid\) from public, anon, authenticated/);
  assert.match(folg, /grant execute on function public\.mottakere_for_sak\(uuid\) to service_role/);
  assert.equal(/grant execute on function public\.mottakere_for_sak\(uuid\) to anon/.test(folg), false);
  assert.equal(folg.includes("p.epost"), false);
  assert.equal(folg.includes("nyhetsbrev"), false);
  assert.equal(folg.includes("alter default privileges"), false);
  assert.equal(folg.includes("pg_catalog.coalesce"), false);
  assert.equal((folg.match(/select coalesce\(/g) ?? []).length, 2);
});

test("migrasjoner bruker coalesce som syntaks", () => {
  const filer = readdirSync("supabase/migrations").filter((fil) => fil.endsWith(".sql"));
  for (const fil of filer) {
    const sql = readFileSync(`supabase/migrations/${fil}`, "utf8");
    assert.equal(sql.toLowerCase().includes("pg_catalog.coalesce"), false, fil);
  }
});
