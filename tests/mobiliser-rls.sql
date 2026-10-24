-- Lokal test av mobiliseringsmigrasjonen. Ikke mot prod.
-- Kjør mot en tom database. Rollene finnes på klyngen.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;

alter role service_role bypassrls;

select pg_terminate_backend(pid)
from pg_stat_activity
where datname = 'mobiliser_rls' and pid <> pg_backend_pid();

drop database if exists mobiliser_rls;
create database mobiliser_rls;
\connect mobiliser_rls

create schema if not exists auth;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.varsler (
  id uuid primary key,
  tittel text,
  sammendrag text,
  kategori text,
  frist date,
  motedato date,
  status text,
  kilde text,
  instans text,
  publisert boolean default true,
  manuelt_redigert boolean default false
);

create table public.kampanjer (
  id uuid primary key,
  tittel text,
  beskrivelse text,
  mal integer default 1000,
  kategori text,
  sak_id uuid,
  tags text[],
  dager integer default 30,
  aktiv boolean default true
);

create table public.kampanje_signaturer (
  id uuid primary key default gen_random_uuid(),
  kampanje_id uuid references public.kampanjer (id),
  bruker_id uuid,
  navn text,
  epost text,
  opprettet timestamptz default now()
);

alter table public.kampanjer enable row level security;
create policy "Les kampanjer"
  on public.kampanjer
  for select
  to public
  using (aktiv = true);
create policy "foreslaa_kampanje"
  on public.kampanjer
  for insert
  to public
  with check (aktiv = false);
grant select, insert on table public.kampanjer to authenticated;

alter table public.kampanje_signaturer enable row level security;
-- Utgangspunkt som etter 20261024170000, pluss den åpne lesepolicyen
-- denne migrasjonen fortsatt skal ta hvis den ligger igjen.
create policy "Les signaturer" on public.kampanje_signaturer for select using (true);
create policy "Signer" on public.kampanje_signaturer
  for insert to authenticated
  with check (auth.uid() = bruker_id);
grant select, insert on table public.kampanje_signaturer to anon;
grant select, insert, update, delete on table public.kampanje_signaturer to authenticated;

create table public.samtykke_tekster (
  versjon text primary key,
  tekst text not null,
  gyldig_fra timestamptz
);

create table public.varsel_endringslogg (
  id bigint generated always as identity primary key,
  varsel_id uuid,
  felt text,
  fra_verdi text,
  til_verdi text,
  hvem text,
  endret timestamptz default now()
);

grant usage on schema public to anon, authenticated, service_role;

\ir ../supabase/migrations/20261024210000_mobilisering_fase_og_felles_innspill.sql

insert into public.varsler (id, tittel) values
  ('11111111-1111-4111-8111-111111111111', 'Høring'),
  ('33333333-3333-4333-8333-333333333333', 'Fase');

insert into public.kampanjer (id, tittel, slag, aktiv, sak_id) values
  ('22222222-2222-4222-8222-222222222222', 'Felles innspill', 'felles_innspill', true, '11111111-1111-4111-8111-111111111111'),
  ('44444444-4444-4444-8444-444444444444', 'Vanlig kampanje', null, true, null),
  ('55555555-5555-4555-8555-555555555555', 'Avsluttet innspill', 'felles_innspill', false, null);

insert into public.kampanje_signaturer (kampanje_id, navn, epost, samtykke_gitt_tid, bekreftet_tid, trukket_tid) values
  ('22222222-2222-4222-8222-222222222222', 'Demo Berg', 'berg@example.test', now(), now(), null),
  ('22222222-2222-4222-8222-222222222222', 'Demo Lie', 'lie@example.test', now(), now(), null),
  ('22222222-2222-4222-8222-222222222222', 'Demo Aasen', 'aasen@example.test', now(), null, null),
  ('22222222-2222-4222-8222-222222222222', 'Demo Trukket', 'trukket@example.test', now(), now(), now()),
  ('55555555-5555-4555-8555-555555555555', 'Demo Hvile', 'hvile@example.test', now(), now(), null);

