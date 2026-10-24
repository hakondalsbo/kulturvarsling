-- Simulerer migrasjonen 20261024203000 i en transaksjon og ruller tilbake.
-- Kjør mot en tom database på PostgreSQL 17 (MAINTAIN).
-- Før: anon/authenticated har de vide rettighetene fra prod.
-- Etter migrasjonen: klientflytene virker, de overflødige er borte.
-- Etter ROLLBACK: de vide rettighetene er tilbake.

create schema if not exists auth;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin superuser;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role, supabase_admin;
grant create on schema public to supabase_admin;
grant usage on schema auth to anon, authenticated, service_role;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz
);

create table public.profiler (
  id uuid primary key references auth.users (id) on delete cascade,
  navn text,
  epost text,
  org text,
  org_type text,
  fagfelt text[],
  geografisk text[],
  varsel_frekvens text,
  varsler_aktive boolean default false,
  onboarding_done boolean default false,
  opprettet timestamptz,
  oppdatert timestamptz,
  kommunenr text,
  fylkesnr text,
  personvern_akseptert_at timestamptz,
  personvern_versjon text,
  organ text[],
  komiteer text[]
);

create or replace function public.geografisk_tokens_gyldige(tokens text[])
returns boolean
language sql
immutable
as $$ select true $$;

alter table public.profiler
  add constraint profiler_geografisk_token check (public.geografisk_tokens_gyldige(geografisk));

create table public.varsler (
  id uuid primary key,
  tittel text,
  sammendrag text,
  kategori text,
  frist date,
  motedato date,
  status text,
  niva text,
  fylkesnr text,
  kommunenr text,
  sted text,
  instans text,
  kilde text
);

create table public.fulgte_saker (
  bruker_id uuid references public.profiler (id) on delete cascade,
  sak_id uuid references public.varsler (id) on delete cascade,
  primary key (bruker_id, sak_id)
);

create table public.aktivitet (
  id uuid primary key default gen_random_uuid(),
  bruker_id uuid,
  type text,
  tittel text,
  sak_id uuid,
  mottaker text
);

create table public.kampanjer (
  id uuid primary key default gen_random_uuid(),
  tittel text,
  beskrivelse text,
  mal integer,
  kategori text,
  sak_id uuid,
  tags text[],
  dager integer,
  aktiv boolean
);

create table public.kampanje_signaturer (
  id uuid primary key default gen_random_uuid(),
  kampanje_id uuid references public.kampanjer (id) on delete cascade,
  bruker_id uuid,
  navn text,
  epost text,
  unique (kampanje_id, bruker_id)
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  bruker_id uuid,
  type text,
  tekst text,
  sak_tittel text
);

create table public.horingssvar (
  id uuid primary key default gen_random_uuid(),
  bruker_id uuid,
  sak_id uuid,
  org text,
  tekst text,
  sendt_til text
);

create table public.kommune_horinger (
  id uuid primary key default gen_random_uuid(),
  publisert boolean default false
);

create table public.kommune_innspill (
  id uuid primary key default gen_random_uuid(),
  horing_id uuid references public.kommune_horinger (id) on delete cascade,
  bruker_id uuid,
  tekst text,
  status text,
  svar_tekst text,
  svar_dato timestamptz
);

create table public.kilder (id int primary key);
create table public.budsjett_cache (id int primary key);
create table public.klartekst_cache (id int primary key);
create table public.kommune_brukere (id int primary key);
create table public.kommuner (id int primary key);

create sequence public.kilde_kjoringer_id_seq;
create sequence public.nyhetsbrev_utsendelser_id_seq;
create sequence public.meld_pa_forsok_id_seq;
create sequence public.bekreftelse_utsendelser_id_seq;

create view public.kampanje_med_signaturer as
  select id from public.kampanjer;

create or replace function public.adapter_fra_kilde(raw text)
returns text language sql immutable as $$ select raw $$;

create or replace function public.normaliser_kilde_url(raw text)
returns text language sql immutable as $$ select raw $$;

create or replace function public.normaliser_innhold_tekst(raw text)
returns text language sql immutable as $$ select raw $$;

create or replace function public.innhold_dedup_nokkel(instans text, tittel text, frist date, kilde text)
returns text language sql immutable as $$ select tittel $$;

