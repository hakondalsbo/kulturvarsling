-- Sikkerhet som ikke endrer priser, utsending eller gamle migrasjoner.
--
-- 1. fartsgrense: forsøk på offentlige skrive-endepunkter.
--    Nøkkel er hash. Bare service_role. Kalleren sletter rader eldre enn 48 timer.
--    foreslaa_kampanje er et direkte INSERT og begrenses av en trigger.
-- 2. stripe_hendelser: event.id lagres. Duplikat hoppes over.
--    Behandlet settes først når håndteringen er ferdig, så en feil kan prøves på nytt.
-- 3. kilde_kjoringer stenges for anon og authenticated.
--    Kildestatusen i appen leser public.kilder (navn, niva, organ, adapter,
--    aktiv, sist_hentet, sist_status), ikke kjøringstabellen og ikke
--    kilde_alarmer. Kjøringene har feilmelding, http_status og kjoert_av.
-- 4. Åpen signatur på samme innspill og e-post kan ikke lagres to ganger.
--
-- net.* røres ikke. Funksjonene eies av supabase_admin, og postgres
-- fikk ikke lov i 20261024203000. Det er notert, ikke forsøkt på nytt.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.fartsgrense (
  id bigint generated always as identity primary key,
  endepunkt text not null,
  nokkel text not null,
  opprettet_at timestamptz not null default now(),
  constraint fartsgrense_endepunkt_len check (char_length(endepunkt) between 1 and 64),
  constraint fartsgrense_nokkel_len check (char_length(nokkel) between 1 and 128)
);

alter table public.fartsgrense enable row level security;
revoke all on table public.fartsgrense from anon, authenticated, public;
grant select, insert, delete on table public.fartsgrense to service_role;
revoke all on sequence public.fartsgrense_id_seq from anon, authenticated, public;
grant usage, select on sequence public.fartsgrense_id_seq to service_role;

create index if not exists fartsgrense_oppslag_idx
  on public.fartsgrense (endepunkt, nokkel, opprettet_at desc);

comment on table public.fartsgrense is
  'Forsøk på offentlige skrive-endepunkter den siste timen. Nøkkel er sha256, ikke IP, e-post eller bruker-id. RLS uten policy for anon og authenticated. Bare service_role. Rader eldre enn 48 timer slettes av kalleren.';

create schema if not exists privat;
revoke all on schema privat from public, anon, authenticated;
grant usage on schema privat to postgres, service_role, anon, authenticated;

create or replace function privat.fartsgrense_kampanje()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  raw text;
  hoder json;
  ip text;
  bruker text := '';
  ip_nokkel text;
  bruker_nokkel text;
  antall_ip int;
  antall_bruker int;
  grense_ip constant int := 20;
  grense_bruker constant int := 5;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  delete from public.fartsgrense
  where endepunkt = 'foreslaa_kampanje'
    and opprettet_at < pg_catalog.now() - interval '48 hours';

  raw := pg_catalog.current_setting('request.headers', true);
  if raw is null or pg_catalog.btrim(raw) = '' then
    hoder := '{}'::json;
  else
    begin
      hoder := raw::json;
    exception when others then
      hoder := '{}'::json;
    end;
  end if;

  ip := pg_catalog.left(pg_catalog.btrim(pg_catalog.split_part(coalesce(
    hoder->>'cf-connecting-ip',
    hoder->>'x-real-ip',
    hoder->>'x-forwarded-for',
    ''
  ), ',', 1)), 64);
  ip := pg_catalog.regexp_replace(ip, '[[:cntrl:]]', '', 'g');
  if ip = '' then
    ip := 'ukjent';
  end if;

  begin
    bruker := coalesce(auth.uid()::text, '');
  exception when others then
    bruker := '';
  end;

  ip_nokkel := 'ip:' || encode(
    extensions.digest(convert_to('foreslaa_kampanje|ip|' || ip, 'UTF8'), 'sha256'),
    'hex'
  );

  select count(*) into antall_ip
  from public.fartsgrense
  where endepunkt = 'foreslaa_kampanje'
    and nokkel = ip_nokkel
    and opprettet_at > pg_catalog.now() - interval '1 hour';

  antall_bruker := 0;
  if bruker <> '' then
    bruker_nokkel := 'bruker:' || encode(
      extensions.digest(convert_to('foreslaa_kampanje|bruker|' || bruker, 'UTF8'), 'sha256'),
      'hex'
    );
    select count(*) into antall_bruker
    from public.fartsgrense
    where endepunkt = 'foreslaa_kampanje'
      and nokkel = bruker_nokkel
      and opprettet_at > pg_catalog.now() - interval '1 hour';
  end if;

  if antall_ip >= grense_ip or antall_bruker >= grense_bruker then
    raise exception 'For mange forsøk. Prøv igjen senere.'
      using errcode = 'P0001';
  end if;

  insert into public.fartsgrense (endepunkt, nokkel)
  values ('foreslaa_kampanje', ip_nokkel);
  if bruker <> '' then
    insert into public.fartsgrense (endepunkt, nokkel)
    values ('foreslaa_kampanje', bruker_nokkel);
  end if;

  return new;
end
$fn$;

comment on function privat.fartsgrense_kampanje() is
  'BEFORE INSERT på kampanjer for anon og authenticated. service_role og postgres slipper. Ikke et API: skjemaet privat er ikke eksponert. SECURITY DEFINER så innsettingen i fartsgrense ikke krever tabellrett for klienten.';

revoke all on function privat.fartsgrense_kampanje() from public;
grant execute on function privat.fartsgrense_kampanje() to anon, authenticated, service_role;

drop trigger if exists fartsgrense_foreslaa_kampanje on public.kampanjer;
create trigger fartsgrense_foreslaa_kampanje
  before insert on public.kampanjer
  for each row
  execute function privat.fartsgrense_kampanje();

create table if not exists public.stripe_hendelser (
  event_id text primary key,
  type text not null,
  mottatt timestamptz not null default now(),
  behandlet boolean not null default false,
  constraint stripe_hendelser_event_id_len check (char_length(event_id) between 3 and 255)
);

alter table public.stripe_hendelser enable row level security;
revoke all on table public.stripe_hendelser from anon, authenticated, public;
grant select, insert, update on table public.stripe_hendelser to service_role;

comment on table public.stripe_hendelser is
  'Stripe event.id som er mottatt. behandlet blir sann først når håndteringen er ferdig. Duplikat med behandlet sann hoppes over. Ingen endring i plan eller pris.';

drop policy if exists "les_kilde_kjoringer" on public.kilde_kjoringer;
revoke select on table public.kilde_kjoringer from anon, authenticated, public;
grant select, insert, update, delete on table public.kilde_kjoringer to service_role;

revoke select on table public.kilde_alarmer from anon, authenticated, public;
revoke select on table public.kilde_alarmer_frister from anon, authenticated, public;
grant select on table public.kilde_alarmer, public.kilde_alarmer_frister to service_role;

comment on table public.kilde_kjoringer is
  'Kjøringslogg. Bare service_role. Appen viser kildestatus fra public.kilder, ikke herfra.';

create unique index if not exists kampanje_signaturer_aapen_epost_idx
  on public.kampanje_signaturer (kampanje_id, lower(btrim(epost)))
  where trukket_tid is null and nullif(btrim(epost), '') is not null;
