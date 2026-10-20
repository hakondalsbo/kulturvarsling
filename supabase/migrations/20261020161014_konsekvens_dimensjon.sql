-- Konsekvens-dimensjonen. IKKE KJØRT. Krever Håkons godkjenning før migrering.
-- Additiv: gamle migrasjoner er ikke endret.
-- mobiliser_naa kan ikke være en generert kolonne. current_date er STABLE,
-- og Postgres krever IMMUTABLE i en lagret generert kolonne. Feltet lagres
-- slik avsnitt 7 foreslår, og holdes riktig av koden:
--   * hent-saker regner det ut ved innsetting og ved hver kjøring
--   * pg_cron-jobben under kjører intern.oppdater_mobiliser_naa daglig
-- Ingen ny Vercel Cron. Modellen setter aldri mobiliser_naa.

alter table public.varsler
  add column konsekvens text
    check (konsekvens in ('kutt_innstramming','stor_endring','ny_mulighet','til_orientering')),
  add column konsekvens_begrunnelse text,
  add column konsekvens_sikkerhet text
    check (konsekvens_sikkerhet in ('lav','middels','høy')),
  add column konsekvens_manuell boolean not null default false,
  add column mobiliser_naa boolean not null default false,
  add column mobiliser_grunn text,
  add column mobiliser_dato date;

create index if not exists varsler_konsekvens_idx on public.varsler (konsekvens);
create index if not exists varsler_mobiliser_idx on public.varsler (mobiliser_naa) where mobiliser_naa;

comment on column public.varsler.konsekvens is
  'Hva saken betyr for kulturfeltet. Én hovedverdi. Null til saken er klassifisert.';
comment on column public.varsler.konsekvens_begrunnelse is
  'Én saklig setning som viser til det kilden sier.';
comment on column public.varsler.konsekvens_sikkerhet is
  'lav, middels eller høy. lav vises ikke som merke før manuell kontroll.';
comment on column public.varsler.konsekvens_manuell is
  'true når en redaktør har rettet konsekvens. Pipelinen og backfill skriver ikke over raden.';
comment on column public.varsler.mobiliser_dato is
  'Hørings-, innspills- eller søknadsfrist, eller kjent vedtaksmøte, fra kilden. Styrer mobiliser_naa.';
comment on column public.varsler.mobiliser_grunn is
  'Kort setning med type og dato. Fylles også når datoen ligger mer enn 21 dager frem.';
comment on column public.varsler.mobiliser_naa is
  'Utregnet, ikke satt av modellen. true bare når mobiliser_dato er fra dagens dato i Europe/Oslo og 21 dager frem. Aldri true når datoen er passert.';

-- Funksjonen ligger utenfor public, så den ikke kan kalles via Data API.
create schema if not exists intern;

revoke all on schema intern from public;

create or replace function intern.oppdater_mobiliser_naa()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  antall integer;
  i_dag date := (timezone('Europe/Oslo', now()))::date;
begin
  update public.varsler
     set mobiliser_naa = (
       mobiliser_dato is not null
       and mobiliser_dato >= i_dag
       and mobiliser_dato <= (i_dag + 21)
     )
   where mobiliser_naa is distinct from (
       mobiliser_dato is not null
       and mobiliser_dato >= i_dag
       and mobiliser_dato <= (i_dag + 21)
     );
  get diagnostics antall = row_count;
  return antall;
end;
$$;

comment on function intern.oppdater_mobiliser_naa() is
  'Setter mobiliser_naa fra mobiliser_dato og dagens dato i Europe/Oslo. Kalles av pg_cron, ikke av modellen.';

revoke all on function intern.oppdater_mobiliser_naa() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function intern.oppdater_mobiliser_naa() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function intern.oppdater_mobiliser_naa() from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    grant usage on schema intern to postgres;
    grant execute on function intern.oppdater_mobiliser_naa() to postgres;
  end if;
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    grant usage on schema intern to supabase_admin;
    grant execute on function intern.oppdater_mobiliser_naa() to supabase_admin;
  end if;
end $$;

-- 23:10 UTC er etter midnatt i Norge både vinter (00:10 CET) og sommer (01:10 CEST).
-- Jobben oppdaterer bare det utledede flagget. Den klassifiserer ikke saker.
do $$
declare
  eksisterende bigint;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    select jobid into eksisterende from cron.job where jobname = 'mobiliser-naa-daglig';
    if eksisterende is not null then
      perform cron.unschedule(eksisterende);
    end if;
    perform cron.schedule(
      'mobiliser-naa-daglig',
      '10 23 * * *',
      $cron$select intern.oppdater_mobiliser_naa()$cron$
    );
  end if;
end $$;
