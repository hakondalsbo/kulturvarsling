-- Baseline for Kulturvarsling, lest fra prod (zyyijlvmgoanjdzngmon) 2026-10-20.
-- Kun skjema. Ingen rader og ingen hemmelige verdier.
--
-- Idempotent mot prod: create ... if not exists, create or replace,
-- drop policy if exists, og roller/utvidelser som allerede finnes hoppes over.
-- Mot en tom database bygger filen public-skjemaet som senere migrasjoner
-- forutsetter. Disse objektene legges ikke her, fordi senere filer oppretter
-- dem uten if not exists:
--   varsler.kilde_nokkel og constraint varsler_kilde_nokkel_unik
--   kilde_kjoringer.alarm
--   view public.kilde_alarmer
--   policy les_kilder og les_kilde_kjoringer
--
-- 20260725180000 skriver om cron-jobben hent-saker-daglig, og
-- 20261020210000 skriver om vern_manuelt_redigerte_felt, til eldre
-- definisjoner enn prod. 20261021000000_baseline_avslutning.sql legger
-- prod-definisjonen tilbake etter dem. Ikke kjør historikken på nytt mot prod.

-- ---------------------------------------------------------------------------
-- Roller. Supabase har dem fra før. Tom Postgres får de tre API-rollene.
-- ---------------------------------------------------------------------------

do $roller$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$roller$;

-- ---------------------------------------------------------------------------
-- Utvidelser. pg_stat_statements og supabase_vault er plattformutvidelser:
-- de opprettes når de finnes, og hoppes over på en Postgres uten dem.
-- Vault-verdier ligger ikke her. Cron-jobbene leser bare disse navnene:
--   hent_saker_platform_jwt
--   hent_saker_cron_secret
-- ---------------------------------------------------------------------------

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $utvidelser$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_stat_statements') then
    begin
      create extension if not exists pg_stat_statements with schema extensions;
    exception
      when others then
        raise notice 'pg_stat_statements er ikke lastet i denne Postgres-instansen: %', sqlerrm;
    end;
  end if;

  if exists (select 1 from pg_available_extensions where name = 'supabase_vault') then
    create extension if not exists supabase_vault with schema vault;
  end if;
end
$utvidelser$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

-- auth.users og auth.uid() finnes i Supabase. Stubben brukes bare når de mangler,
-- slik at fremmednøkler og policies kan opprettes på en tom Postgres.
do $auth$
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    create schema auth;
  end if;

  if to_regclass('auth.users') is null then
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb
    );
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    create function auth.uid()
    returns uuid
    language sql
    stable
    as $body$
      select null::uuid
    $body$;
  end if;
end
$auth$;

-- ---------------------------------------------------------------------------
-- Funksjoner som ikke leser tabeller. SQL-funksjonen mottakere_for_sak
-- opprettes etter tabellene, fordi Postgres validerer SQL-kroppen med en gang.
-- ---------------------------------------------------------------------------

create or replace function public.geografisk_tokens_gyldige(tokens text[])
returns boolean
language sql
immutable
set search_path to 'pg_catalog'
as $fn$
  select tokens is null or not exists (
    select 1
    from unnest(tokens) as tok
    where tok !~ '^(land|niva:(nasjonalt|fylke|kommune)|fylke:[0-9]{2}|kommune:[0-9]{4}|sted:[^[:cntrl:]]{1,120})$'
  );
$fn$;

comment on function public.geografisk_tokens_gyldige(text[]) is
  'Sant når hvert geografisk-token er land, niva, fylke, kommune eller sted.';

create or replace function public.normaliser_kilde_url(raw text)
returns text
language plpgsql
immutable
set search_path to 'pg_catalog'
as $fn$
declare
  s text := btrim(raw);
  fragment text := '';
  query text := '';
  hash_pos int;
  q_pos int;
  scheme text;
  rest text;
  slash_pos int;
  authority text;
  path text;
  userinfo text := '';
  hostport text;
  at_pos int;
  qnorm text := '';
begin
  if s is null or s = '' then
    return null;
  end if;

  hash_pos := position('#' in s);
  if hash_pos > 0 then
    fragment := substring(s from hash_pos);
    s := substring(s from 1 for hash_pos - 1);
  end if;

  q_pos := position('?' in s);
  if q_pos > 0 then
    query := substring(s from q_pos + 1);
    s := substring(s from 1 for q_pos - 1);
  end if;

  if query <> '' then
    select coalesce(string_agg(part, '&' order by part collate "C"), '')
      into qnorm
    from unnest(string_to_array(query, '&')) as u(part)
    where part <> '';
  end if;

  if s ~* '^https?://' then
    scheme := lower((regexp_match(s, '^(https?)://', 'i'))[1]);
    rest := substring(s from length(scheme) + 4);
    slash_pos := position('/' in rest);
    if slash_pos = 0 then
      authority := rest;
      path := '';
    else
      authority := substring(rest from 1 for slash_pos - 1);
      path := substring(rest from slash_pos);
    end if;

    if position('@' in authority) > 0 then
      at_pos := length(authority) - position('@' in reverse(authority)) + 1;
      userinfo := substring(authority from 1 for at_pos);
      hostport := substring(authority from at_pos + 1);
    else
      hostport := authority;
    end if;
    hostport := lower(hostport);
    if scheme = 'http' and hostport ~ ':80$' then
      hostport := left(hostport, length(hostport) - 3);
    elsif scheme = 'https' and hostport ~ ':443$' then
      hostport := left(hostport, length(hostport) - 4);
    end if;
    if length(path) > 1 then
      path := regexp_replace(path, '/+$', '');
    end if;

    return scheme || '://' || userinfo || hostport || path
      || case when qnorm <> '' then '?' || qnorm else '' end
      || fragment;
  end if;

  if length(s) > 1 then
    s := regexp_replace(s, '/+$', '');
  end if;
  return s
    || case when qnorm <> '' then '?' || qnorm else '' end
    || fragment;
end
$fn$;

