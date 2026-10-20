-- Dokumenter samtykket de eksisterende påmeldingene faktisk ga, og
-- slå sammen dupliserte adresser. Idempotent. Sletter bare nyere
-- duplikater etter at samtykket er kopiert til den eldste raden.
--
-- Kjør etter 20261019233000_samtykke_avmelding.sql.
--
-- Teksten sto uendret i vente.html fra 2026-03-15 (6fc706ca, da filen het
-- vente.html i rota) til 2026-10-19 (87b2f36), også etter flyttingen til
-- public/. Det finnes derfor bare én historisk versjon.
--
-- Live-tabellen har bare id, epost, fornavn og etternavn. Ingen
-- opprettet-, opprettet_at-, created- eller created_at-kolonne, og
-- track_commit_timestamp er av. samtykke_gitt_at kan ikke settes til
-- påmeldingstidspunktet og forblir NULL. Laveste id er den eldste raden,
-- fordi id-ene kommer fra én sekvens og hver innsetting var sin transaksjon.

insert into public.samtykke_tekster (versjon, tekst, gyldig_fra)
values (
  'venteside-2026-03-15',
  'Ved å melde deg på samtykker du til at Kulturvarsling.no kan kontakte deg med informasjon om lansering og nyheter. Vi deler ikke din e-post med tredjeparter.',
  '2026-03-15T00:00:00Z'
)
on conflict (versjon) do nothing;

do $$
declare
  tidskolonne text;
begin
  select c.column_name into tidskolonne
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'pamelding'
    and c.column_name in ('opprettet_at', 'opprettet', 'created_at', 'created')
  order by array_position(
    array['opprettet_at', 'opprettet', 'created_at', 'created'],
    c.column_name
  )
  limit 1;

  if tidskolonne is null then
    raise notice 'pamelding har verken opprettet, opprettet_at, created eller created_at. samtykke_gitt_at settes ikke, fordi påmeldingstidspunktet ikke finnes.';
    update public.pamelding
      set kilde = 'pamelding-skjema',
          samtykke_tekst_versjon = 'venteside-2026-03-15'
      where samtykke_tekst_versjon is null
        and kilde is null;
  else
    raise notice 'pamelding bruker % som samtykke_gitt_at for historiske rader.', tidskolonne;
    execute format($f$
      update public.pamelding
      set kilde = 'pamelding-skjema',
          samtykke_tekst_versjon = 'venteside-2026-03-15',
          samtykke_gitt_at = coalesce(samtykke_gitt_at, %1$I)
      where samtykke_tekst_versjon is null
        and kilde is null
        and %1$I is not null
        and %1$I < timestamptz '2026-10-19 22:31:00+00'
    $f$, tidskolonne);
    execute format($f$
      update public.pamelding
      set kilde = 'pamelding-skjema',
          samtykke_tekst_versjon = 'venteside-2026-03-15'
      where samtykke_tekst_versjon is null
        and kilde is null
        and %1$I is null
    $f$, tidskolonne);
  end if;
end $$;

-- Kopier samtykke og tomme navn til laveste id før de nyere radene slettes.
update public.pamelding s
set
  fornavn = coalesce(nullif(btrim(s.fornavn), ''), n.fornavn),
  etternavn = coalesce(nullif(btrim(s.etternavn), ''), n.etternavn),
  avmeldt_at = coalesce(s.avmeldt_at, n.avmeldt_at),
  bekreftet_at = coalesce(s.bekreftet_at, n.bekreftet_at),
  samtykke_gitt_at = coalesce(s.samtykke_gitt_at, n.samtykke_gitt_at),
  samtykke_tekst_versjon = coalesce(s.samtykke_tekst_versjon, n.samtykke_tekst_versjon),
  kilde = coalesce(s.kilde, n.kilde)
from (
  select
    epost_normalisert,
    (array_agg(nullif(btrim(fornavn), '') order by id)
      filter (where nullif(btrim(fornavn), '') is not null))[1] as fornavn,
    (array_agg(nullif(btrim(etternavn), '') order by id)
      filter (where nullif(btrim(etternavn), '') is not null))[1] as etternavn,
    min(avmeldt_at) as avmeldt_at,
    min(bekreftet_at) as bekreftet_at,
    min(samtykke_gitt_at) as samtykke_gitt_at,
    (array_agg(samtykke_tekst_versjon order by id)
      filter (where samtykke_tekst_versjon is not null))[1] as samtykke_tekst_versjon,
    (array_agg(kilde order by id)
      filter (where kilde is not null))[1] as kilde
  from public.pamelding
  group by epost_normalisert
  having count(*) > 1
) n
where s.epost_normalisert = n.epost_normalisert
  and s.id = (
    select min(p.id)
    from public.pamelding p
    where p.epost_normalisert = s.epost_normalisert
  );

update public.nyhetsbrev_utsendelser u
set pamelding_id = s.id
from public.pamelding d
join public.pamelding s
  on s.epost_normalisert = d.epost_normalisert
 and s.id < d.id
 and not exists (
   select 1
   from public.pamelding eldre
   where eldre.epost_normalisert = s.epost_normalisert
     and eldre.id < s.id
 )
where u.pamelding_id = d.id;

delete from public.pamelding d
where exists (
  select 1
  from public.pamelding s
  where s.epost_normalisert = d.epost_normalisert
    and s.id < d.id
);

update public.pamelding
set avmeldings_token = gen_random_uuid()
where avmeldings_token is null;

create unique index if not exists pamelding_epost_unik
  on public.pamelding (epost_normalisert);

comment on column public.pamelding.kilde is
  'Opphav. Historiske skjemarader får pamelding-skjema. Nye skjema setter venteside.';
