import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const migrasjon = readFileSync("supabase/migrations/20261024183000_minside_valg.sql", "utf8");

const oppsett = `
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text
);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
create table if not exists public.profiler (
  id uuid primary key,
  epost text,
  fagfelt text[] default '{}',
  geografisk text[] default '{}',
  varsel_frekvens text default 'daglig',
  varsler_aktive boolean not null default false,
  plan text default 'gratis',
  stripe_customer_id text
);
create table if not exists public.varsler (
  id uuid primary key,
  tittel text not null,
  sammendrag text,
  instans text,
  kilde text,
  kategori text,
  niva text,
  sted text,
  fylkesnr text,
  kommunenr text,
  frist date,
  status text
);
create table if not exists public.fulgte_saker (
  bruker_id uuid not null,
  sak_id uuid not null,
  primary key (bruker_id, sak_id)
);
grant select on public.profiler, public.varsler, public.fulgte_saker to anon, authenticated, service_role;
grant insert, delete on public.fulgte_saker to authenticated;
revoke update on table public.profiler from anon, authenticated;
grant update (epost, fagfelt, geografisk, varsel_frekvens, varsler_aktive)
  on table public.profiler to authenticated;
`;

const prove = `
insert into public.profiler (id, epost, fagfelt, geografisk, varsler_aktive)
values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com', array['musikk'], array['kommune:0301','sted:oslo'], true),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com', '{}', '{}', false);

insert into public.varsler (id, tittel, kategori, niva, sted, fylkesnr, kommunenr, instans, kilde)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Kulturskole i Oslo',
  'musikk',
  'kommune',
  'Oslo',
  '03',
  '0301',
  'Oslo kommune',
  'https://www.oslo.kommune.no/sak'
);

select 'FLAGG=' || public.kulturpolitikk_valgbart()::text as sjekk;
select 'KULTUR=' || public.sak_treffer_abonnement('musikk','kommune','03','0301','Oslo', array['kulturpolitikk'], array['land'])::text as sjekk;
select 'FYLKE_NEI=' || public.sak_treffer_abonnement('dans','kommune','46','4601','Bergen', array['musikk'], array['fylkeskommune:46'])::text as sjekk;
select 'FYLKE_JA=' || public.sak_treffer_abonnement('musikk','fylke','46',null,'Vestland', array['musikk'], array['fylkeskommune:46'])::text as sjekk;

-- anon kan ikke skrive
set role anon;
select 'ANON_ORGAN=' || has_column_privilege('anon', 'public.profiler', 'organ', 'UPDATE')::text as sjekk;
select 'ANON_INSERT=' || has_table_privilege('anon', 'public.lagrede_sok', 'INSERT')::text as sjekk;

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select 'AUTH_ORGAN=' || has_column_privilege('authenticated', 'public.profiler', 'organ', 'UPDATE')::text as sjekk;
select 'AUTH_PLAN=' || has_column_privilege('authenticated', 'public.profiler', 'plan', 'UPDATE')::text as sjekk;
update public.profiler set organ = array['stortinget'], komiteer = array['famkult'], minside_klar = true
  where id = '11111111-1111-1111-1111-111111111111';
insert into public.lagrede_sok (bruker_id, navn, sporretekst)
  values ('11111111-1111-1111-1111-111111111111', 'Kulturskole', 'kulturskole');
select 'EGNE=' || count(*)::text as sjekk from public.lagrede_sok;
`;

function psql(db: string, sql: string) {
  return spawnSync("psql", ["-d", db, "-v", "ON_ERROR_STOP=1", "-q"], {
    input: sql,
    encoding: "utf8",
  });
}

test("migrasjonen holder RLS for anon og authenticated", () => {
  const db = `minside_${process.pid}`;
  const laget = spawnSync("psql", ["-d", "postgres", "-c", `create database ${db}`], { encoding: "utf8" });
  if (laget.status !== 0) {
    throw new Error(`Kunne ikke lage testdatabase. ${laget.stderr || laget.stdout}`);
  }
  try {
    const start = psql(db, oppsett);
    assert.equal(start.status, 0, start.stderr);
    const migrert = psql(db, migrasjon);
    assert.equal(migrert.status, 0, migrert.stderr);
    const resultat = psql(db, prove);
    assert.equal(resultat.status, 0, `${resultat.stderr}\n${resultat.stdout}`);
    const ut = resultat.stdout;
    for (const linje of [
      "FLAGG=false",
      "KULTUR=true",
      "FYLKE_NEI=false",
      "FYLKE_JA=true",
      "ANON_ORGAN=false",
      "ANON_INSERT=false",
      "AUTH_ORGAN=true",
      "AUTH_PLAN=false",
      "EGNE=1",
    ]) {
      assert.ok(ut.includes(linje), `${linje} mangler i:\n${ut}\n${resultat.stderr}`);
    }

    const fremmed = psql(db, `
      set role authenticated;
      select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
      insert into public.lagrede_sok (bruker_id, navn, sporretekst)
        values ('22222222-2222-2222-2222-222222222222', 'Andres', 'hemmelig');
    `);
    assert.notEqual(fremmed.status, 0, "authenticated fikk skrive en annens søk");

    const anonSkriv = psql(db, `
      set role anon;
      insert into public.lagrede_sok (bruker_id, navn, sporretekst)
        values ('11111111-1111-1111-1111-111111111111', 'Anon', 'skal feile');
    `);
    assert.notEqual(anonSkriv.status, 0, "anon fikk skrive et søk");

    const anonProfil = psql(db, `
      set role anon;
      update public.profiler set organ = array['stortinget']
        where id = '11111111-1111-1111-1111-111111111111';
    `);
    assert.notEqual(anonProfil.status, 0, "anon fikk oppdatere organ");
  } finally {
    spawnSync("psql", ["-d", "postgres", "-c", `drop database if exists ${db} with (force)`], { encoding: "utf8" });
  }
});