comment on function public.normaliser_kilde_url(text) is
  'Dedup-nøkkel for varsler.kilde. Samme regler som normaliserKildeUrl i hent-saker/logikk.ts. Ikke security definer.';

create or replace function public.normaliser_innhold_tekst(raw text)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $fn$
  select nullif(
    btrim(regexp_replace(
      translate(lower(raw), 'ÆØÅ', 'æøå'),
      '[^0-9a-zæøå]+',
      ' ',
      'g'
    )),
    ''
  );
$fn$;

comment on function public.normaliser_innhold_tekst(text) is
  'Sammenligningstekst for innholdsduplikater. Samme regler som normaliserInnholdTekst. Ikke security definer.';

create or replace function public.innhold_dedup_nokkel(instans text, tittel text, frist date, kilde text)
returns text
language plpgsql
immutable
set search_path to 'pg_catalog'
as $fn$
declare
  i text := public.normaliser_innhold_tekst(instans);
  t text := public.normaliser_innhold_tekst(tittel);
  sak text := '';
  m text[];
begin
  if i is null or t is null then
    return null;
  end if;

  if kilde is not null
    and kilde ~* 'stortinget\.no'
    and kilde !~* 'ventede-saker'
  then
    m := regexp_match(kilde, '[?&]p=([0-9]+)');
    if m is not null then
      sak := 'p=' || m[1];
    end if;
  end if;

  if sak = '' and kilde is not null and kilde ~* 'regjeringen\.no' then
    m := regexp_match(kilde, '/id([0-9]+)');
    if m is not null then
      sak := 'id' || m[1];
    end if;
  end if;

  if sak = ''
    and kilde is not null
    and kilde ~* 'kulturdirektoratet\.no'
    and position('#' in kilde) > 0
  then
    sak := lower(substring(kilde from position('#' in kilde)));
  end if;

  if sak = ''
    and kilde is not null
    and kilde ~* 'stortinget\.no'
    and position('#sak-' in lower(kilde)) > 0
  then
    sak := substring(lower(kilde) from position('#sak-' in lower(kilde)));
  end if;

  return i || '|' || t || '|' || coalesce(to_char(frist, 'YYYY-MM-DD'), '') || '|' || sak;
end
$fn$;

comment on function public.innhold_dedup_nokkel(text, text, date, text) is
  'Dedup-nøkkel: instans, normalisert tittel, frist og stabil sak-id. Ikke security definer.';

create or replace function public.adapter_fra_kilde(raw text)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $fn$
  select case
    when raw is null or btrim(raw) = '' then null
    when lower(raw) like '%stortinget.no%'
      and (lower(raw) like '%ventede-saker%' or lower(raw) like '%#sak-%')
      then 'stortinget-ventede'
    when lower(raw) like '%stortinget.no%' then 'stortinget-saker'
    when lower(raw) like '%regjeringen.no%' then 'regjeringen-rss'
    when lower(raw) like '%einnsyn.no%' then 'einnsyn'
    when lower(raw) like '%bergen.kommune.no%' then 'bergen'
    when lower(raw) like '%kulturdirektoratet.no%' then 'kulturdirektoratet'
    when lower(raw) like '%sametinget.no%' then 'sametinget'
    else null
  end;
$fn$;

comment on function public.adapter_fra_kilde(text) is
  'Mapper varsler.kilde til kilder.adapter. Samme regler som adapterFraKildeUrl. Ikke security definer.';

create or replace function public.sak_treffer_abonnement(
  sak_kategori text,
  sak_niva text,
  sak_fylkesnr text,
  sak_kommunenr text,
  sak_sted text,
  fagfelt text[],
  geografisk text[]
) returns boolean
language sql
immutable
set search_path to 'pg_catalog'
as $fn$
  select coalesce(
    (
      fagfelt is null
      or cardinality(fagfelt) = 0
      or sak_kategori = any (fagfelt)
    )
    and (
      geografisk is null
      or cardinality(geografisk) = 0
      or 'land' = any (geografisk)
      or (sak_niva is not null and ('niva:' || sak_niva) = any (geografisk))
      or (
        nullif(btrim(sak_fylkesnr), '') is not null
        and ('fylke:' || btrim(sak_fylkesnr)) = any (geografisk)
      )
      or (
        nullif(btrim(sak_kommunenr), '') is not null
        and ('kommune:' || btrim(sak_kommunenr)) = any (geografisk)
      )
      or (
        nullif(btrim(sak_sted), '') is not null
        and ('sted:' || lower(btrim(sak_sted))) = any (geografisk)
      )
    ),
    false
  );
$fn$;

comment on function public.sak_treffer_abonnement(text, text, text, text, text, text[], text[]) is
  'Om en sak treffer fag- og geografifilter. Tomme lister betyr alle fag og hele landet.';

create or replace function public.beskytt_profil_betaling()
returns trigger
language plpgsql
set search_path to ''
as $fn$
begin
  if current_user in ('anon', 'authenticated') then
    if TG_OP = 'INSERT' then
      if new.plan is distinct from 'gratis' or new.stripe_customer_id is not null then
        raise exception 'Betalingsstatus kan bare endres av serveren' using errcode = '42501';
      end if;
    elsif new.plan is distinct from old.plan
       or new.stripe_customer_id is distinct from old.stripe_customer_id then
      raise exception 'Betalingsstatus kan bare endres av serveren' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$fn$;

comment on function public.beskytt_profil_betaling() is
  'Hindrer anon og authenticated i å sette plan eller stripe_customer_id. service_role slipper gjennom.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
begin
  insert into public.profiler (id, epost, navn)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'navn', split_part(new.email,'@',1))
  );
  return new;
end;
$fn$;

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $fn$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table','partitioned table')
  loop
     if cmd.schema_name is not null and cmd.schema_name in ('public') and cmd.schema_name not in ('pg_catalog','information_schema') and cmd.schema_name not like 'pg_toast%' and cmd.schema_name not like 'pg_temp%' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
     else
        raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     end if;
  end loop;
end;
$fn$;