create or replace function public.sak_treffer_abonnement(
  sak_kategori text, sak_niva text, sak_fylkesnr text, sak_kommunenr text,
  sak_sted text, fagfelt text[], geografisk text[],
  sak_instans text default null, sak_kilde text default null,
  organ text[] default null, komiteer text[] default null
) returns boolean
language sql immutable as $$ select true $$;

create or replace function public.tekst_inneholder(haystack text, ord text)
returns boolean
language sql immutable as $$ select false $$;

create table public.lagrede_sok (
  id uuid primary key default gen_random_uuid(),
  bruker_id uuid not null references public.profiler (id) on delete cascade,
  navn text,
  sporretekst text not null
);

create function public.mottakere_for_sak(p_sak_id uuid)
returns table (bruker_id uuid, epost text, varsel_frekvens text, grunn text)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select p.id, coalesce(nullif(btrim(p.epost), ''), u.email), p.varsel_frekvens, 'gammel'::text
  from public.profiler p
  left join auth.users u on u.id = p.id
  where p.id = p_sak_id
$$;
revoke all on function public.mottakere_for_sak(uuid) from public, anon, authenticated;
grant execute on function public.mottakere_for_sak(uuid) to service_role;

create schema if not exists net;
create or replace function net.http_post()
returns bigint
language sql
as $$ select 1::bigint $$;
alter function net.http_post() owner to supabase_admin;

alter table public.profiler enable row level security;
alter table public.fulgte_saker enable row level security;
alter table public.aktivitet enable row level security;
alter table public.kampanjer enable row level security;
alter table public.kampanje_signaturer enable row level security;
alter table public.feedback enable row level security;
alter table public.horingssvar enable row level security;
alter table public.kommune_innspill enable row level security;

create policy "Eget profil" on public.profiler for all to public
  using (auth.uid() = id) with check (auth.uid() = id);
create policy "Egne fulgte" on public.fulgte_saker for all to public
  using (auth.uid() = bruker_id) with check (auth.uid() = bruker_id);
create policy "Egen aktivitet" on public.aktivitet for all to public
  using (auth.uid() = bruker_id) with check (auth.uid() = bruker_id);
create policy "Les kampanjer" on public.kampanjer for select to public using (aktiv = true);
create policy "foreslaa_kampanje" on public.kampanjer for insert to public with check (aktiv = false);
create policy "Signer" on public.kampanje_signaturer for insert to authenticated
  with check (auth.uid() = bruker_id);
create policy "Send feedback" on public.feedback for insert to public
  with check (auth.uid() = bruker_id or bruker_id is null);
create policy "Les egne horingssvar" on public.horingssvar for select to authenticated
  using ((select auth.uid()) = bruker_id);
create policy "Skriv egne horingssvar" on public.horingssvar for insert to authenticated
  with check ((select auth.uid()) = bruker_id);
create policy "Endre egne horingssvar" on public.horingssvar for update to authenticated
  using ((select auth.uid()) = bruker_id) with check ((select auth.uid()) = bruker_id);
create policy "Les egne innspill" on public.kommune_innspill for select to authenticated
  using ((select auth.uid()) = bruker_id);
create policy "Send egne innspill" on public.kommune_innspill for insert to authenticated
  with check (
    (select auth.uid()) = bruker_id
    and (status is null or status = 'ny')
    and svar_tekst is null
    and svar_dato is null
  );

-- Samme mønster som i prod før denne migrasjonen: xtm/m ligger på,
-- og klienten har bare insert/delete/select der flyten trenger det.
grant select, insert, delete, references, trigger, maintain on table public.fulgte_saker to anon, authenticated;
grant select, insert, references, trigger, maintain on table public.aktivitet to anon, authenticated;
grant select, insert, references, trigger, maintain on table public.kampanjer to authenticated;
grant select, references, trigger, maintain on table public.kampanjer to anon;
grant references, trigger, maintain on table public.kampanje_signaturer to anon, authenticated;
grant insert on table public.kampanje_signaturer to authenticated;
grant select, insert, references, trigger, maintain on table public.feedback to anon, authenticated;
grant select, insert, update, references, trigger, maintain on table public.horingssvar to authenticated;
grant select, insert, references, trigger, maintain on table public.kommune_innspill to authenticated;
grant select, references, trigger, maintain on table public.kilder to anon, authenticated;
grant select, references, trigger, maintain on table public.varsler to anon, authenticated;
grant select, references, trigger, maintain on table
  public.budsjett_cache, public.klartekst_cache, public.kommune_brukere, public.kommuner
