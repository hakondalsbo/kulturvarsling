-- Kjør før 20261020240000_oppdater_frister_cron.sql.
-- Den migrasjonen og fristlogikken setter status 'passert'. Prod-constrainten
-- varsler_status_check tillater bare kritisk, viktig og normal, så oppdateringen
-- feiler med 23514. Eksisterende rader har bare de tre verdiene, så den nye
-- sjekken kan valideres med en gang. Null status er fortsatt tillatt.

alter table public.varsler drop constraint if exists varsler_status_check;

alter table public.varsler
  add constraint varsler_status_check
  check (status = any (array['kritisk'::text, 'viktig'::text, 'normal'::text, 'passert'::text]));
