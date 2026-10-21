-- Kildens egen publiseringstid, skille mellom vanlig kjøring og backfill,
-- og skille mellom hent-saker og oppdater-frister i kjøringsloggen.
-- Ingen avpublisering og ingen sletting. Rader med manuelt_redigert skrives
-- ikke. varsler.opprettet er når Kulturvarsling satte inn raden, og kopieres
-- ikke hit.
--
-- Møtedato, rundedato og sist_oppdatert backfylles ikke. De er ikke
-- publiseringstid. Feltet fylles når en adapter med pubDate eller
-- publisertDato ser saken igjen, og bare der det er null og
-- manuelt_redigert er usann.

alter table public.varsler
  add column if not exists kilde_publisert timestamptz;

comment on column public.varsler.kilde_publisert is
  'Kildens egen publiseringstid (pubDate eller publisertDato). Ikke varsler.opprettet, ikke møtedato og ikke rundedato. Null når kilden ikke har en publiseringstid. Automatikk skriver ikke feltet på rader med manuelt_redigert.';

alter table public.kilde_kjoringer
  add column if not exists kjoeringstype text not null default 'vanlig';

alter table public.kilde_kjoringer
  add column if not exists jobb text not null default 'hent-saker';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kilde_kjoringer_kjoeringstype_check'
      and conrelid = 'public.kilde_kjoringer'::regclass
  ) then
    alter table public.kilde_kjoringer
      add constraint kilde_kjoringer_kjoeringstype_check
      check (kjoeringstype in ('vanlig', 'backfill'));
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kilde_kjoringer_jobb_check'
      and conrelid = 'public.kilde_kjoringer'::regclass
  ) then
    alter table public.kilde_kjoringer
      add constraint kilde_kjoringer_jobb_check
      check (jobb in ('hent-saker', 'oppdater-frister'));
  end if;
end $$;

create index if not exists kilde_kjoringer_kilde_jobb_kjort
  on public.kilde_kjoringer (kilde_id, jobb, kjort desc);

comment on column public.kilde_kjoringer.kjoeringstype is
  'vanlig = daglig innhenting med datogrense mot siste vellykkede hent-saker-kjøring. backfill = eksplisitt kall uten den grensen. Cron kan ikke sette backfill.';

comment on column public.kilde_kjoringer.jobb is
  'hent-saker er innhenting. oppdater-frister er frist- og møtedatojobben. Den siste skriver ikke kilder.sist_status og inngår ikke i datogrense eller kilde_alarmer.';

comment on column public.kilde_kjoringer.status is
  'ok_nye | ok_ingen_nye | tom | delvis | feil_http | feil_timeout | feil_parse | feil_auth | feil_nett | feil_tomt_svar | feil_manglende_frist | http_feil. http_feil er spredte kallfeil under alarmgrensen og setter ikke alarm. feil_* og delvis gjør det. Datogrensen for hent-saker regner delvis og feil_manglende_frist som lest feed.';

-- Siste innhenting per kilde. Fristjobbens rader holdes utenfor, så en 403
-- derfra ikke slår alarm på kilden mens RSS-innhentingen virker.
create or replace view public.kilde_alarmer
with (security_invoker = true) as
select
  k.id as kilde_id,
  k.navn,
  k.adapter,
  k.organ,
  k.forventer_treff,
  kk.id as kjoring_id,
  kk.kjort,
  kk.status,
  kk.antall_funnet,
  kk.antall_etter_filter,
  kk.antall_nye,
  kk.http_status,
  kk.feilmelding,
  kk.varighet_ms,
  kk.kjoert_av,
  kk.alarm,
  'innhenting'::text as alarmtype
from public.kilder k
join lateral (
  select *
  from public.kilde_kjoringer
  where kilde_id = k.id
    and jobb = 'hent-saker'
  order by kjort desc
  limit 1
) kk on true
where kk.alarm;

comment on view public.kilde_alarmer is
  'Siste hent-saker-kjøring per kilde, bare når den er en alarm. alarmtype er innhenting. security_invoker: følger RLS på kilder og kilde_kjoringer.';

create or replace view public.kilde_alarmer_frister
with (security_invoker = true) as
select
  k.id as kilde_id,
  k.navn,
  k.adapter,
  k.organ,
  k.forventer_treff,
  kk.id as kjoring_id,
  kk.kjort,
  kk.status,
  kk.antall_funnet,
  kk.antall_etter_filter,
  kk.antall_nye,
  kk.http_status,
  kk.feilmelding,
  kk.varighet_ms,
  kk.kjoert_av,
  kk.alarm,
  'frist'::text as alarmtype
from public.kilder k
join lateral (
  select *
  from public.kilde_kjoringer
  where kilde_id = k.id
    and jobb = 'oppdater-frister'
  order by kjort desc
  limit 1
) kk on true
where kk.alarm;

comment on view public.kilde_alarmer_frister is
  'Siste oppdater-frister-kjøring per kilde, bare når den er en alarm. alarmtype er frist. Påvirker ikke kilde_alarmer. security_invoker.';

grant select on public.kilde_alarmer_frister to anon, authenticated, service_role;
