-- Kjør etter alle historiske migrasjoner.
--
-- To eldre filer er ikke idempotente mot dagens prod, og skal ikke endres:
--   20260725180000_nattlig_cron.sql skriver om hent-saker-daglig
--     til en kommando med innebygd plattformnøkkel.
--   20261020210000_manuelt_redigert.sql skriver om
--     vern_manuelt_redigerte_felt til versjonen før overstyr_varsel.
--   20261020130000 setter kortere kommentarer på kilde_kjoringer.status
--     og alarm enn prod har etter feil_manglende_frist.
--
-- Denne filen legger prod-definisjonen tilbake. Mot prod er den et no-op
-- i resultatet: samme funksjonskropp, samme kommentarer, samme cron-kommando.
-- Ingen hemmelige verdier.

create or replace function public.vern_manuelt_redigerte_felt()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $fn$
declare
  hvem text;
begin
  if new.manuelt_redigert and not coalesce(old.manuelt_redigert, false) then
    if new.manuelt_redigert_at is null then
      new.manuelt_redigert_at := now();
    end if;
  end if;

  if old.manuelt_redigert
     and (
       new.tittel is distinct from old.tittel
       or new.sammendrag is distinct from old.sammendrag
       or new.kategori is distinct from old.kategori
       or new.frist is distinct from old.frist
       or new.motedato is distinct from old.motedato
       or new.status is distinct from old.status
     )
  then
    if coalesce(pg_catalog.current_setting('app.varsel_overstyr', true), '') = '1' then
      hvem := coalesce(nullif(pg_catalog.current_setting('app.varsel_hvem', true), ''), 'ukjent');
      if new.tittel is distinct from old.tittel then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'tittel', old.tittel, new.tittel, hvem);
      end if;
      if new.sammendrag is distinct from old.sammendrag then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'sammendrag', old.sammendrag, new.sammendrag, hvem);
      end if;
      if new.kategori is distinct from old.kategori then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'kategori', old.kategori, new.kategori, hvem);
      end if;
      if new.frist is distinct from old.frist then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'frist', old.frist::text, new.frist::text, hvem);
      end if;
      if new.motedato is distinct from old.motedato then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'motedato', old.motedato::text, new.motedato::text, hvem);
      end if;
      if new.status is distinct from old.status then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'status', old.status, new.status, hvem);
      end if;
    else
      raise exception 'Kan ikke endre tittel, sammendrag, kategori, frist, møtedato eller status fordi saken er manuelt redigert. Bruk overstyr_varsel.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end
$fn$;

comment on function public.vern_manuelt_redigerte_felt() is
  'BEFORE UPDATE: feiler tydelig hvis tittel, sammendrag, kategori, frist, møtedato eller status endres på en manuelt redigert sak, også når feltet var tomt. Slipper endringen gjennom bare når overstyr_varsel har satt app.varsel_overstyr i transaksjonen, og logger da feltet.';

revoke all on function public.vern_manuelt_redigerte_felt() from public, anon;
grant execute on function public.vern_manuelt_redigerte_felt() to authenticated, service_role;

comment on column public.kilde_kjoringer.status is
  'ok_nye | ok_ingen_nye | tom | delvis | feil_http | feil_timeout | feil_parse | feil_auth | feil_nett | feil_tomt_svar | feil_manglende_frist. Ikke en verdi i varsler.status.';

comment on column public.kilde_kjoringer.alarm is
  'Sant for feil_* (inkl. feil_tomt_svar og feil_manglende_frist) og delvis. Kildevakt kan filtrere på denne.';

select cron.schedule(
  'hent-saker-daglig',
  '0 6 * * *',
  $cron$
  select net.http_post(
    url := 'https://zyyijlvmgoanjdzngmon.supabase.co/functions/v1/hent-saker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='hent_saker_platform_jwt'),
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='hent_saker_platform_jwt'),
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='hent_saker_cron_secret')
    ),
    body := jsonb_build_object('utlost_av','pg_cron','tidspunkt',now()),
    timeout_milliseconds := 120000
  ) as request_id;
  $cron$
);

select cron.schedule(
  'oppdater-frister-daglig',
  '30 6 * * *',
  $cron$
  select net.http_post(
    url := 'https://zyyijlvmgoanjdzngmon.supabase.co/functions/v1/oppdater-frister',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='hent_saker_platform_jwt'),
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='hent_saker_platform_jwt'),
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='hent_saker_cron_secret')
    ),
    body := jsonb_build_object('utlost_av','pg_cron','tidspunkt',now()),
    timeout_milliseconds := 120000
  ) as request_id;
  $cron$
);