to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant select, insert, update, delete on table public.lagrede_sok to authenticated;
revoke all on table auth.users from public, anon, authenticated, service_role;

grant select, maintain on table public.kampanje_med_signaturer to anon, authenticated, service_role;

grant select, references, trigger, maintain on table public.profiler to authenticated;
grant update (
  navn, epost, org, org_type, fagfelt, geografisk, varsel_frekvens,
  onboarding_done, opprettet, oppdatert, kommunenr, fylkesnr,
  personvern_akseptert_at, personvern_versjon, varsler_aktive
) on table public.profiler to authenticated;

grant usage, select, update on all sequences in schema public to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;

alter default privileges for role supabase_admin in schema public
  grant all on tables to anon, authenticated, service_role;

create or replace function pg_temp.krev(ok boolean, melding text)
returns void
language plpgsql
as $$
begin
  if not ok then
    raise exception 'FEIL: %', melding;
  end if;
  raise notice 'ok: %', melding;
end $$;

select pg_temp.krev(
  has_sequence_privilege('anon', 'public.kilde_kjoringer_id_seq', 'USAGE'),
  'forutsetning: anon har usage på sekvens før migrasjonen'
);

begin;

\i supabase/migrations/20261024203000_innstramming_rettigheter_og_bekreftet_epost.sql

create table public._ny_etter (id int);
select pg_temp.krev(not has_table_privilege('anon', 'public._ny_etter', 'INSERT'), 'ny tabell: anon har ikke insert');
select pg_temp.krev(not has_table_privilege('authenticated', 'public._ny_etter', 'UPDATE'), 'ny tabell: authenticated har ikke update');
select pg_temp.krev(has_table_privilege('service_role', 'public._ny_etter', 'INSERT'), 'ny tabell: service_role beholder insert');

set role supabase_admin;
create table public._ny_admin (id int);
reset role;
select pg_temp.krev(not has_table_privilege('anon', 'public._ny_admin', 'SELECT'), 'supabase_admin-tabell: anon har ikke select');

select pg_temp.krev(not has_sequence_privilege('anon', 'public.kilde_kjoringer_id_seq', 'USAGE'), 'anon mister usage på kilde_kjoringer_id_seq');
select pg_temp.krev(not has_sequence_privilege('anon', 'public.kilde_kjoringer_id_seq', 'UPDATE'), 'anon mister update på kilde_kjoringer_id_seq');
select pg_temp.krev(not has_sequence_privilege('authenticated', 'public.nyhetsbrev_utsendelser_id_seq', 'USAGE'), 'authenticated mister usage på nyhetsbrev_utsendelser_id_seq');
select pg_temp.krev(not has_sequence_privilege('anon', 'public.meld_pa_forsok_id_seq', 'USAGE'), 'anon mister usage på meld_pa_forsok_id_seq');
select pg_temp.krev(not has_sequence_privilege('authenticated', 'public.bekreftelse_utsendelser_id_seq', 'UPDATE'), 'authenticated mister update på bekreftelse_utsendelser_id_seq');
select pg_temp.krev(has_sequence_privilege('service_role', 'public.kilde_kjoringer_id_seq', 'USAGE'), 'service_role beholder usage på sekvens');

select pg_temp.krev(not has_table_privilege('anon', 'public.kampanje_signaturer', 'MAINTAIN'), 'anon mister maintain på kampanje_signaturer');
select pg_temp.krev(not has_table_privilege('authenticated', 'public.varsler', 'MAINTAIN'), 'authenticated mister maintain på varsler');
select pg_temp.krev(not has_table_privilege('anon', 'public.kilder', 'TRIGGER'), 'anon mister trigger på kilder');
select pg_temp.krev(has_table_privilege('anon', 'public.kilder', 'SELECT'), 'anon beholder select på kilder');
select pg_temp.krev(has_table_privilege('anon', 'public.kampanje_med_signaturer', 'SELECT'), 'anon beholder select på kampanje_med_signaturer');
select pg_temp.krev(not has_table_privilege('anon', 'public.kampanje_med_signaturer', 'MAINTAIN'), 'anon mister maintain på kampanje_med_signaturer');