create or replace function public.reserver_ai_kvote(p_bruker uuid, p_oppgave text, p_grense integer)
returns boolean
language plpgsql
set search_path to ''
as $fn$
declare reservert integer;
begin
  if p_grense < 1 or p_grense > 120 then return false; end if;
  insert into public.ai_dognkvoter (bruker_id, oppgave, dato, antall)
  values (p_bruker, p_oppgave, (now() at time zone 'Europe/Oslo')::date, 1)
  on conflict (bruker_id, oppgave, dato) do update
    set antall = public.ai_dognkvoter.antall + 1
    where public.ai_dognkvoter.antall < p_grense
  returning antall into reservert;
  return reservert is not null;
end;
$fn$;

create or replace function public.vern_manuelt_redigerte_felt()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $fn$
declare
  hvem text;
begin
  if new.manuelt_redigert and not coalesce(old.manuelt_redigert, false) then
    if new.manuelt_redigert_at is null then
      new.manuelt_redigert_at := now();
    end if;
  end if;

  if old.manuelt_redigert
     and (
       new.tittel is distinct from old.tittel
       or new.sammendrag is distinct from old.sammendrag
       or new.kategori is distinct from old.kategori
       or new.frist is distinct from old.frist
       or new.motedato is distinct from old.motedato
       or new.status is distinct from old.status
     )
  then
    if coalesce(pg_catalog.current_setting('app.varsel_overstyr', true), '') = '1' then
      hvem := coalesce(nullif(pg_catalog.current_setting('app.varsel_hvem', true), ''), 'ukjent');
      if new.tittel is distinct from old.tittel then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'tittel', old.tittel, new.tittel, hvem);
      end if;
      if new.sammendrag is distinct from old.sammendrag then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'sammendrag', old.sammendrag, new.sammendrag, hvem);
      end if;
      if new.kategori is distinct from old.kategori then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'kategori', old.kategori, new.kategori, hvem);
      end if;
      if new.frist is distinct from old.frist then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'frist', old.frist::text, new.frist::text, hvem);
      end if;
      if new.motedato is distinct from old.motedato then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'motedato', old.motedato::text, new.motedato::text, hvem);
      end if;
      if new.status is distinct from old.status then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'status', old.status, new.status, hvem);
      end if;
    else
      raise exception 'Kan ikke endre tittel, sammendrag, kategori, frist, møtedato eller status fordi saken er manuelt redigert. Bruk overstyr_varsel.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end
$fn$;

comment on function public.vern_manuelt_redigerte_felt() is
  'BEFORE UPDATE: feiler tydelig hvis tittel, sammendrag, kategori, frist, møtedato eller status endres på en manuelt redigert sak, også når feltet var tomt. Slipper endringen gjennom bare når overstyr_varsel har satt app.varsel_overstyr i transaksjonen, og logger da feltet.';

create or replace function public.overstyr_varsel(
  p_id uuid,
  p_tittel text,
  p_sammendrag text,
  p_kategori text,
  p_hvem text,
  p_frist date default null,
  p_motedato date default null,
  p_status text default null
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  rolle text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json->>'role',
    nullif(current_setting('request.jwt.claim.role', true), ''),
    session_user
  );
begin
  if rolle not in ('service_role', 'postgres') then
    raise exception 'overstyr_varsel kan bare kalles av service_role eller postgres'
      using errcode = '42501';
  end if;
  if p_hvem is null or length(btrim(p_hvem)) = 0 then
    raise exception 'overstyr_varsel krever hvem som gjør endringen'
      using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('kritisk', 'viktig', 'normal', 'passert') then
    raise exception 'overstyr_varsel godtar bare status kritisk, viktig, normal eller passert'
      using errcode = '23514';
  end if;

  perform set_config('app.varsel_overstyr', '1', true);
  perform set_config('app.varsel_hvem', left(btrim(p_hvem), 200), true);

  update public.varsler
  set
    tittel = coalesce(p_tittel, tittel),
    sammendrag = coalesce(p_sammendrag, sammendrag),
    kategori = coalesce(p_kategori, kategori),
    frist = coalesce(p_frist, frist),
    motedato = coalesce(p_motedato, motedato),
    status = coalesce(p_status, status)
  where id = p_id;

  if not found then
    raise exception 'Fant ikke saken som skulle overstyres'
      using errcode = 'P0002';
  end if;
end
$fn$;

comment on function public.overstyr_varsel(uuid, text, text, text, text, date, date, text) is
  'Eneste vei til å endre låst tittel, sammendrag, kategori, frist, møtedato eller status. Null-argument lar feltet stå. Setter app.varsel_overstyr for transaksjonen og logger via triggeren. SECURITY DEFINER, bare service_role og postgres.';

-- ---------------------------------------------------------------------------
-- Tabeller. kilde_nokkel og alarm kommer i senere migrasjoner.
-- ---------------------------------------------------------------------------

create table if not exists public.kilder (
  id uuid primary key default gen_random_uuid(),
  navn text not null,
  niva text not null,
  organ text not null,
  kommunenr text,
  fylkesnr text,
  adapter text not null,
  config jsonb not null default '{}'::jsonb,
  aktiv boolean default true,
  prioritet integer default 3,
  sist_hentet timestamp with time zone,
  sist_status text,
  forventer_treff boolean not null default false,
  constraint kilder_niva_check check (niva = any (array['nasjonalt'::text, 'fylke'::text, 'kommune'::text]))
);

comment on column public.kilder.forventer_treff is
  'Når sant: 0 råtreff er feil_tomt_svar, ikke tom. Kilder som normalt har et korpus.';

create table if not exists public.kilde_kjoringer (
  id bigint generated always as identity primary key,
  kilde_id uuid,
  kjort timestamp with time zone default now(),
  status text not null,
  antall_funnet integer,
  antall_nye integer,
  feilmelding text,
  varighet_ms integer,
  http_status integer,
  antall_etter_filter integer,
  kjoert_av text,
  constraint kilde_kjoringer_kilde_id_fkey foreign key (kilde_id) references public.kilder (id)
);

