-- Kjør bare mot en tom testdatabase. Setter opp tilstanden etter
-- 20261024163600, kjører den nye migrasjonen, og sjekker rettighetene.
-- Andre tabellers grants skal være like før og etter.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;

create table if not exists auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated;

create table public.profiler (
  id uuid primary key references auth.users (id) on delete cascade
);

create table public.varsler (
  id uuid primary key,
  tittel text not null
);

create table public.aktivitet (
  id integer primary key
);

create table public.horingssvar (
  id uuid primary key default gen_random_uuid(),
  bruker_id uuid references public.profiler (id) on delete set null,
  sak_id uuid references public.varsler (id) on delete cascade,
  org text,
  tekst text not null,
  sendt_til text,
  opprettet timestamptz default now()
);

create table public.kommune_horinger (
  id uuid primary key default gen_random_uuid(),
  tittel text not null,
  publisert boolean default false
);

create table public.kommune_innspill (
  id uuid primary key default gen_random_uuid(),
  horing_id uuid references public.kommune_horinger (id) on delete cascade,
  org text,
  tekst text not null,
  status text default 'ny' check (status = any (array['ny'::text, 'lest'::text, 'besvart'::text])),
  tags text[] default '{}',
  svar_tekst text,
  svar_dato timestamptz,
  opprettet timestamptz default now()
);

alter table public.horingssvar enable row level security;
alter table public.kommune_innspill enable row level security;

create policy "Les horing" on public.horingssvar for select to public using (true);
create policy "Les innspill" on public.kommune_innspill for select to public using (true);

revoke all on table public.horingssvar from public, anon, authenticated;
revoke all on table public.kommune_innspill from public, anon, authenticated;
revoke all on table public.varsler from public, anon, authenticated;
revoke all on table public.aktivitet from public, anon, authenticated;
revoke all on table public.profiler from public;

grant select, references, trigger on table public.horingssvar to anon, authenticated;
grant select, references, trigger on table public.kommune_innspill to anon, authenticated;
grant select, references, trigger on table public.varsler to anon, authenticated;
grant select, insert, references, trigger on table public.aktivitet to anon, authenticated;

create table public._grant_snap (
  grantee text,
  table_name text,
  privilege_type text
);

insert into public._grant_snap
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('aktivitet', 'varsler', 'horingssvar', 'kommune_innspill')
  and grantee in ('anon', 'authenticated', 'PUBLIC');

create table public._policy_snap (
  tabell text,
  polnavn text
);

insert into public._policy_snap
select c.relname, p.polname
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('horingssvar', 'kommune_innspill');

