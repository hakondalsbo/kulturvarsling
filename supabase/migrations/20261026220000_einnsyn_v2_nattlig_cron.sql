-- Nattlig eInnsyn v2. pg_cron er UTC, så 01:00 UTC er 02:00 norsk
-- vintertid og 03:00 sommertid. Morgenjobben hent-saker-daglig (06:00 UTC)
-- røres ikke og kaller ikke eInnsyn når EINNSYN_V2_AKTIV er true.
--
-- Kommandoen klones fra hent-saker-daglig (Vault-headere og timeout beholdes)
-- og får kilder=["einnsyn"]. Ukjent body-format planlegger ikke jobben, så
-- en full hent-saker ikke starter kl. 02:00. Ingen nye hemmeligheter.
-- Med flagget av svarer kallet 200 uten skriving.

do $cron$
declare
  cmd text;
  opprinnelig text;
begin
  if exists (select 1 from cron.job where jobname = 'einnsyn-v2-nattlig') then
    perform cron.unschedule('einnsyn-v2-nattlig');
  end if;

  select command into cmd
  from cron.job
  where jobname = 'hent-saker-daglig';

  if cmd is null or position('/functions/v1/hent-saker' in cmd) = 0 then
    raise warning 'einnsyn-v2-nattlig ble ikke planlagt: fant ikke hent-saker-daglig med kjent URL';
    return;
  end if;

  opprinnelig := cmd;

  if position('jsonb_build_object(''utlost_av'', ''pg_cron''' in cmd) > 0 then
    cmd := replace(
      cmd,
      'jsonb_build_object(''utlost_av'', ''pg_cron''',
      'jsonb_build_object(''utlost_av'', ''pg_cron'', ''kilder'', jsonb_build_array(''einnsyn'')'
    );
  elsif position('"utlost_av":"pg_cron"' in cmd) > 0 then
    cmd := replace(
      cmd,
      '"utlost_av":"pg_cron"',
      '"utlost_av":"pg_cron","kilder":["einnsyn"]'
    );
  elsif position('"utlost_av": "pg_cron"' in cmd) > 0 then
    cmd := replace(
      cmd,
      '"utlost_av": "pg_cron"',
      '"utlost_av": "pg_cron", "kilder": ["einnsyn"]'
    );
  else
    raise warning 'einnsyn-v2-nattlig ble ikke planlagt: kjenner ikke body-formatet i hent-saker-daglig';
    return;
  end if;

  if position('/functions/v1/hent-saker' in cmd) = 0
     or position('einnsyn' in cmd) = 0
     or cmd = opprinnelig then
    raise warning 'einnsyn-v2-nattlig ble ikke planlagt: klarte ikke å sette kilder uten å endre URL';
    return;
  end if;

  perform cron.schedule('einnsyn-v2-nattlig', '0 1 * * *', cmd);
end
$cron$;
