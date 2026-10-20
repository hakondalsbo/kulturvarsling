-- Additivt. Låser redaktørens tittel, sammendrag og kategori når
-- manuelt_redigert er satt. Frist og andre felt kan fortsatt fylles.
-- Rette også dataspillhøringen som fortsatt har avvisningsteksten, og
-- skriv om &amp; i kilde så lenken og den unike nøkkelen stemmer.
-- Ikke security definer. Endrer ikke eldre migrasjoner.

alter table public.varsler
  add column if not exists manuelt_redigert boolean not null default false;

alter table public.varsler
  add column if not exists manuelt_redigert_at timestamptz;

comment on column public.varsler.manuelt_redigert is
  'Sant når en redaktør har satt tittel, sammendrag eller kategori. De tre feltene skal ikke overskrives av backfill, klartekst eller geografi. Manglende frist kan fortsatt settes.';

comment on column public.varsler.manuelt_redigert_at is
  'Når manuelt_redigert ble satt. Fylles av triggeren hvis oppdateringen ikke satte tidspunktet selv.';

-- 23 rader i prod hadde bokstavelig &amp; fra RSS-parseren. Ingen kollisjon
-- mot allerede dekodede URL-er (sjekket 2026-10-20). Rader som ville krasje
-- den unike nøkkelen hoppes over.
update public.varsler v
set kilde = replace(v.kilde, '&amp;', '&')
where v.kilde like '%&amp;%'
  and not exists (
    select 1
    from public.varsler annen
    where annen.id <> v.id
      and annen.kilde_nokkel = public.normaliser_kilde_url(replace(v.kilde, '&amp;', '&'))
  );

create or replace function public.vern_manuelt_redigerte_felt()
returns trigger
language plpgsql
set search_path = pg_catalog
as $fn$
begin
  -- Dataspillhøringen kan ha fått flagget mens sammendraget fortsatt er
  -- avvisningsteksten. Den ene korreksjonen får skrive teksten. Etterpå
  -- gjelder vernet.
  if old.manuelt_redigert
     and not (
       old.id::text = '90a26730-e886-4a10-a1e5-a08aedaabd17'
       and old.sammendrag = 'Automatisk avvist av relevansfilteret'
     )
  then
    new.tittel := old.tittel;
    new.sammendrag := old.sammendrag;
    new.kategori := old.kategori;
  end if;

  if new.manuelt_redigert and not coalesce(old.manuelt_redigert, false) then
    if new.manuelt_redigert_at is null then
      new.manuelt_redigert_at := now();
    end if;
  end if;

  return new;
end
$fn$;

comment on function public.vern_manuelt_redigerte_felt() is
  'BEFORE UPDATE: beholder tittel, sammendrag og kategori når manuelt_redigert alt er sant. Ikke security definer. Execute er tatt fra anon slik at funksjonen ikke er et API.';

revoke all on function public.vern_manuelt_redigerte_felt() from public;
revoke all on function public.vern_manuelt_redigerte_felt() from anon;
revoke all on function public.vern_manuelt_redigerte_felt() from authenticated;
-- Triggeren kjører som den som oppdaterer raden, og trenger execute.
-- Redaktøren skriver via innlogget sesjon; backfill bruker service_role.
grant execute on function public.vern_manuelt_redigerte_felt() to authenticated, service_role;

drop trigger if exists vern_manuelt_redigerte_felt on public.varsler;
create trigger vern_manuelt_redigerte_felt
  before update on public.varsler
  for each row
  execute function public.vern_manuelt_redigerte_felt();

-- Kjører mens flagget fortsatt er usatt, så triggeren slipper teksten igjennom.
-- Idempotent: bare raden som fortsatt har avvisningsteksten.
update public.varsler
set
  sammendrag = 'Kultur- og likestillingsdepartementet har sendt på høring Lotteri- og stiftelsestilsynets utredning om pengespill-lignende elementer i dataspill, blant annet lootbokser. Høringsfristen er 12. januar 2027.',
  frist = coalesce(frist, '2027-01-12'),
  publisert = true,
  kategori = coalesce(nullif(kategori, ''), 'spill'),
  status = 'normal',
  manuelt_redigert = true,
  manuelt_redigert_at = coalesce(manuelt_redigert_at, now())
where id = '90a26730-e886-4a10-a1e5-a08aedaabd17'
  and sammendrag = 'Automatisk avvist av relevansfilteret';

-- De to andre radene har allerede redaktørtekst. Bare flagget.
-- Dataspill-raden er med så flagget settes selv om sammendraget alt er rettet.
update public.varsler
set
  manuelt_redigert = true,
  manuelt_redigert_at = coalesce(manuelt_redigert_at, now())
where id in (
  'de0dc5a6-fb44-4d5c-aebd-76b9ea10c085',
  'b70f9ea5-b8f2-4a1d-8c6a-2ccf1ec4bf8c',
  '90a26730-e886-4a10-a1e5-a08aedaabd17'
)
  and manuelt_redigert is not true;
