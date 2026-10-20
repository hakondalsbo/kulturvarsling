-- Probe for PR #14. Kjør i én transaksjon mot prod og avslutt med ROLLBACK:
--   1. opprett auth.users (handle_new_user lager profilraden)
--   2. kjør supabase/migrations/20261020162805_profiler_plan_skrivevern.sql
--   3. kjør blokken under som authenticated med request.jwt.claims
--   4. rollback
--
-- Blokken forutsetter uid aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01
-- og tabellen _probe_skriv (kolonne, utfall, etter).

-- Gammel sti: PostgREST upsert setter id = EXCLUDED.id og krever UPDATE på id.
begin
  insert into public.profiler as p (id, navn, onboarding_done, oppdatert)
  values (uid, 'Gammel upsert', false, now())
  on conflict (id) do update set
    id = excluded.id,
    navn = excluded.navn,
    onboarding_done = excluded.onboarding_done,
    oppdatert = excluded.oppdatert;
  insert into _probe_skriv values ('gammel_upsert', 'skrevet', null);
exception when others then
  insert into _probe_skriv values ('gammel_upsert', sqlstate || ' ' || sqlerrm, null);
end;

-- Registrering slik upsertProfil kaller den etter fiksen.
begin
  update public.profiler
  set navn = 'Fra skjema', onboarding_done = false, oppdatert = now()
  where id = uid;
  insert into _probe_skriv values (
    'registrering', 'skrevet',
    (select navn || '/' || onboarding_done::text || '/' || plan || '/' || coalesce(stripe_customer_id, 'tom')
     from public.profiler where id = uid)
  );
exception when others then
  insert into _probe_skriv values ('registrering', sqlstate || ' ' || sqlerrm, null);
end;

-- Onboarding fullfør med personvern-samtykke.
begin
  update public.profiler
  set org = 'Probeorg',
      org_type = 'kunstner',
      fagfelt = array['musikk'],
      varsel_frekvens = 'daglig',
      onboarding_done = true,
      personvern_akseptert_at = now(),
      personvern_versjon = 'personvern-2026-10',
      oppdatert = now()
  where id = uid;
  insert into _probe_skriv values (
    'onboarding', 'skrevet',
    (select org || '/' || org_type || '/' || fagfelt::text || '/' || onboarding_done::text
            || '/' || personvern_versjon || '/' || plan
     from public.profiler where id = uid)
  );
exception when others then
  insert into _probe_skriv values ('onboarding', sqlstate || ' ' || sqlerrm, null);
end;

-- Payload med plan skal fortsatt avvises.
begin
  update public.profiler set plan = 'premium', oppdatert = now() where id = uid;
  insert into _probe_skriv values ('plan_i_payload', 'skrevet', (select plan from public.profiler where id = uid));
exception when others then
  insert into _probe_skriv values ('plan_i_payload', sqlstate || ' ' || sqlerrm, (select plan from public.profiler where id = uid));
end;
