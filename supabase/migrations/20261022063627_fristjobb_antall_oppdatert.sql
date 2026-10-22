-- oppdater-frister oppdaterer frist og møtedato på eksisterende varsler.
-- Den skrev tallet i antall_nye og status ok_nye, så statistikken over
-- nye saker ble feil. antall_nye er nye varsler fra hent-saker.
-- antall_oppdatert er rader som fikk ny frist eller møtedato.
-- Ingen skriving til manuelt_redigert. Ingen endring av varsler.

alter table public.kilde_kjoringer
  add column if not exists antall_oppdatert integer;

comment on column public.kilde_kjoringer.antall_nye is
  'Nye varsler satt inn av hent-saker. Alltid 0 for jobb oppdater-frister. Summer bare der jobb = hent-saker. kilde_alarmer er allerede begrenset til den jobben.';

comment on column public.kilde_kjoringer.antall_oppdatert is
  'Eksisterende varsler som fikk ny frist eller møtedato i oppdater-frister. Ikke nye saker. Null for hent-saker.';

comment on column public.kilde_kjoringer.status is
  'ok_nye | ok_ingen_nye | tom | delvis | feil_http | feil_timeout | feil_parse | feil_auth | feil_nett | feil_tomt_svar | feil_manglende_frist | http_feil | ok_oppdatert | ok_ingen_oppdatering. De to siste er oppdater-frister og betyr frist eller møtedato, ikke nye varsler. http_feil, ok_oppdatert og ok_ingen_oppdatering setter ikke alarm. feil_* og delvis gjør det.';

-- Flytt feiltellingen før sjekken under. antall_nye på fristjobben var
-- antall rader som fikk ny frist eller møtedato.
update public.kilde_kjoringer
set
  antall_oppdatert = coalesce(antall_oppdatert, antall_nye),
  antall_nye = 0,
  status = case status
    when 'ok_nye' then 'ok_oppdatert'
    else status
  end
where jobb = 'oppdater-frister'
  and antall_nye > 0;

update public.kilde_kjoringer
set status = case
  when coalesce(antall_oppdatert, 0) > 0 then 'ok_oppdatert'
  else 'ok_ingen_oppdatering'
end
where jobb = 'oppdater-frister'
  and status in ('ok_nye', 'ok_ingen_nye');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kilde_kjoringer_frist_ikke_nye'
      and conrelid = 'public.kilde_kjoringer'::regclass
  ) then
    alter table public.kilde_kjoringer
      add constraint kilde_kjoringer_frist_ikke_nye
      check (jobb <> 'oppdater-frister' or antall_nye is null or antall_nye = 0);
  end if;
end $$;

-- Siste fristkjøring. antall_nye er 0. Antall endrede saker er antall_oppdatert.
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
  'frist'::text as alarmtype,
  kk.antall_oppdatert
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
  'Siste oppdater-frister-kjøring per kilde, bare når den er en alarm. alarmtype er frist. antall_nye er 0. Endrede frister og møtedatoer ligger i antall_oppdatert. Påvirker ikke kilde_alarmer.';

comment on view public.kilde_alarmer is
  'Siste hent-saker-kjøring per kilde, bare når den er en alarm. alarmtype er innhenting. antall_nye her er nye varsler, fordi visningen bare tar jobb = hent-saker.';