do $$
declare
  n bigint;
  antall_policy integer;
  antall_grant integer;
begin
  if exists (
    select 1 from pg_policy
    where polrelid = 'public.kampanje_signaturer'::regclass
      and polname = 'Les signaturer'
  ) then
    raise exception 'Les signaturer skulle vært borte';
  end if;
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.kampanje_signaturer'::regclass
      and polname = 'Signer'
  ) then
    raise exception 'Signer skulle blitt stående';
  end if;

  select count(*) into antall_grant
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'kampanje_signaturer'
    and grantee = 'anon';
  if antall_grant <> 0 then
    raise exception 'anon har fortsatt tabellrettighet på kampanje_signaturer';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'kampanje_signaturer'
      and grantee = 'authenticated'
  ) then
    raise exception 'authenticated har tabellrettighet på kampanje_signaturer';
  end if;
  if (
    select coalesce(array_agg(column_name::text order by column_name::text), '{}'::text[])
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'kampanje_signaturer'
      and grantee = 'authenticated'
      and privilege_type = 'INSERT'
  ) <> array['bruker_id', 'epost', 'kampanje_id', 'navn']::text[] then
    raise exception 'authenticated skal bare ha kolonne-INSERT på kampanje_id, bruker_id, navn og epost';
  end if;

  select count(*) into antall_policy
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'mobiliser_forsok'
    and grantee in ('anon', 'authenticated', 'public');
  if antall_policy <> 0 then
    raise exception 'mobiliser_forsok har klientrettighet';
  end if;

  begin
    execute 'set local role anon';
    perform 1 from public.kampanje_signaturer;
    raise exception 'anon leste signaturer';
  exception
    when insufficient_privilege then null;
  end;

  begin
    execute 'set local role authenticated';
    perform 1 from public.kampanje_signaturer;
    raise exception 'authenticated leste signaturer';
  exception
    when insufficient_privilege then null;
  end;

  begin
    execute 'set local role anon';
    insert into public.kampanje_signaturer (kampanje_id, navn, epost)
    values ('22222222-2222-4222-8222-222222222222', 'Anon', 'anon@example.test');
    raise exception 'anon skrev signatur';
  exception
    when insufficient_privilege then null;
  end;

  begin
    execute 'set local role authenticated';
    insert into public.kampanje_signaturer (kampanje_id, navn, epost)
    values ('22222222-2222-4222-8222-222222222222', 'Bruker', 'bruker@example.test');
    raise exception 'authenticated skrev signatur';
  exception
    when insufficient_privilege then null;
  end;

  execute 'set local role anon';
  select public.felles_innspill_antall('22222222-2222-4222-8222-222222222222') into n;
  if n <> 2 then
    raise exception 'forventet 2 bekreftede signaturer, fikk %', n;
  end if;
  select public.felles_innspill_antall('55555555-5555-4555-8555-555555555555') into n;
  if n <> 0 then
    raise exception 'inaktivt felles innspill skulle ikke telles, fikk %', n;
  end if;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', true);
  begin
    execute 'set local role authenticated';
    insert into public.kampanje_signaturer (kampanje_id, bruker_id, navn, epost, bekreftet_tid)
    values (
      '22222222-2222-4222-8222-222222222222',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
      'Innlogget',
      'innlogget@example.test',
      now()
    );
    raise exception 'innlogget skrev bekreftet signatur på felles innspill';
  exception
    when insufficient_privilege then null;
  end;

  begin
    execute 'set local role authenticated';
    insert into public.kampanje_signaturer (kampanje_id, bruker_id, navn, epost)
    values (
      '22222222-2222-4222-8222-222222222222',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
      'Innlogget',
      'innlogget@example.test'
    );
    raise exception 'innlogget skrev signatur på felles innspill';
  exception
    when insufficient_privilege then null;
  end;

  execute 'set local role authenticated';
  insert into public.kampanje_signaturer (kampanje_id, bruker_id, navn, epost)
  values (
    '44444444-4444-4444-8444-444444444444',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
    'Kari Kampanje',
    'kari@example.test'
  );
  execute 'reset role';
  if not exists (
    select 1 from public.kampanje_signaturer
    where kampanje_id = '44444444-4444-4444-8444-444444444444'
      and bruker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'
      and navn = 'Kari Kampanje'
      and epost = 'kari@example.test'
      and bekreftet_tid is null
  ) then
    raise exception 'vanlig kampanjesignering med de fire kolonnene ble ikke lagret';
  end if;

  begin
    execute 'set local role authenticated';
    insert into public.kampanjer (id, tittel, aktiv, slag)
    values (
      '66666666-6666-4666-8666-666666666666',
      'Forsøk på felles innspill',
      false,
      'felles_innspill'
    );
    raise exception 'innlogget opprettet kampanje med slag felles_innspill';
  exception
    when insufficient_privilege then null;
  end;

  execute 'set local role authenticated';
  insert into public.kampanjer (id, tittel, beskrivelse, mal, kategori, sak_id, tags, dager, aktiv)
  values (
    '77777777-7777-4777-8777-777777777777',
    'Forslag',
    'En vanlig kampanje',
    500,
    'scenekunst',
    null,
    '{}',
    30,
    false
  );
  execute 'reset role';
  if not exists (
    select 1 from public.kampanjer
    where id = '77777777-7777-4777-8777-777777777777'
      and aktiv = false
      and slag is null
      and sendt_tid is null
      and avsluttet_tid is null
  ) then
    raise exception 'vanlig kampanjeforslag ble ikke lagret';
  end if;

  begin
    execute 'set local role anon';
    perform * from public.felles_innspill_til_mottaker('22222222-2222-4222-8222-222222222222');
    raise exception 'anon leste navnelisten';
  exception
    when insufficient_privilege then null;
  end;

  execute 'set local role service_role';
  perform epost from public.kampanje_signaturer where epost = 'berg@example.test';
  if not found then
    raise exception 'service_role leste ikke e-post';
  end if;
  execute 'reset role';

  begin
    update public.varsler set fase = 'vedtak' where id = '33333333-3333-4333-8333-333333333333';
    raise exception 'direkte oppdatering av fase gikk gjennom';
  exception
    when insufficient_privilege then null;
  end;

  perform public.sett_varsel_fase('33333333-3333-4333-8333-333333333333', 'utredning_horing', 'postgres-test');
  if (select fase::text from public.varsler where id = '33333333-3333-4333-8333-333333333333') <> 'utredning_horing' then
    raise exception 'sett_varsel_fase satte ikke fasen';
  end if;
  if (select count(*) from public.varsel_endringslogg where felt = 'fase' and hvem = 'postgres-test') <> 1 then
    raise exception 'fasen ble ikke logget';
  end if;

  -- session_user er innlogget bruker (postgres her). API-kallet bærer rollen i JWT.
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  begin
    execute 'set local role authenticated';
    perform public.sett_varsel_fase('33333333-3333-4333-8333-333333333333', 'vedtak', 'bruker');
    raise exception 'authenticated uten redaktørkrav satte fase';
  exception
    when insufficient_privilege then null;
  end;

  perform set_config(
    'request.jwt.claims',
    '{"role":"authenticated","app_metadata":{"rolle":"redaktor"}}',
    true
  );
  execute 'set local role authenticated';
  perform public.sett_varsel_fase('33333333-3333-4333-8333-333333333333', 'vedtak', 'redaktør');
  execute 'reset role';
  if (select fase::text from public.varsler where id = '33333333-3333-4333-8333-333333333333') <> 'vedtak' then
    raise exception 'redaktør fikk ikke satt fase';
  end if;
end
$$;