comment on column public.kilde_kjoringer.antall_funnet is
  'Råtreff før nøkkelordfilter og før dedup (raatt_antall).';
comment on column public.kilde_kjoringer.antall_etter_filter is
  'Antall etter relevans-/nøkkelordfilter, før dedup mot lagrede varsler.';
comment on column public.kilde_kjoringer.http_status is
  'HTTP-status for vellykket kall, for feil_http/feil_auth, eller første feilende kall ved delvis. Også satt ved feil_tomt_svar når kroppen var 200 med 0 treff.';
comment on column public.kilde_kjoringer.kjoert_av is
  'supabase_cron | vercel_cron | manuell. Utledes av body.utlost_av / header.';
comment on column public.kilde_kjoringer.status is
  'ok_nye | ok_ingen_nye | tom | delvis | feil_http | feil_timeout | feil_parse | feil_auth | feil_nett | feil_tomt_svar | feil_manglende_frist. Ikke en verdi i varsler.status.';

create table if not exists public.varsler (
  id uuid primary key default extensions.uuid_generate_v4(),
  tittel text not null,
  sammendrag text,
  instans text,
  kilde text,
  frist date,
  kategori text,
  niva text,
  sted text,
  status text default 'normal'::text,
  publisert boolean default true,
  opprettet timestamp with time zone default now(),
  oppdatert timestamp with time zone default now(),
  kilde_id uuid,
  kommunenr text,
  fylkesnr text,
  klartekst text,
  sakstype text,
  manuelt_redigert boolean not null default false,
  manuelt_redigert_at timestamp with time zone,
  motedato date,
  hovedsak_id uuid,
  constraint varsler_niva_check check (niva = any (array['nasjonalt'::text, 'fylke'::text, 'kommune'::text])),
  constraint varsler_status_check check (status = any (array['kritisk'::text, 'viktig'::text, 'normal'::text, 'passert'::text])),
  constraint varsler_kilde_id_fkey foreign key (kilde_id) references public.kilder (id),
  constraint varsler_hovedsak_id_fkey foreign key (hovedsak_id) references public.varsler (id) on delete set null
);

comment on column public.varsler.status is
  'kritisk | viktig | normal | passert. Settes fra frist, ellers motedato, unntatt rader med manuelt_redigert. Uten dato er verdien normal.';
comment on column public.varsler.kilde_id is
  'UUID i kilder. Nullable fordi eldre rader uten kjent adapter (Stavanger-frøet) ikke kan mappes.';
comment on column public.varsler.manuelt_redigert is
  'Sant når en redaktør har satt tittel, sammendrag eller kategori. De tre feltene skal ikke overskrives av backfill, klartekst eller geografi. Manglende frist kan fortsatt settes.';
comment on column public.varsler.manuelt_redigert_at is
  'Når manuelt_redigert ble satt. Fylles av triggeren hvis oppdateringen ikke satte tidspunktet selv.';
comment on column public.varsler.motedato is
  'Møtedag for politiske saker uten høringsfrist. Status bruker frist først, deretter denne.';
comment on column public.varsler.hovedsak_id is
  'Nyhet eller tale som gjelder samme sak som en høring eller hovedpressemelding. Raden skal ikke publiseres.';

create table if not exists public.profiler (
  id uuid primary key,
  navn text,
  epost text,
  org text,
  org_type text,
  fagfelt text[] default '{}'::text[],
  geografisk text[] default '{}'::text[],
  varsel_frekvens text default 'daglig'::text,
  plan text default 'gratis'::text,
  onboarding_done boolean default false,
  opprettet timestamp with time zone default now(),
  oppdatert timestamp with time zone default now(),
  kommunenr text,
  fylkesnr text,
  stripe_customer_id text,
  personvern_akseptert_at timestamp with time zone,
  personvern_versjon text,
  varsler_aktive boolean not null default false,
  constraint profiler_id_fkey foreign key (id) references auth.users (id) on delete cascade,
  constraint profiler_org_type_check check (org_type = any (array['organisasjon'::text, 'kunstner'::text, 'institusjon'::text, 'annet'::text])),
  constraint profiler_varsel_frekvens_check check (varsel_frekvens = any (array['straks'::text, 'daglig'::text, 'ukentlig'::text])),
  constraint profiler_plan_check check (plan = any (array['gratis'::text, 'premium'::text])),
  constraint profiler_geografisk_token check (public.geografisk_tokens_gyldige(geografisk))
);

comment on column public.profiler.fagfelt is
  'Fagområder brukeren følger. Tom liste betyr alle fag når varsler_aktive er sann.';
comment on column public.profiler.geografisk is
  'Geografi-tokens: land, niva:nasjonalt|fylke|kommune, fylke:NN, kommune:NNNN, sted:<små bokstaver>. Tom liste betyr hele landet når varsler_aktive er sann.';
comment on column public.profiler.personvern_versjon is
  'Versjon av personvernerklæringen som ble akseptert, f.eks. personvern-2026-10.';
comment on column public.profiler.varsler_aktive is
  'Om brukeren vil ha varsler for fagfelt og geografisk. Fulgte saker er uavhengig av denne.';

create table if not exists public.kampanjer (
  id uuid primary key default extensions.uuid_generate_v4(),
  tittel text not null,
  beskrivelse text,
  mal integer default 1000,
  kategori text,
  sak_id uuid,
  tags text[] default '{}'::text[],
  dager integer default 30,
  aktiv boolean default true,
  opprettet timestamp with time zone default now(),
  constraint kampanjer_sak_id_fkey foreign key (sak_id) references public.varsler (id) on delete set null
);

