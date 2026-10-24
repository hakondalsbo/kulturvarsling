-- Gjenskaper grants og policyer slik de er i prod etter
-- 20261024163600, kjører den nye migrasjonen, og sjekker utfallet.
-- Kjør mot en tom database: psql -v ON_ERROR_STOP=1 -f tests/kampanje-signaturer.sql

\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

alter role service_role bypassrls;
grant anon, authenticated, service_role to current_user;

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

create table public.profiler (
  id uuid primary key
);

create table public.kampanjer (
  id uuid primary key default gen_random_uuid(),
  tittel text not null,
  beskrivelse text,
  mal integer default 1000,
  kategori text,
  sak_id uuid,
  tags text[] default '{}',
  dager integer default 30,
  aktiv boolean default true,
  opprettet timestamptz default now()
);

create table public.kampanje_signaturer (
  id uuid primary key default gen_random_uuid(),
  kampanje_id uuid not null references public.kampanjer (id) on delete cascade,
  bruker_id uuid references public.profiler (id) on delete cascade,
  navn text,
  epost text,
  opprettet timestamptz default now(),
  unique (kampanje_id, bruker_id),
  unique (kampanje_id, epost)
);

alter table public.kampanjer enable row level security;
alter table public.kampanje_signaturer enable row level security;

create policy "Les kampanjer"
  on public.kampanjer
  for select
  to public
  using (aktiv = true);

create policy "Les signaturer"
  on public.kampanje_signaturer
  for select
  to public
  using (true);

create policy "Signer"
  on public.kampanje_signaturer
  for insert
  to public
  with check ((auth.uid() = bruker_id) or (bruker_id is null));

revoke all on table public.kampanje_signaturer from public, anon, authenticated;
grant insert, references, trigger on table public.kampanje_signaturer to anon, authenticated;
grant select (id, kampanje_id) on table public.kampanje_signaturer to anon, authenticated;
grant all on table public.kampanje_signaturer to service_role;

revoke all on table public.kampanjer from public, anon, authenticated;
grant select, references, trigger on table public.kampanjer to anon;
grant select, insert, references, trigger on table public.kampanjer to authenticated;
grant all on table public.kampanjer to service_role;

create view public.kampanje_med_signaturer
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

grant select on public.kampanje_med_signaturer to anon, authenticated, service_role;

\ir ../supabase/migrations/20261024170000_steng_lesing_av_kampanje_signaturer.sql

create table public._utfall (
  navn text primary key,
  utfall text not null,
  detalj text
);
grant insert, select on public._utfall to anon, authenticated, service_role;

