-- Beviser at authenticated blir telt og stoppet, og at service_role
-- og postgres slipper gjennom. Kjør mot en tom database.

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

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists auth;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

create table public.kampanjer (
  id uuid primary key default gen_random_uuid(),
  tittel text not null
);

create table public.fartsgrense (
  id bigint generated always as identity primary key,
  endepunkt text not null,
  nokkel text not null,
  opprettet_at timestamptz not null default now()
);

alter table public.fartsgrense enable row level security;
revoke all on table public.fartsgrense from anon, authenticated, public;
grant select, insert, delete on table public.fartsgrense to service_role;
grant insert on table public.kampanjer to anon, authenticated, service_role;

\ir ../supabase/migrations/20261026235000_fartsgrense_kampanje_rolle.sql
\ir ../supabase/migrations/20261026235000_fartsgrense_kampanje_rolle.sql

select 'trigger_en' as prove, count(*) as antall
from pg_trigger
where tgname = 'fartsgrense_foreslaa_kampanje' and not tgisinternal;

-- Dry-run slik reviewen gjorde: SET ROLE authenticated, uten JWT.
-- Da er current_user eieren. Rollen må likevel telles.
select set_config('request.jwt.claim.role', '', false);
select set_config('request.jwt.claims', '', false);
select set_config('request.jwt.claim.sub', '', false);
set role authenticated;

insert into public.kampanjer (tittel) values ('uten jwt');
reset role;

select 'uten_jwt' as prove, count(*) as antall
from public.fartsgrense
where endepunkt = 'foreslaa_kampanje';

delete from public.kampanjer;
delete from public.fartsgrense;

-- Innlogget bruker med JWT, samme som PostgREST.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
set role authenticated;

do $$
begin
  for i in 1..5 loop
    insert into public.kampanjer (tittel) values ('forslag ' || i);
  end loop;
end $$;

do $$
begin
  begin
    insert into public.kampanjer (tittel) values ('sjette');
    raise exception 'authenticated ble ikke stoppet over grensen';
  exception
    when sqlstate 'P0001' then
      if sqlerrm not like '%For mange forsøk%' then
        raise;
      end if;
  end;
end $$;

reset role;

do $$
declare
  n int;
begin
  select count(*) into n
  from public.fartsgrense
  where endepunkt = 'foreslaa_kampanje'
    and nokkel like 'bruker:%';
  if n <> 5 then
    raise exception 'forventet 5 brukerrader, fikk %', n;
  end if;
end $$;

select 'auth_bruker' as prove, count(*) as antall
from public.fartsgrense
where endepunkt = 'foreslaa_kampanje' and nokkel like 'bruker:%';

select 'auth_stoppet' as prove, 'ja' as svar;

-- En annen bruker har egen timekvote.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02', false);
set role authenticated;
insert into public.kampanjer (tittel) values ('annen bruker');
reset role;

select 'annen_bruker' as prove, count(*) as antall
from public.fartsgrense
where endepunkt = 'foreslaa_kampanje' and nokkel like 'bruker:%';
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;

do $$
declare
  foran int;
  etter int;
begin
  select count(*) into foran from public.fartsgrense;
  insert into public.kampanjer (tittel) values ('service');
  insert into public.kampanjer (tittel) values ('service igjen');
  select count(*) into etter from public.fartsgrense;
  if etter <> foran then
    raise exception 'service_role skulle slippe uten å telle, % ble %', foran, etter;
  end if;
end $$;

select 'service_urort' as prove, 'ja' as svar;

reset role;
select set_config('request.jwt.claim.role', '', false);
select set_config('request.jwt.claims', '', false);

do $$
declare
  foran int;
  etter int;
begin
  select count(*) into foran from public.fartsgrense;
  insert into public.kampanjer (tittel) values ('postgres');
  select count(*) into etter from public.fartsgrense;
  if etter <> foran then
    raise exception 'postgres skulle slippe uten å telle, % ble %', foran, etter;
  end if;
end $$;

select 'postgres_urort' as prove, 'ja' as svar;
select 'kjort_to_ganger' as prove, 'ja' as svar;