create table if not exists public.kampanje_signaturer (
  id uuid primary key default extensions.uuid_generate_v4(),
  kampanje_id uuid not null,
  bruker_id uuid,
  navn text,
  epost text,
  opprettet timestamp with time zone default now(),
  constraint kampanje_signaturer_kampanje_id_fkey foreign key (kampanje_id) references public.kampanjer (id) on delete cascade,
  constraint kampanje_signaturer_bruker_id_fkey foreign key (bruker_id) references public.profiler (id) on delete cascade,
  constraint kampanje_signaturer_kampanje_id_bruker_id_key unique (kampanje_id, bruker_id),
  constraint kampanje_signaturer_kampanje_id_epost_key unique (kampanje_id, epost)
);

create table if not exists public.fulgte_saker (
  bruker_id uuid not null,
  sak_id uuid not null,
  opprettet timestamp with time zone default now(),
  constraint fulgte_saker_pkey primary key (bruker_id, sak_id),
  constraint fulgte_saker_bruker_id_fkey foreign key (bruker_id) references public.profiler (id) on delete cascade,
  constraint fulgte_saker_sak_id_fkey foreign key (sak_id) references public.varsler (id) on delete cascade
);

create table if not exists public.aktivitet (
  id uuid primary key default extensions.uuid_generate_v4(),
  bruker_id uuid,
  type text,
  tittel text,
  sak_id uuid,
  mottaker text,
  status text default 'sendt'::text,
  opprettet timestamp with time zone default now(),
  constraint aktivitet_type_check check (type = any (array['horing'::text, 'kampanje'::text, 'politiker'::text, 'pressemelding'::text])),
  constraint aktivitet_bruker_id_fkey foreign key (bruker_id) references public.profiler (id) on delete cascade,
  constraint aktivitet_sak_id_fkey foreign key (sak_id) references public.varsler (id) on delete set null
);

create table if not exists public.horingssvar (
  id uuid primary key default extensions.uuid_generate_v4(),
  bruker_id uuid,
  sak_id uuid,
  org text,
  tekst text not null,
  sendt_til text,
  opprettet timestamp with time zone default now(),
  constraint horingssvar_bruker_id_fkey foreign key (bruker_id) references public.profiler (id) on delete set null,
  constraint horingssvar_sak_id_fkey foreign key (sak_id) references public.varsler (id) on delete cascade
);

create table if not exists public.epost_varsler (
  id uuid primary key default extensions.uuid_generate_v4(),
  bruker_id uuid,
  sak_id uuid,
  sendt_dato timestamp with time zone default now(),
  constraint epost_varsler_bruker_id_sak_id_key unique (bruker_id, sak_id),
  constraint epost_varsler_bruker_id_fkey foreign key (bruker_id) references public.profiler (id) on delete cascade,
  constraint epost_varsler_sak_id_fkey foreign key (sak_id) references public.varsler (id) on delete cascade
);

create table if not exists public.feedback (
  id uuid primary key default extensions.uuid_generate_v4(),
  bruker_id uuid,
  type text,
  tekst text not null,
  sak_tittel text,
  status text default 'ny'::text,
  opprettet timestamp with time zone default now(),
  constraint feedback_type_check check (type = any (array['feil'::text, 'mangler'::text, 'utdatert'::text, 'forslag'::text, 'annet'::text])),
  constraint feedback_bruker_id_fkey foreign key (bruker_id) references public.profiler (id) on delete set null
);

create table if not exists public.kommuner (
  id uuid primary key default extensions.uuid_generate_v4(),
  navn text not null,
  orgnr text,
  kontakt_epost text,
  aktiv boolean default true,
  opprettet timestamp with time zone default now()
);

create table if not exists public.kommune_brukere (
  id uuid primary key,
  kommune_id uuid,
  navn text,
  epost text,
  rolle text default 'saksbehandler'::text,
  opprettet timestamp with time zone default now(),
  constraint kommune_brukere_id_fkey foreign key (id) references auth.users (id) on delete cascade,
  constraint kommune_brukere_kommune_id_fkey foreign key (kommune_id) references public.kommuner (id) on delete cascade
);

create table if not exists public.kommune_horinger (
  id uuid primary key default extensions.uuid_generate_v4(),
  kommune_id uuid,
  tittel text not null,
  beskrivelse text,
  kategori text,
  frist date,
  status text default 'aktiv'::text,
  publisert boolean default false,
  varslet integer default 0,
  opprettet timestamp with time zone default now(),
  constraint kommune_horinger_status_check check (status = any (array['aktiv'::text, 'avsluttet'::text, 'utkast'::text])),
  constraint kommune_horinger_kommune_id_fkey foreign key (kommune_id) references public.kommuner (id) on delete cascade
);

create table if not exists public.kommune_innspill (
  id uuid primary key default extensions.uuid_generate_v4(),
  horing_id uuid,
  org text,
  tekst text not null,
  status text default 'ny'::text,
  tags text[] default '{}'::text[],
  svar_tekst text,
  svar_dato timestamp with time zone,
  opprettet timestamp with time zone default now(),
  constraint kommune_innspill_status_check check (status = any (array['ny'::text, 'lest'::text, 'besvart'::text])),
  constraint kommune_innspill_horing_id_fkey foreign key (horing_id) references public.kommune_horinger (id) on delete cascade
);

create table if not exists public.pamelding (
  id bigint generated by default as identity primary key,
  epost text not null,
  fornavn text,
  etternavn text,
  samtykke_gitt_at timestamp with time zone,
  samtykke_tekst_versjon text,
  kilde text,
  bekreftet_at timestamp with time zone,
  avmeldt_at timestamp with time zone,
  avmeldings_token uuid default gen_random_uuid(),
  bekreftelses_token uuid,
  epost_normalisert text generated always as (lower(btrim(epost))) stored,
  bekreftelse_sendt_at timestamp with time zone
);

comment on column public.pamelding.samtykke_gitt_at is
  'Tidspunkt da et dokumentert samtykke ble lagret. NULL betyr at samtykket ikke er dokumentert.';
comment on column public.pamelding.kilde is
  'Opphav. Historiske skjemarader får pamelding-skjema. Nye skjema setter venteside.';
comment on column public.pamelding.bekreftet_at is
  'Dobbel opt-in. NULL betyr at bekreftelseslenken ikke er klikket.';
