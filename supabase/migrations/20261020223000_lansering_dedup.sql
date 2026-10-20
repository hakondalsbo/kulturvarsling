-- Dedup for én lanseringsmail per adresse. Sender ingen e-post og
-- oppretter ingen tidsplan. Eksisterende rader i pamelding røres ikke.

alter table public.bekreftelse_utsendelser
  drop constraint if exists bekreftelse_utsendelser_status_chk;

alter table public.bekreftelse_utsendelser
  add constraint bekreftelse_utsendelser_status_chk
  check (status in (
    'sendt',
    'feilet',
    'ikke_konfigurert',
    'duplikat',
    'reservert',
    'lansering_sendt',
    'lansering_reservert',
    'lansering_feilet',
    'lansering_duplikat',
    'test_sendt'
  ));

create unique index if not exists bekreftelse_utsendelser_lansering_epost_unik
  on public.bekreftelse_utsendelser (lower(btrim(epost_normalisert)))
  where status in ('lansering_sendt', 'lansering_reservert');

create unique index if not exists bekreftelse_utsendelser_pamelding_aktiv_unik
  on public.bekreftelse_utsendelser (pamelding_id)
  where status in ('sendt', 'reservert') and pamelding_id is not null;

comment on index public.bekreftelse_utsendelser_lansering_epost_unik is
  'Hindrer to lanseringsmailer til samme adresse, også ved parallelle kall.';
