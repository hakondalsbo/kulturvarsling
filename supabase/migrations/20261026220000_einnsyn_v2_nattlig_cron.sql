-- Nattlig eInnsyn v2, delt i fire bolker. pg_cron er UTC.
-- 01:00, 01:10, 01:20 og 01:30 UTC er 02:00–02:30 norsk vintertid
-- og 03:00–03:30 sommertid. Morgenjobben hent-saker-daglig (06:00 UTC)
-- røres ikke og kaller ikke eInnsyn når EINNSYN_V2_AKTIV er true.
--
-- Kommandoen bygges her, ikke ved å klone hent-saker-daglig. Prod-jobben
-- bruker jsonb_build_object uten mellomrom, og en streng-match mot varianten
-- med mellomrom planla ingenting og returnerte bare en advarsel.
-- URL-en leses fra morgenjobben. Headere leses fra Vault ved kjøring:
-- hent_saker_platform_jwt og hent_saker_cron_secret. Timeout er 120000 ms.
-- Mangler URL eller en hemmelighet, feiler migrasjonen.
--
-- Gratisplanens veggklokke er 150 s, også for EdgeRuntime.waitUntil.
-- Hver bolk søker sin andel av organene og skal være ferdig under 110 s.
-- Med flagget av svarer kallet 200 uten skriving.
-- Gammel enkeltjobb einnsyn-v2-nattlig tas ned hvis den finnes.

do $cron$
declare
  morgen text;
  url text;
  jwt_ok boolean;
  secret_ok boolean;
  cmd text;
  navn text;
  bolk int;
  nar text;
begin
  select command into morgen
  from cron.job
  where jobname = 'hent-saker-daglig';

  if morgen is null then
    raise exception 'einnsyn-v2-bolk ble ikke planlagt: fant ikke jobben hent-saker-daglig';
  end if;

  url := substring(morgen from 'https://[^''[:space:]]+/functions/v1/hent-saker');
  if url is null or position('/functions/v1/hent-saker' in url) = 0 then
    raise exception 'einnsyn-v2-bolk ble ikke planlagt: hent-saker-daglig mangler URL /functions/v1/hent-saker';
  end if;

  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'hent_saker_platform_jwt'
      and coalesce(decrypted_secret, '') <> ''
  ) into jwt_ok;
  if not jwt_ok then
    raise exception 'einnsyn-v2-bolk ble ikke planlagt: Vault-hemmeligheten hent_saker_platform_jwt mangler';
  end if;

  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'hent_saker_cron_secret'
      and coalesce(decrypted_secret, '') <> ''
  ) into secret_ok;
  if not secret_ok then
    raise exception 'einnsyn-v2-bolk ble ikke planlagt: Vault-hemmeligheten hent_saker_cron_secret mangler';
  end if;

  foreach navn in array ARRAY[
    'einnsyn-v2-nattlig',
    'einnsyn-v2-bolk-1',
    'einnsyn-v2-bolk-2',
    'einnsyn-v2-bolk-3',
    'einnsyn-v2-bolk-4'
  ]
  loop
    if exists (select 1 from cron.job where jobname = navn) then
      perform cron.unschedule(navn);
    end if;
  end loop;

  for bolk, nar in
    select p.nr, p.tid
    from (values
      (1, '0 1 * * *'::text),
      (2, '10 1 * * *'::text),
      (3, '20 1 * * *'::text),
      (4, '30 1 * * *'::text)
    ) as p(nr, tid)
  loop
    cmd := format($job$
select net.http_post(
  url := %L,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'hent_saker_platform_jwt'),
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'hent_saker_platform_jwt'),
    'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hent_saker_cron_secret')
  ),
  body := jsonb_build_object(
    'utlost_av', 'pg_cron',
    'tidspunkt', now(),
    'kilder', jsonb_build_array('einnsyn'),
    'bolk', %s
  ),
  timeout_milliseconds := 120000
);
$job$, url, bolk);

    perform cron.schedule('einnsyn-v2-bolk-' || bolk::text, nar, cmd);
  end loop;
end
$cron$;