comment on column public.pamelding.avmeldt_at is
  'Satt når mottakeren melder seg av. NULL betyr ikke avmeldt.';
comment on column public.pamelding.bekreftelse_sendt_at is
  'Når Resend aksepterte bekreftelses-e-posten. NULL betyr ventende bekreftelse, ikke at raden er bekreftet.';

create table if not exists public.samtykke_tekster (
  versjon text primary key,
  tekst text not null,
  gyldig_fra timestamp with time zone not null default now()
);

create table if not exists public.nyhetsbrev_utsendelser (
  id bigint generated always as identity primary key,
  utsendelse_id uuid not null,
  pamelding_id bigint,
  sendt_at timestamp with time zone not null default now(),
  resend_id text,
  status text not null,
  constraint nyhetsbrev_utsendelser_pamelding_id_fkey foreign key (pamelding_id) references public.pamelding (id) on delete cascade
);

create table if not exists public.meld_pa_forsok (
  id bigint generated always as identity primary key,
  nokkel text not null,
  opprettet_at timestamp with time zone not null default now()
);

create table if not exists public.bekreftelse_utsendelser (
  id bigint generated always as identity primary key,
  pamelding_id bigint,
  epost_normalisert text not null,
  resend_id text,
  status text not null,
  sendt_at timestamp with time zone not null default now(),
  constraint bekreftelse_utsendelser_status_chk check (status = any (array['sendt'::text, 'feilet'::text, 'ikke_konfigurert'::text, 'duplikat'::text])),
  constraint bekreftelse_utsendelser_pamelding_id_fkey foreign key (pamelding_id) references public.pamelding (id) on delete cascade
);

comment on table public.bekreftelse_utsendelser is
  'Logg for bekreftelses-e-post fra meld-pa og den manuelle funksjonen send-bekreftelser. Ikke en tidsplan.';

create table if not exists public.klartekst_cache (
  id uuid primary key default gen_random_uuid(),
  varsel_id uuid not null,
  profil_nokkel text not null,
  svar jsonb not null,
  opprettet timestamp with time zone not null default now(),
  constraint klartekst_cache_varsel_id_fkey foreign key (varsel_id) references public.varsler (id) on delete cascade,
  constraint klartekst_cache_varsel_id_profil_nokkel_key unique (varsel_id, profil_nokkel)
);

create table if not exists public.budsjett_cache (
  kommunenr text primary key,
  data jsonb not null,
  opprettet timestamp with time zone not null default now()
);

create table if not exists public.ai_dognkvoter (
  bruker_id uuid not null,
  oppgave text not null,
  dato date not null,
  antall integer not null,
  constraint ai_dognkvoter_pkey primary key (bruker_id, oppgave, dato),
  constraint ai_dognkvoter_antall_check check (antall > 0),
  constraint ai_dognkvoter_oppgave_check check (oppgave = any (array['klartekst'::text, 'budsjett'::text])),
  constraint ai_dognkvoter_bruker_id_fkey foreign key (bruker_id) references auth.users (id) on delete cascade
);

create table if not exists public.varsel_endringslogg (
  id uuid primary key default gen_random_uuid(),
  varsel_id uuid not null,
  felt text not null,
  fra_verdi text,
  til_verdi text,
  hvem text not null,
  endret timestamp with time zone not null default now(),
  constraint varsel_endringslogg_varsel_id_fkey foreign key (varsel_id) references public.varsler (id) on delete cascade
);

comment on table public.varsel_endringslogg is
  'Tekstendringer som er sluppet gjennom manuelt_redigert via overstyr_varsel. Hvem, felt og tidspunkt.';

-- ---------------------------------------------------------------------------
-- Indekser som ikke allerede er laget av en constraint.
-- ---------------------------------------------------------------------------

create unique index if not exists kilder_adapter_unik on public.kilder using btree (adapter);
create index if not exists aktivitet_bruker_idx on public.aktivitet using btree (bruker_id);
create index if not exists bekreftelse_utsendelser_pamelding_idx on public.bekreftelse_utsendelser using btree (pamelding_id);
create unique index if not exists bekreftelse_utsendelser_sendt_unik
  on public.bekreftelse_utsendelser using btree (pamelding_id)
  where status = 'sendt'::text and pamelding_id is not null;
create index if not exists fulgte_bruker_idx on public.fulgte_saker using btree (bruker_id);
create index if not exists fulgte_saker_sak_idx on public.fulgte_saker using btree (sak_id);
create index if not exists kampanjer_sak_id_idx on public.kampanjer using btree (sak_id);
create index if not exists meld_pa_forsok_nokkel_tid_idx on public.meld_pa_forsok using btree (nokkel, opprettet_at desc);
create index if not exists nyhetsbrev_utsendelser_pamelding_idx on public.nyhetsbrev_utsendelser using btree (pamelding_id);
create index if not exists nyhetsbrev_utsendelser_utsendelse_idx on public.nyhetsbrev_utsendelser using btree (utsendelse_id);
create unique index if not exists pamelding_avmeldings_token_idx on public.pamelding using btree (avmeldings_token);
create unique index if not exists pamelding_bekreftelses_token_idx on public.pamelding using btree (bekreftelses_token);
create index if not exists pamelding_epost_normalisert_idx on public.pamelding using btree (epost_normalisert);
create unique index if not exists pamelding_epost_unik on public.pamelding using btree (epost_normalisert);
create index if not exists pamelding_klar_til_utsending_idx
  on public.pamelding using btree (epost_normalisert)
  where samtykke_gitt_at is not null and bekreftet_at is not null and avmeldt_at is null;
create index if not exists pamelding_venter_bekreftelse_idx
  on public.pamelding using btree (id)
  where bekreftelse_sendt_at is null and bekreftet_at is null and avmeldt_at is null and samtykke_gitt_at is not null;