select pg_temp.krev(not has_table_privilege('anon', 'public.budsjett_cache', 'SELECT'), 'anon mister select på budsjett_cache');
select pg_temp.krev(not has_table_privilege('authenticated', 'public.klartekst_cache', 'SELECT'), 'authenticated mister select på klartekst_cache');
select pg_temp.krev(not has_table_privilege('anon', 'public.kommune_brukere', 'SELECT'), 'anon mister select på kommune_brukere');
select pg_temp.krev(not has_table_privilege('authenticated', 'public.kommuner', 'SELECT'), 'authenticated mister select på kommuner');
select pg_temp.krev(has_table_privilege('service_role', 'public.budsjett_cache', 'SELECT'), 'service_role beholder select på budsjett_cache');

select pg_temp.krev(has_table_privilege('authenticated', 'public.fulgte_saker', 'INSERT'), 'fulgte_saker insert authenticated');
select pg_temp.krev(has_table_privilege('authenticated', 'public.fulgte_saker', 'DELETE'), 'fulgte_saker delete authenticated');
select pg_temp.krev(has_table_privilege('authenticated', 'public.aktivitet', 'INSERT'), 'aktivitet insert authenticated');
select pg_temp.krev(has_table_privilege('authenticated', 'public.kampanje_signaturer', 'INSERT'), 'kampanje_signaturer insert authenticated');
select pg_temp.krev(not has_table_privilege('anon', 'public.kampanje_signaturer', 'INSERT'), 'kampanje_signaturer insert anon er fortsatt borte');
select pg_temp.krev(has_table_privilege('authenticated', 'public.kampanjer', 'INSERT'), 'kampanjer insert authenticated');
select pg_temp.krev(has_table_privilege('anon', 'public.feedback', 'INSERT'), 'feedback insert anon');
select pg_temp.krev(has_table_privilege('authenticated', 'public.feedback', 'INSERT'), 'feedback insert authenticated');
select pg_temp.krev(has_column_privilege('authenticated', 'public.profiler', 'navn', 'UPDATE'), 'profiler navn update');
select pg_temp.krev(has_column_privilege('authenticated', 'public.profiler', 'geografisk', 'UPDATE'), 'profiler geografisk update');
select pg_temp.krev(not has_column_privilege('authenticated', 'public.profiler', 'epost', 'UPDATE'), 'profiler epost update er borte');
select pg_temp.krev(has_table_privilege('authenticated', 'public.horingssvar', 'SELECT'), 'horingssvar select eier');
select pg_temp.krev(has_table_privilege('authenticated', 'public.horingssvar', 'INSERT'), 'horingssvar insert eier');
select pg_temp.krev(has_table_privilege('authenticated', 'public.horingssvar', 'UPDATE'), 'horingssvar update eier');
select pg_temp.krev(has_table_privilege('authenticated', 'public.kommune_innspill', 'SELECT'), 'kommune_innspill select eier');
select pg_temp.krev(has_table_privilege('authenticated', 'public.kommune_innspill', 'INSERT'), 'kommune_innspill insert eier');

select pg_temp.krev(not has_function_privilege('anon', 'public.adapter_fra_kilde(text)', 'EXECUTE'), 'anon kan ikke kalle adapter_fra_kilde');
select pg_temp.krev(not has_function_privilege('authenticated', 'public.normaliser_kilde_url(text)', 'EXECUTE'), 'authenticated kan ikke kalle normaliser_kilde_url');
select pg_temp.krev(has_function_privilege('service_role', 'public.innhold_dedup_nokkel(text, text, date, text)', 'EXECUTE'), 'service_role kan kalle innhold_dedup_nokkel');
select pg_temp.krev(has_function_privilege('authenticated', 'public.geografisk_tokens_gyldige(text[])', 'EXECUTE'), 'authenticated beholder geografisk_tokens_gyldige');
select pg_temp.krev(not has_function_privilege('anon', 'public.geografisk_tokens_gyldige(text[])', 'EXECUTE'), 'anon kan ikke kalle geografisk_tokens_gyldige');
select pg_temp.krev(not has_function_privilege('anon', 'net.http_post()', 'EXECUTE'), 'anon kan ikke kalle net.http_post');
select pg_temp.krev(has_function_privilege('postgres', 'net.http_post()', 'EXECUTE'), 'postgres kan kalle net.http_post');

select pg_temp.krev(
  (select proconfig::text from pg_proc where proname = 'overstyr_varsel') like '%search_path=%',
  'overstyr_varsel har search_path'
);
select pg_temp.krev(
  (select proconfig::text from pg_proc where proname = 'overstyr_varsel') like '%search_path=%'
  and (select proconfig::text from pg_proc where proname = 'overstyr_varsel') not like '%public%',
  'overstyr_varsel search_path er tomt'
);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'ekte@example.com', now()),
  ('22222222-2222-2222-2222-222222222222', 'ubekreftet@example.com', null),
  ('33333333-3333-3333-3333-333333333333', 'abonnent@example.com', now());

