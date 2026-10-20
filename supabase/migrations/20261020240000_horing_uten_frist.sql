-- Ny kjørestatus når en Regjeringen-høring lagres uten frist.
-- alarm er allerede generert som feil_* eller delvis, så feil_manglende_frist
-- vises i kilde_alarmer uten å endre uttrykket.
-- Versjon 20261020240000 så den ikke kolliderer med kilde_id-migrasjonen.

comment on column public.kilde_kjoringer.status is
  'ok_nye | ok_ingen_nye | tom | delvis | feil_http | feil_timeout | feil_parse | feil_auth | feil_nett | feil_tomt_svar | feil_manglende_frist';

comment on column public.kilde_kjoringer.alarm is
  'Sant for feil_* (inkl. feil_tomt_svar og feil_manglende_frist) og delvis. Kildevakt kan filtrere på denne.';
