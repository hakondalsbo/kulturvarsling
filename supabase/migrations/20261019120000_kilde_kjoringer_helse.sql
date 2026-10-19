-- Strukturert kildehelse (Kildevakt). Additivt: eksisterende rader og
-- kolonner røres ikke. antall_funnet beholder navnet og betyr heretter
-- råtreff FØR nøkkelordfilter og FØR dedup (raatt_antall).
--
-- status (fri tekst, gamle verdier ok/tom/feil blir liggende til neste kjøring):
--   ok_nye | ok_ingen_nye | tom | delvis
--   feil_http | feil_timeout | feil_parse | feil_auth | feil_nett
-- kjoert_av: supabase_cron | vercel_cron | manuell

alter table kilde_kjoringer
  add column if not exists http_status integer,
  add column if not exists antall_etter_filter integer,
  add column if not exists kjoert_av text;

comment on column kilde_kjoringer.antall_funnet is
  'Råtreff før nøkkelordfilter og før dedup (raatt_antall).';
comment on column kilde_kjoringer.antall_etter_filter is
  'Antall etter relevans-/nøkkelordfilter, før dedup mot lagrede varsler.';
comment on column kilde_kjoringer.http_status is
  'HTTP-status ved feil_http/feil_auth, eller første feilende kall ved delvis.';
comment on column kilde_kjoringer.kjoert_av is
  'supabase_cron | vercel_cron | manuell. Utledes av body.utlost_av / header.';
comment on column kilde_kjoringer.status is
  'ok_nye | ok_ingen_nye | tom | delvis | feil_http | feil_timeout | feil_parse | feil_auth | feil_nett';