insert into public.profiler (id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03');

insert into public.kampanjer (id, tittel, aktiv) values
  ('11111111-1111-4111-8111-111111111111', 'Aktiv', true),
  ('22222222-2222-4222-8222-222222222222', 'Inaktiv', false),
  ('33333333-3333-4333-8333-333333333333', 'Tom', true);

insert into public.kampanje_signaturer (kampanje_id, bruker_id, navn, epost) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02', 'Seed', 'seed@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02', 'Skjult', 'skjult@example.com');

select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$
declare n int;
begin
  select count(*) into n from public.kampanje_signaturer;
  insert into public._utfall values (
    'anon_select',
    case when n = 0 then 'ingen_rader' else 'lekket' end,
    n::text
  );
exception
  when insufficient_privilege then
    insert into public._utfall values ('anon_select', 'nektet', sqlerrm);
  when others then
    insert into public._utfall values ('anon_select', 'feil', sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  insert into public.kampanje_signaturer (kampanje_id, bruker_id, navn, epost)
  values ('11111111-1111-4111-8111-111111111111', null, 'Anon', 'anon@example.com');
  insert into public._utfall values ('anon_insert', 'skrevet', null);
exception
  when insufficient_privilege then
    insert into public._utfall values ('anon_insert', 'nektet', sqlerrm);
  when others then
    insert into public._utfall values ('anon_insert', 'feil', sqlstate || ' ' || sqlerrm);
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', false);
set role authenticated;
do $$
begin
  insert into public.kampanje_signaturer (kampanje_id, bruker_id, navn, epost)
  values (
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
    'Egen',
    'egen@example.com'
  );
  insert into public._utfall values ('auth_insert_egen', 'ok', null);
exception
  when others then
    insert into public._utfall values ('auth_insert_egen', 'feil', sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  insert into public.kampanje_signaturer (kampanje_id, bruker_id, navn, epost)
  values (
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03',
    'Annen',
    'annen@example.com'
  );
  insert into public._utfall values ('auth_insert_annen', 'skrevet', null);
exception
  when insufficient_privilege then
    insert into public._utfall values ('auth_insert_annen', 'nektet', sqlerrm);
  when others then
    insert into public._utfall values ('auth_insert_annen', 'feil', sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  n int;
begin
  select count(*) into n from public.kampanje_signaturer;
  insert into public._utfall values (
    'auth_select',
    case when n = 0 then 'ingen_rader' else 'lekket' end,
    n::text
  );
exception
  when insufficient_privilege then
    insert into public._utfall values ('auth_select', 'nektet', sqlerrm);
  when others then
    insert into public._utfall values ('auth_select', 'feil', sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  aktiv int;
  tom int;
  inaktiv int;
begin
  select signaturer into aktiv
  from public.kampanje_med_signaturer
  where id = '11111111-1111-4111-8111-111111111111';
  select signaturer into tom
  from public.kampanje_med_signaturer
  where id = '33333333-3333-4333-8333-333333333333';
  select count(*) into inaktiv
  from public.kampanje_med_signaturer
  where id = '22222222-2222-4222-8222-222222222222';
  insert into public._utfall values (
    'auth_telling',
    case when aktiv = 2 and tom = 0 and inaktiv = 0 then 'ok' else 'feil' end,
    format('aktiv=%s tom=%s inaktiv=%s', aktiv, tom, inaktiv)
  );
exception
  when others then
    insert into public._utfall values ('auth_telling', 'feil', sqlstate || ' ' || sqlerrm);
end $$;
reset role;

select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$
declare
  aktiv int;
  tom int;
  inaktiv int;
  synlige int;
begin
  select count(*) into synlige from public.kampanje_med_signaturer;
  select signaturer into aktiv
  from public.kampanje_med_signaturer
  where id = '11111111-1111-4111-8111-111111111111';
  select signaturer into tom
  from public.kampanje_med_signaturer
  where id = '33333333-3333-4333-8333-333333333333';
  select count(*) into inaktiv
  from public.kampanje_med_signaturer
  where id = '22222222-2222-4222-8222-222222222222';
  insert into public._utfall values (
    'anon_telling',
    case when aktiv = 2 and tom = 0 and inaktiv = 0 and synlige = 2 then 'ok' else 'feil' end,
    format('aktiv=%s tom=%s inaktiv=%s synlige=%s', aktiv, tom, inaktiv, synlige)
  );
exception
  when others then
    insert into public._utfall values ('anon_telling', 'feil', sqlstate || ' ' || sqlerrm);
end $$;

do $$
declare
  n int;
  skjult int;
begin
  select antall into n
  from privat.antall_signaturer()
  where kampanje_id = '11111111-1111-4111-8111-111111111111';
  select count(*) into skjult
  from privat.antall_signaturer()
  where kampanje_id = '22222222-2222-4222-8222-222222222222';
  insert into public._utfall values (
    'funksjon',
    case when n = 2 and skjult = 0 then 'ok' else 'feil' end,
    format('antall=%s skjult=%s', n, skjult)
  );
exception
  when others then
    insert into public._utfall values ('funksjon', 'feil', sqlstate || ' ' || sqlerrm);
end $$;
reset role;

set role service_role;
do $$
declare n int;
begin
  select count(*) into n
  from public.kampanje_signaturer
  where navn in ('Seed', 'Egen');
  insert into public._utfall values (
    'service_select',
    case when n = 2 then 'ok' else 'feil' end,
    n::text
  );
exception
  when others then
    insert into public._utfall values ('service_select', 'feil', sqlstate || ' ' || sqlerrm);
end $$;
reset role;

\echo '--- utfall ---'
select navn, utfall, detalj from public._utfall order by navn;

do $$
declare
  mangler text;
  viewdef text;
  sjekk text;
  invoker text;
begin
  select string_agg(navn || '=' || utfall || coalesce(' (' || detalj || ')', ''), ', ' order by navn)
  into mangler
  from public._utfall
  where not (
    (navn = 'anon_select' and utfall in ('nektet', 'ingen_rader'))
    or (navn = 'anon_insert' and utfall = 'nektet' and detalj ilike '%permission denied%')
    or (navn = 'auth_insert_egen' and utfall = 'ok')
    or (navn = 'auth_insert_annen' and utfall = 'nektet' and detalj ilike '%row-level security%')
    or (navn = 'auth_select' and utfall in ('nektet', 'ingen_rader'))
    or (navn = 'auth_telling' and utfall = 'ok')
    or (navn = 'anon_telling' and utfall = 'ok')
    or (navn = 'funksjon' and utfall = 'ok')
    or (navn = 'service_select' and utfall = 'ok')
  );
  if mangler is not null then
    raise exception 'signaturtest feilet: %', mangler;
  end if;

  if (select count(*) from public.kampanje_signaturer) <> 3 then
    raise exception 'forventet 3 signaturer (seed, skjult, egen), fikk %',
      (select count(*) from public.kampanje_signaturer);
  end if;

  if has_column_privilege('anon', 'public.kampanje_signaturer', 'id', 'SELECT')
     or has_column_privilege('anon', 'public.kampanje_signaturer', 'kampanje_id', 'SELECT')
     or has_column_privilege('authenticated', 'public.kampanje_signaturer', 'id', 'SELECT')
     or has_column_privilege('authenticated', 'public.kampanje_signaturer', 'kampanje_id', 'SELECT')
     or has_column_privilege('anon', 'public.kampanje_signaturer', 'navn', 'SELECT')
     or has_column_privilege('authenticated', 'public.kampanje_signaturer', 'epost', 'SELECT')
  then
    raise exception 'anon eller authenticated har fortsatt SELECT';
  end if;

  if has_table_privilege('anon', 'public.kampanje_signaturer', 'INSERT') then
    raise exception 'anon har fortsatt INSERT';
  end if;
  if not has_table_privilege('authenticated', 'public.kampanje_signaturer', 'INSERT') then
    raise exception 'authenticated mangler INSERT';
  end if;
  if not has_table_privilege('service_role', 'public.kampanje_signaturer', 'SELECT') then
    raise exception 'service_role mangler SELECT';
  end if;

  if exists (
    select 1
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'kampanje_signaturer'
      and p.polname = 'Les signaturer'
  ) then
    raise exception 'Les signaturer finnes fortsatt';
  end if;

  select pg_get_expr(p.polwithcheck, p.polrelid) || ' roller=' || p.polroles::regrole[]::text
  into sjekk
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'kampanje_signaturer'
    and p.polname = 'Signer';
  if sjekk is null
     or sjekk !~ 'auth\.uid\(\) = bruker_id'
     or sjekk ~ 'bruker_id IS NULL'
     or sjekk !~ 'roller=\{authenticated\}'
  then
    raise exception 'Signer-policy er ikke auth.uid() = bruker_id for authenticated: %', coalesce(sjekk, 'mangler');
  end if;

  select coalesce(opt.option_value, 'false')
  into invoker
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join lateral pg_options_to_table(c.reloptions) opt on opt.option_name = 'security_invoker'
  where n.nspname = 'public' and c.relname = 'kampanje_med_signaturer';
  if invoker is distinct from 'true' then
    raise exception 'viewet er ikke security_invoker: %', coalesce(invoker, 'null');
  end if;

  select pg_get_viewdef('public.kampanje_med_signaturer'::regclass, true) into viewdef;
  if viewdef ilike '%navn%' or viewdef ilike '%epost%' or viewdef ilike '%kampanje_signaturer%' then
    raise exception 'viewet eksponerer signaturfelt: %', viewdef;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'kampanje_med_signaturer'
      and column_name = 'signaturer'
  ) then
    raise exception 'viewet mangler kolonnen signaturer';
  end if;
end $$;