insert into public.profiler (id, epost, varsler_aktive, fagfelt, geografisk, varsel_frekvens) values
  ('11111111-1111-1111-1111-111111111111', 'fremmed@example.com', false, '{}', '{}', 'daglig'),
  ('22222222-2222-2222-2222-222222222222', 'fremmed2@example.com', false, '{}', '{}', 'daglig'),
  ('33333333-3333-3333-3333-333333333333', 'ogsaa-fremmed@example.com', true, '{}', '{land}', 'ukentlig');

insert into public.varsler (id, tittel, kategori, niva) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Gammel tittel', 'musikk', 'nasjonalt');

insert into public.fulgte_saker (bruker_id, sak_id) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select pg_temp.krev(
  (select epost from public.mottakere_for_sak('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    where bruker_id = '11111111-1111-1111-1111-111111111111') = 'ekte@example.com',
  'bekreftet auth-e-post brukes, ikke profiler.epost'
);
select pg_temp.krev(
  (select epost from public.mottakere_for_sak('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    where bruker_id = '22222222-2222-2222-2222-222222222222') is null,
  'ubekreftet auth-e-post sendes ikke'
);
select pg_temp.krev(
  (select epost from public.mottakere_for_sak('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    where bruker_id = '33333333-3333-3333-3333-333333333333') = 'abonnent@example.com',
  'abonnement bruker bekreftet auth-e-post'
);
select pg_temp.krev(
  (select prosecdef from pg_proc where proname = 'mottakere_for_sak'),
  'mottakere_for_sak er security definer'
);
select pg_temp.krev(
  (select proconfig::text from pg_proc where proname = 'mottakere_for_sak') like '%search_path=%'
  and (select proconfig::text from pg_proc where proname = 'mottakere_for_sak') not like '%public%',
  'mottakere_for_sak har tom search_path'
);
select pg_temp.krev(
  not has_table_privilege('service_role', 'auth.users', 'SELECT'),
  'service_role har ikke select på auth.users'
);
select pg_temp.krev(
  not has_function_privilege('anon', 'public.mottakere_for_sak(uuid)', 'EXECUTE'),
  'anon kan ikke kalle mottakere_for_sak'
);
select pg_temp.krev(
  not has_function_privilege('authenticated', 'public.mottakere_for_sak(uuid)', 'EXECUTE'),
  'authenticated kan ikke kalle mottakere_for_sak'
);
select pg_temp.krev(
  has_function_privilege('service_role', 'public.mottakere_for_sak(uuid)', 'EXECUTE'),
  'service_role kan kalle mottakere_for_sak'
);

set role service_role;
create temp table _mottakere as
  select * from public.mottakere_for_sak('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
reset role;

select pg_temp.krev(
  (select epost from _mottakere where bruker_id = '11111111-1111-1111-1111-111111111111') = 'ekte@example.com',
  'service_role leser bekreftet e-post uten select på auth.users'
);
select pg_temp.krev(
  (select epost from _mottakere where bruker_id = '22222222-2222-2222-2222-222222222222') is null,
  'service_role får null for ubekreftet e-post'
);

select public.overstyr_varsel(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Ny tittel', null, null, 'test'
);
select pg_temp.krev(
  (select tittel from public.varsler where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 'Ny tittel',
  'overstyr_varsel virker med tom search_path'
);

insert into public.kampanjer (id, tittel, aktiv) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Kampanje', true);
insert into public.kommune_horinger (id, publisert) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', true);

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
set role authenticated;

insert into public.fulgte_saker (bruker_id, sak_id) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  on conflict do nothing;
delete from public.fulgte_saker
  where bruker_id = '11111111-1111-1111-1111-111111111111'
    and sak_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
insert into public.fulgte_saker (bruker_id, sak_id) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into public.aktivitet (bruker_id, type, tittel) values
  ('11111111-1111-1111-1111-111111111111', 'horing', 'Innspill');

insert into public.kampanje_signaturer (kampanje_id, bruker_id, navn, epost) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'Ada', 'ekte@example.com');

insert into public.kampanjer (tittel, beskrivelse, aktiv) values ('Forslag', 'Tekst', false);

insert into public.feedback (bruker_id, type, tekst) values
  ('11111111-1111-1111-1111-111111111111', 'forslag', 'Bra');

insert into public.lagrede_sok (bruker_id, navn, sporretekst) values
  ('11111111-1111-1111-1111-111111111111', 'skole', 'kulturskole');

update public.profiler set navn = 'Ada', geografisk = array['land'] where id = '11111111-1111-1111-1111-111111111111';

insert into public.horingssvar (bruker_id, sak_id, tekst) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Utkast');
update public.horingssvar set tekst = 'Endret utkast'
  where bruker_id = '11111111-1111-1111-1111-111111111111';

insert into public.kommune_innspill (horing_id, bruker_id, tekst, status) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'Innspill', 'ny');

reset role;

do $$
begin
  begin
    set role authenticated;
    update public.profiler set epost = 'kapret@example.com' where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'epost-update skulle feile';
  exception
    when insufficient_privilege then
      reset role;
  end;
end $$;

select pg_temp.krev(
  (select epost from public.profiler where id = '11111111-1111-1111-1111-111111111111') = 'fremmed@example.com',
  'profiler.epost ble ikke skrevet av authenticated'
);
select pg_temp.krev(
  (select navn from public.profiler where id = '11111111-1111-1111-1111-111111111111') = 'Ada',
  'profilens andre kolonner kan oppdateres'
);
select pg_temp.krev(
  (select count(*) from public.kampanje_signaturer) = 1,
  'egen signatur ble lagret'
);
select pg_temp.krev((select count(*) from public.horingssvar) = 1, 'eget høringssvar ble lagret');
select pg_temp.krev((select count(*) from public.kommune_innspill) = 1, 'eget kommuneinnspill ble lagret');
select pg_temp.krev((select count(*) from public.aktivitet) = 1, 'aktivitet ble lagret');
select pg_temp.krev((select count(*) from public.feedback) = 1, 'feedback ble lagret');
select pg_temp.krev((select count(*) from public.lagrede_sok) = 1, 'lagret søk ble lagret');

set role anon;
insert into public.feedback (bruker_id, type, tekst) values (null, 'feil', 'Anonym');
reset role;
select pg_temp.krev((select count(*) from public.feedback where bruker_id is null) = 1, 'anonym feedback ble lagret');

select pg_temp.krev(true, 'klientflyter etter innstramming');

rollback;

select pg_temp.krev(
  has_sequence_privilege('anon', 'public.kilde_kjoringer_id_seq', 'USAGE'),
  'rollback: anon har usage på sekvens igjen'
);
select pg_temp.krev(
  has_table_privilege('anon', 'public.kampanje_signaturer', 'MAINTAIN'),
  'rollback: maintain på kampanje_signaturer er tilbake'
);
select pg_temp.krev(
  has_table_privilege('anon', 'public.budsjett_cache', 'SELECT'),
  'rollback: select på budsjett_cache er tilbake'
);
select pg_temp.krev(
  has_column_privilege('authenticated', 'public.profiler', 'epost', 'UPDATE'),
  'rollback: update på profiler.epost er tilbake'
);
select pg_temp.krev(
  has_function_privilege('anon', 'public.adapter_fra_kilde(text)', 'EXECUTE'),
  'rollback: anon kan kalle adapter_fra_kilde igjen'
);
select pg_temp.krev(
  has_function_privilege('anon', 'net.http_post()', 'EXECUTE'),
  'rollback: anon kan kalle net.http_post igjen'
);

create table public._ny_etter_rollback (id int);
select pg_temp.krev(
  has_table_privilege('anon', 'public._ny_etter_rollback', 'INSERT'),
  'rollback: nye tabeller får anon-insert igjen'
);
drop table public._ny_etter_rollback;

select pg_temp.krev(
  (select proconfig::text from pg_proc where proname = 'overstyr_varsel') is null,
  'rollback: overstyr_varsel-endringen er borte'
);
select pg_temp.krev(
  not coalesce((select prosecdef from pg_proc where proname = 'mottakere_for_sak'), true),
  'rollback: mottakere_for_sak er security invoker igjen'
);
select pg_temp.krev(
  (select prosrc from pg_proc where proname = 'mottakere_for_sak') like '%p.epost%',
  'rollback: mottakere_for_sak bruker profiler.epost igjen'
);

select pg_temp.krev(true, 'rollback gjenopprettet rettighetene');