create index if not exists profiler_stripe_customer_idx on public.profiler using btree (stripe_customer_id);
create index if not exists profiler_varsler_aktive_idx on public.profiler using btree (id) where varsler_aktive;
create index if not exists varsler_frist_idx on public.varsler using btree (frist);
create index if not exists varsler_kategori_idx on public.varsler using btree (kategori);
create index if not exists varsler_niva_idx on public.varsler using btree (niva);
create index if not exists varsler_status_idx on public.varsler using btree (status);

-- ---------------------------------------------------------------------------
-- Funksjoner som leser tabellene.
-- ---------------------------------------------------------------------------

create or replace function public.mottakere_for_sak(p_sak_id uuid)
returns table (
  bruker_id uuid,
  epost text,
  varsel_frekvens text,
  grunn text
)
language sql
stable
security invoker
set search_path to 'pg_catalog', 'public'
as $fn$
  select distinct on (q.bruker_id)
    q.bruker_id,
    q.epost,
    q.varsel_frekvens,
    q.grunn
  from (
    select
      p.id as bruker_id,
      coalesce(nullif(btrim(p.epost), ''), u.email) as epost,
      p.varsel_frekvens,
      'sak'::text as grunn,
      0 as prioritet
    from public.fulgte_saker f
    join public.profiler p on p.id = f.bruker_id
    left join auth.users u on u.id = p.id
    where f.sak_id = p_sak_id

    union all

    select
      p.id,
      coalesce(nullif(btrim(p.epost), ''), u.email),
      p.varsel_frekvens,
      'abonnement'::text,
      1
    from public.varsler v
    join public.profiler p on p.varsler_aktive
    left join auth.users u on u.id = p.id
    where v.id = p_sak_id
      and public.sak_treffer_abonnement(
        v.kategori, v.niva, v.fylkesnr, v.kommunenr, v.sted, p.fagfelt, p.geografisk
      )
  ) q
  order by q.bruker_id, q.prioritet;
$fn$;

comment on function public.mottakere_for_sak(uuid) is
  'Mottakere for en sak: fulgte saker (grunn sak) og aktive abonnement som treffer fag og geografi (grunn abonnement). Frekvens returneres, filtreres ikke. Sender ingen e-post.';

revoke all on function public.beskytt_profil_betaling() from public, anon, authenticated;
grant execute on function public.beskytt_profil_betaling() to service_role;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role;

revoke all on function public.mottakere_for_sak(uuid) from public, anon, authenticated;
grant execute on function public.mottakere_for_sak(uuid) to service_role;

revoke all on function public.overstyr_varsel(uuid, text, text, text, text, date, date, text) from public, anon, authenticated;
grant execute on function public.overstyr_varsel(uuid, text, text, text, text, date, date, text) to service_role;

