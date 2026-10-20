-- feil_manglende_frist hører hjemme på kilde_kjoringer, ikke på varsler.
-- oppdater-frister eier varsler.status og setter bare kritisk, viktig, normal
-- eller passert. Manglende frist på saken blir normal. Alarm-uttrykket er
-- allerede sant for feil_*, så kjøringen vises i kilde_alarmer.
-- Versjonen ligger etter 20261020240000_oppdater_frister_cron.sql.

comment on column public.kilde_kjoringer.status is
  'ok_nye | ok_ingen_nye | tom | delvis | feil_http | feil_timeout | feil_parse | feil_auth | feil_nett | feil_tomt_svar | feil_manglende_frist. Ikke en verdi i varsler.status.';

comment on column public.kilde_kjoringer.alarm is
  'Sant for feil_* (inkl. feil_tomt_svar og feil_manglende_frist) og delvis. Kildevakt kan filtrere på denne.';