insert into auth.users (id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02');
insert into public.profiler (id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02');
insert into public.varsler (id, tittel) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccc01', 'Prøvesak');
insert into public.kommune_innspill (org, tekst) values
  ('Gammel organisasjon', 'Innspill fra før bruker_id fantes.');

-- Hele åpningen og rolleprøvene rulles tilbake. Etterpå skal
-- skjema, policies og grants være som før migrasjonen.
begin;

\ir ../supabase/migrations/20261024190000_horingssvar_og_kommuneinnspill.sql

do $$
declare n int;
begin
  select count(*) into n from (
    select grantee, table_name, privilege_type from public._grant_snap
    where table_name in ('aktivitet', 'varsler')
    except
    select grantee, table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('aktivitet', 'varsler')
      and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) q;
  if n <> 0 then
    raise exception 'grants forsvant fra aktivitet eller varsler';
  end if;
  select count(*) into n from (
    select grantee, table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('aktivitet', 'varsler')
      and grantee in ('anon', 'authenticated', 'PUBLIC')
    except
    select grantee, table_name, privilege_type from public._grant_snap
  ) q;
  if n <> 0 then
    raise exception 'nye grants på aktivitet eller varsler';
  end if;

  if exists (
    select 1
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relname in ('horingssvar', 'kommune_innspill')
      and (
        coalesce(pg_get_expr(p.polqual, p.polrelid), '') = 'true'
        or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') = 'true'
        or cardinality(p.polroles) = 0
        or p.polname in ('Les horing', 'Les innspill')
      )
  ) then
    raise exception 'offentlig lesepolicy ble stående';
  end if;

  if exists (
    select 1
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    join lateral unnest(p.polroles) rolle(oid) on true
    join pg_roles rol on rol.oid = rolle.oid
    where ns.nspname = 'public'
      and c.relname in ('horingssvar', 'kommune_innspill')
      and rol.rolname <> 'authenticated'
  ) then
    raise exception 'policy gjelder noen andre enn authenticated';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('horingssvar', 'kommune_innspill')
      and grantee in ('anon', 'PUBLIC')
  ) then
    raise exception 'anon eller public har rettighet på svar eller innspill';
  end if;

  if (
    select p.proacl::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'horingssvar_hold_utkast'
  ) ~ '(^|[{,])=' then
    raise exception 'triggerfunksjonen er kjørbar for public';
  end if;
  if has_function_privilege('anon', 'public.horingssvar_hold_utkast()', 'execute') then
    raise exception 'anon kan kjøre horingssvar_hold_utkast';
  end if;
  if not has_function_privilege('authenticated', 'public.horingssvar_hold_utkast()', 'execute') then
    raise exception 'authenticated mangler execute på triggerfunksjonen';
  end if;
end $$;

-- Anon får verken skrive eller lese.
set local role anon;
do $$
begin
  insert into public.horingssvar (bruker_id, sak_id, tekst)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', 'cccccccc-cccc-4ccc-8ccc-cccccccccc01', 'fra anon');
  raise exception 'anon fikk skrive høringssvar';
exception when insufficient_privilege then
  null;
end $$;
do $$
begin
  perform 1 from public.horingssvar;
  raise exception 'anon fikk lese høringssvar';
exception when insufficient_privilege then
  null;
end $$;
do $$
begin
  insert into public.kommune_innspill (bruker_id, org, tekst)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', 'Anon', 'skal stoppes');
  raise exception 'anon fikk skrive kommuneinnspill';
exception when insufficient_privilege then
  null;
end $$;
do $$
begin
  perform 1 from public.kommune_innspill;
  raise exception 'anon fikk lese kommuneinnspill';
exception when insufficient_privilege then
  null;
end $$;

-- A skriver og leser sitt eget utkast. B sin rad og gamle rader er usynlige.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', true);
insert into public.horingssvar (bruker_id, sak_id, tekst, org)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
  'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
  'Eget utkast',
  'Forening A'
);

do $$
declare n int;
begin
  select count(*) into n from public.horingssvar;
  if n <> 1 then raise exception 'A skulle se 1 utkast, så %', n; end if;
end $$;

do $$
begin
  insert into public.horingssvar (bruker_id, sak_id, tekst)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02', 'cccccccc-cccc-4ccc-8ccc-cccccccccc01', 'som noen andre');
  raise exception 'A fikk skrive utkast som B';
exception when insufficient_privilege then
  null;
end $$;

update public.horingssvar
set tekst = 'Endret utkast', sendt_til = 'dep@example.no'
where bruker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';

do $$
begin
  delete from public.horingssvar;
  raise exception 'A fikk slette utkast';
exception when insufficient_privilege then
  null;
end $$;

insert into public.kommune_innspill (bruker_id, org, tekst)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', 'Forening A', 'Vi støtter forslaget.');

do $$
declare n int;
declare gammel int;
begin
  select count(*) into n from public.kommune_innspill;
  if n <> 1 then raise exception 'A skulle se 1 innspill, så %', n; end if;
  select count(*) into gammel from public.kommune_innspill where org = 'Gammel organisasjon';
  if gammel <> 0 then raise exception 'A så et innspill uten eier'; end if;
end $$;