revoke all on function public.reserver_ai_kvote(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.reserver_ai_kvote(uuid, text, integer) to service_role;

revoke all on function public.rls_auto_enable() from public, anon, authenticated;
grant execute on function public.rls_auto_enable() to service_role;

revoke all on function public.sak_treffer_abonnement(text, text, text, text, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.sak_treffer_abonnement(text, text, text, text, text, text[], text[]) to service_role;

revoke all on function public.vern_manuelt_redigerte_felt() from public, anon;
grant execute on function public.vern_manuelt_redigerte_felt() to authenticated, service_role;

-- Åpne hjelpefunksjoner skal kunne kalles av klienten, som i prod.
grant execute on function public.adapter_fra_kilde(text) to public, anon, authenticated, service_role;
grant execute on function public.geografisk_tokens_gyldige(text[]) to public, anon, authenticated, service_role;
grant execute on function public.innhold_dedup_nokkel(text, text, date, text) to public, anon, authenticated, service_role;
grant execute on function public.normaliser_innhold_tekst(text) to public, anon, authenticated, service_role;
grant execute on function public.normaliser_kilde_url(text) to public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- View, RLS og policies.
-- les_kilder og les_kilde_kjoringer opprettes av 20260725120000.
-- ---------------------------------------------------------------------------

create or replace view public.kampanje_med_signaturer
with (security_invoker = true) as
select
  k.id,
  k.tittel,
  k.beskrivelse,
  k.mal,
  k.kategori,
  k.sak_id,
  k.tags,
  k.dager,
  k.aktiv,
  k.opprettet,
  count(s.id)::integer as signaturer
from public.kampanjer k
left join public.kampanje_signaturer s on s.kampanje_id = k.id
group by k.id;

alter table public.ai_dognkvoter enable row level security;
alter table public.aktivitet enable row level security;
alter table public.bekreftelse_utsendelser enable row level security;
alter table public.budsjett_cache enable row level security;
alter table public.epost_varsler enable row level security;
alter table public.feedback enable row level security;
alter table public.fulgte_saker enable row level security;
alter table public.horingssvar enable row level security;
alter table public.kampanje_signaturer enable row level security;
alter table public.kampanjer enable row level security;
alter table public.kilde_kjoringer enable row level security;
alter table public.kilder enable row level security;
alter table public.klartekst_cache enable row level security;
alter table public.kommune_brukere enable row level security;
alter table public.kommune_horinger enable row level security;
alter table public.kommune_innspill enable row level security;
alter table public.kommuner enable row level security;
alter table public.meld_pa_forsok enable row level security;
alter table public.nyhetsbrev_utsendelser enable row level security;
alter table public.pamelding enable row level security;
alter table public.profiler enable row level security;
alter table public.samtykke_tekster enable row level security;
alter table public.varsel_endringslogg enable row level security;
alter table public.varsler enable row level security;

drop policy if exists "Egen aktivitet" on public.aktivitet;
create policy "Egen aktivitet" on public.aktivitet
  for all to public
  using (auth.uid() = bruker_id);

drop policy if exists "Egne epost-varsler" on public.epost_varsler;
create policy "Egne epost-varsler" on public.epost_varsler
  for all to public
  using (auth.uid() = bruker_id);

drop policy if exists "Send feedback" on public.feedback;
create policy "Send feedback" on public.feedback
  for insert to public
  with check ((auth.uid() = bruker_id) or (bruker_id is null));

drop policy if exists "Egne fulgte" on public.fulgte_saker;
create policy "Egne fulgte" on public.fulgte_saker
  for all to public
  using (auth.uid() = bruker_id);

drop policy if exists "Les horing" on public.horingssvar;
create policy "Les horing" on public.horingssvar
  for select to public
  using (true);

drop policy if exists "Send horing" on public.horingssvar;
create policy "Send horing" on public.horingssvar
  for insert to public
  with check (auth.uid() = bruker_id);

drop policy if exists "Les signaturer" on public.kampanje_signaturer;
create policy "Les signaturer" on public.kampanje_signaturer
  for select to public
  using (true);

drop policy if exists "Signer" on public.kampanje_signaturer;
create policy "Signer" on public.kampanje_signaturer
  for insert to public
  with check ((auth.uid() = bruker_id) or (bruker_id is null));

drop policy if exists "Les kampanjer" on public.kampanjer;
create policy "Les kampanjer" on public.kampanjer
  for select to public
  using (aktiv = true);

drop policy if exists "foreslaa_kampanje" on public.kampanjer;
create policy "foreslaa_kampanje" on public.kampanjer
  for insert to public
  with check (aktiv = false);

drop policy if exists "Les kom-horinger" on public.kommune_horinger;
create policy "Les kom-horinger" on public.kommune_horinger
  for select to public
  using (publisert = true);

drop policy if exists "Les innspill" on public.kommune_innspill;
create policy "Les innspill" on public.kommune_innspill
  for select to public
  using (true);

drop policy if exists "Send innspill" on public.kommune_innspill;
create policy "Send innspill" on public.kommune_innspill
  for insert to public
  with check (true);

drop policy if exists "Eget profil" on public.profiler;
create policy "Eget profil" on public.profiler
  for all to public
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Les varsler" on public.varsler;
create policy "Les varsler" on public.varsler
  for select to public
  using (publisert = true);

-- ---------------------------------------------------------------------------
-- Grants. Nye tabeller arver full tilgang til API-rollene. Her strammes
-- det inn der prod ikke gir anon/authenticated tabelltilgang.
-- ---------------------------------------------------------------------------

revoke all on table public.ai_dognkvoter from anon, authenticated, public;
grant all on table public.ai_dognkvoter to service_role;

revoke all on table public.bekreftelse_utsendelser from anon, authenticated, public;
grant all on table public.bekreftelse_utsendelser to service_role;

revoke all on table public.meld_pa_forsok from anon, authenticated, public;
grant all on table public.meld_pa_forsok to service_role;

revoke all on table public.nyhetsbrev_utsendelser from anon, authenticated, public;
grant all on table public.nyhetsbrev_utsendelser to service_role;

revoke all on table public.pamelding from anon, authenticated, public;
grant all on table public.pamelding to service_role;

revoke all on table public.samtykke_tekster from anon, authenticated, public;
grant all on table public.samtykke_tekster to service_role;

revoke all on table public.varsel_endringslogg from anon, authenticated, service_role, public;
grant select, insert, references, trigger on table public.varsel_endringslogg to service_role;

revoke update on table public.profiler from anon, authenticated;
grant update (
  navn,
  epost,
  org,
  org_type,
  fagfelt,
  geografisk,
  varsel_frekvens,
  onboarding_done,
  opprettet,
  oppdatert,
  kommunenr,
  fylkesnr,
  personvern_akseptert_at,
  personvern_versjon,
  varsler_aktive
) on table public.profiler to authenticated;

revoke select on table public.kampanje_signaturer from anon, authenticated;
grant select (id, kampanje_id) on table public.kampanje_signaturer to anon, authenticated;

revoke all on table public.kampanje_med_signaturer from anon, authenticated, public;
grant select on table public.kampanje_med_signaturer to anon, authenticated;
grant all on table public.kampanje_med_signaturer to service_role;

revoke all on sequence public.pamelding_id_seq from anon, authenticated, public;
grant all on sequence public.pamelding_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Triggere.
-- ---------------------------------------------------------------------------

drop trigger if exists beskytt_profil_betaling on public.profiler;
create trigger beskytt_profil_betaling
  before insert or update on public.profiler
  for each row
  execute function public.beskytt_profil_betaling();

drop trigger if exists vern_manuelt_redigerte_felt on public.varsler;
create trigger vern_manuelt_redigerte_felt
  before update on public.varsler
  for each row
  execute function public.vern_manuelt_redigerte_felt();

do $auth_trigger$
begin
  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created') then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row
      execute function public.handle_new_user();
  end if;
end
$auth_trigger$;

do $rls_event$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls
      on ddl_command_end
      execute function public.rls_auto_enable();
  end if;
end
$rls_event$;

-- ---------------------------------------------------------------------------
-- Cron. Kommandoene leser Vault ved kjøring. Ingen hemmelighet lagres her.
-- 20260725180000 skriver midlertidig om hent-saker-daglig. Avslutningen
-- setter prod-kommandoen tilbake.
-- ---------------------------------------------------------------------------

select cron.schedule(
  'hent-saker-daglig',
  '0 6 * * *',
  $cron$
  select net.http_post(
    url := 'https://zyyijlvmgoanjdzngmon.supabase.co/functions/v1/hent-saker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='hent_saker_platform_jwt'),
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='hent_saker_platform_jwt'),
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='hent_saker_cron_secret')
    ),
    body := jsonb_build_object('utlost_av','pg_cron','tidspunkt',now()),
    timeout_milliseconds := 120000
  ) as request_id;
  $cron$
);

select cron.schedule(
  'oppdater-frister-daglig',
  '30 6 * * *',
  $cron$
  select net.http_post(
    url := 'https://zyyijlvmgoanjdzngmon.supabase.co/functions/v1/oppdater-frister',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='hent_saker_platform_jwt'),
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='hent_saker_platform_jwt'),
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='hent_saker_cron_secret')
    ),
    body := jsonb_build_object('utlost_av','pg_cron','tidspunkt',now()),
    timeout_milliseconds := 120000
  ) as request_id;
  $cron$
);
