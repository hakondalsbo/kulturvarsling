-- Konsekvens-dimensjonen.
-- Additiv. Eldre migrasjoner er ikke endret.
-- Tidsstempelet ligger etter siste migrasjon på main, så den kan settes inn
-- bak det som allerede er kjørt i prod.
--
-- mobiliser_naa kan ikke være en lagret generert kolonne. current_date er
-- STABLE, og Postgres krever IMMUTABLE. Flagget lagres og holdes av koden:
--   * hent-saker regner det ut når en ulåst, ny sak settes inn
--   * privat.oppdater_mobiliser_naa kjøres av pg_cron
-- Rader med manuelt_redigert eller konsekvens_manuell får ingen automatiske
-- skrivinger, heller ikke av det utledede flagget. Avisen viser «Mobiliser nå»
-- fra mobiliser_dato.
-- Ingen ny Vercel Cron. Modellen setter aldri mobiliser_naa.
--
-- Skjemaet privat ligger utenfor Data-API-et. Standardrettighetene i public
-- gir ikke EXECUTE til anon og authenticated (20261024203000). privat har
-- ingen slik standard-ACL, så en ny funksjon der ville gitt EXECUTE til
-- PUBLIC. Den trekkes tilbake. Bare postgres, som eier pg_cron-jobbene, får
-- kjøre funksjonen. security invoker og tom search_path.

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
  'Hørings-, innspills- eller søknadsfrist, eller kjent vedtaksmøte, fra kilden. Avisen regner Mobiliser nå fra denne datoen.';
comment on column public.varsler.mobiliser_grunn is
  'Kort setning med type og dato. Fylles også når datoen ligger mer enn 21 dager frem.';
comment on column public.varsler.mobiliser_naa is
  'Utregnet, ikke satt av modellen. true bare når mobiliser_dato er fra dagens dato i Europe/Oslo og 21 dager frem. Aldri true når datoen er passert. Skrives ikke på rader med manuelt_redigert eller konsekvens_manuell.';

create or replace function privat.oppdater_mobiliser_naa()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  antall integer;
  i_dag date := (pg_catalog.timezone('Europe/Oslo', pg_catalog.now()))::date;
begin
  update public.varsler
     set mobiliser_naa = (
       mobiliser_dato is not null
       and mobiliser_dato >= i_dag
       and mobiliser_dato <= (i_dag + 21)
     )
   where manuelt_redigert is not true
     and konsekvens_manuell is not true
     and mobiliser_naa is distinct from (
       mobiliser_dato is not null
       and mobiliser_dato >= i_dag
       and mobiliser_dato <= (i_dag + 21)
     );
  get diagnostics antall = row_count;
  return antall;
end;
$$;

alter function privat.oppdater_mobiliser_naa() owner to postgres;

comment on function privat.oppdater_mobiliser_naa() is
  'Setter mobiliser_naa fra mobiliser_dato og dagens dato i Europe/Oslo. Hopper over manuelt_redigert og konsekvens_manuell. Kalles av pg_cron, ikke av modellen. security invoker, tom search_path. Bare postgres har EXECUTE.';

revoke all on function privat.oppdater_mobiliser_naa() from public;
revoke all on function privat.oppdater_mobiliser_naa() from anon, authenticated, service_role;
grant execute on function privat.oppdater_mobiliser_naa() to postgres;

-- 23:10 UTC er etter midnatt i Norge både vinter (00:10 CET) og sommer (01:10 CEST).
-- Jobben oppdaterer bare det utledede flagget på ulåste rader. Den klassifiserer ikke.
do $$
begin
  if to_regnamespace('cron') is null then
    raise notice 'skjemaet cron finnes ikke, mobiliser-naa-daglig ble ikke planlagt';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'mobiliser-naa-daglig') then
    perform cron.unschedule('mobiliser-naa-daglig');
  end if;
  perform cron.schedule(
    'mobiliser-naa-daglig',
    '10 23 * * *',
    'select privat.oppdater_mobiliser_naa()'
  );
end $$;