do $$
begin
  insert into public.kommune_innspill (bruker_id, org, tekst)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02', 'Forening A', 'på vegne av B');
  raise exception 'A fikk skrive innspill som B';
exception when insufficient_privilege then
  null;
end $$;

do $$
begin
  insert into public.kommune_innspill (bruker_id, org, tekst, status, svar_tekst)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', 'Forening A', 'ferdig', 'besvart', 'svar');
  raise exception 'A fikk sette status besvart';
exception when insufficient_privilege then
  null;
end $$;

do $$
begin
  update public.kommune_innspill set tekst = 'endret';
  raise exception 'A fikk endre innspill';
exception when insufficient_privilege then
  null;
end $$;

do $$
begin
  delete from public.kommune_innspill;
  raise exception 'A fikk slette innspill';
exception when insufficient_privilege then
  null;
end $$;

-- B ser verken As utkast eller As innspill.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02', true);
do $$
declare n int;
begin
  select count(*) into n from public.horingssvar;
  if n <> 0 then raise exception 'B skulle se 0 utkast, så %', n; end if;
  select count(*) into n from public.kommune_innspill;
  if n <> 0 then raise exception 'B skulle se 0 innspill, så %', n; end if;
  update public.horingssvar set tekst = 'stjålet';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B fikk endre % utkast', n; end if;
end $$;

reset role;

do $$
declare tekst text;
declare sendt text;
declare gammel uuid;
declare egne int;
begin
  select h.tekst, h.sendt_til into tekst, sendt
  from public.horingssvar h
  where h.bruker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
  if tekst is distinct from 'Endret utkast' then
    raise exception 'eget utkast ble ikke oppdatert: %', tekst;
  end if;
  if sendt is not null then
    raise exception 'utkast ble merket sendt: %', sendt;
  end if;
  select bruker_id into gammel
  from public.kommune_innspill
  where org = 'Gammel organisasjon';
  if gammel is not null then
    raise exception 'gammelt innspill fikk bruker_id';
  end if;
  select count(*) into egne
  from public.kommune_innspill
  where bruker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'
    and status = 'ny';
  if egne <> 1 then
    raise exception 'forventet ett nytt innspill, fant %', egne;
  end if;
end $$;

rollback;

do $$
declare n int;
declare gjenstar int;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'kommune_innspill'
      and column_name = 'bruker_id'
  ) then
    raise exception 'rollback etterlot bruker_id';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'horingssvar'
      and column_name in ('oppdatert', 'kilde_url', 'kilde_hentet', 'kilde_hash')
  ) then
    raise exception 'rollback etterlot kildekolonner';
  end if;
  if to_regprocedure('public.horingssvar_hold_utkast()') is not null then
    raise exception 'rollback etterlot triggerfunksjonen';
  end if;

  select count(*) into n from (
    select grantee, table_name, privilege_type from public._grant_snap
    except
    select grantee, table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('aktivitet', 'varsler', 'horingssvar', 'kommune_innspill')
      and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) q;
  if n <> 0 then raise exception 'rollback endret grants'; end if;
  select count(*) into n from (
    select grantee, table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('aktivitet', 'varsler', 'horingssvar', 'kommune_innspill')
      and grantee in ('anon', 'authenticated', 'PUBLIC')
    except
    select grantee, table_name, privilege_type from public._grant_snap
  ) q;
  if n <> 0 then raise exception 'rollback la igjen grants'; end if;

  select count(*) into n from (
    select tabell, polnavn from public._policy_snap
    except
    select c.relname, p.polname
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relname in ('horingssvar', 'kommune_innspill')
  ) q;
  if n <> 0 then raise exception 'rollback mistet en policy'; end if;

  select count(*) into gjenstar from public.horingssvar;
  if gjenstar <> 0 then raise exception 'rollback etterlot utkast'; end if;
  select count(*) into gjenstar from public.kommune_innspill;
  if gjenstar <> 1 then raise exception 'rollback endret gamle innspill, fant %', gjenstar; end if;
end $$;
