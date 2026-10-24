-- Mobilisering: fase på varsler, og felles innspill som utvidelse av kampanjer.
-- Ikke kjørt mot prod i denne PR-en. Ingen cron.schedule.
--
-- Hvorfor kampanjer er «felles innspill»:
-- Tabellen har allerede sak_id, tittel, beskrivelse og aktiv, og
-- kampanje_signaturer peker på kampanje_id. Den har null rader.
-- Et eget slag skiller felles innspill fra en senere signaturkampanje,
-- uten en parallell tabell for samme kobling.
--
-- Signaturer leses bare av service_role. Anon har verken SELECT
-- eller INSERT. Authenticated kan bare sette inn kampanje_id,
-- bruker_id, navn og epost, og bare på en aktiv kampanje som
-- ikke er felles innspill. Aggregatet er en SECURITY DEFINER-funksjon
-- som bare returnerer et tall.

do $$
begin
  create type public.varsel_fase as enum (
    'tidlig_signal',
    'utredning_horing',
    'regjeringens_forslag',
    'stortingskomite',
    'vedtak',
    'kommunal_behandling',
    'etterpa'
  );
exception
  when duplicate_object then null;
end
$$;

comment on type public.varsel_fase is
  'Fase varselredaktøren setter for hånd. Null til den er satt. Verdier fra mobiliseringskonseptet.';

alter table public.varsler
  add column if not exists fase public.varsel_fase;

comment on column public.varsler.fase is
  'Null til varselredaktøren setter verdien via sett_varsel_fase. Klienten kan ikke skrive feltet. Automatiske jobber skriver det ikke.';

grant usage on type public.varsel_fase to anon, authenticated, service_role;

create or replace function public.vern_varsel_fase()
returns trigger
language plpgsql
set search_path = pg_catalog
as $fn$
begin
  if tg_op = 'INSERT' and new.fase is not null
     and coalesce(pg_catalog.current_setting('app.varsel_fase', true), '') <> '1' then
    raise exception 'Fase kan bare settes med sett_varsel_fase'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.fase is distinct from old.fase
     and coalesce(pg_catalog.current_setting('app.varsel_fase', true), '') <> '1' then
    raise exception 'Fase kan bare settes med sett_varsel_fase'
      using errcode = '42501';
  end if;
  return new;
end
$fn$;

comment on function public.vern_varsel_fase() is
  'Slipper fase-endring bare når sett_varsel_fase har satt app.varsel_fase i transaksjonen.';

revoke all on function public.vern_varsel_fase() from public, anon, authenticated;
grant execute on function public.vern_varsel_fase() to service_role;

drop trigger if exists vern_varsel_fase on public.varsler;
create trigger vern_varsel_fase
  before insert or update on public.varsler
  for each row
  execute function public.vern_varsel_fase();

create or replace function public.sett_varsel_fase(
  p_id uuid,
  p_fase text,
  p_hvem text
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  claims json := nullif(current_setting('request.jwt.claims', true), '')::json;
  jwt_rolle text := coalesce(claims->>'role', nullif(current_setting('request.jwt.claim.role', true), ''));
  er_redaktor boolean := coalesce(claims->'app_metadata'->>'rolle', '') = 'redaktor';
  rolle text := coalesce(jwt_rolle, session_user);
  fra text;
  til public.varsel_fase;
begin
  if rolle not in ('service_role', 'postgres') and not er_redaktor then
    raise exception 'sett_varsel_fase kan bare kalles av service_role, postgres eller redaktør'
      using errcode = '42501';
  end if;
  if p_hvem is null or length(btrim(p_hvem)) = 0 then
    raise exception 'sett_varsel_fase krever hvem som gjør endringen'
      using errcode = '22023';
  end if;
  if p_fase is null or length(btrim(p_fase)) = 0 then
    til := null;
  else
    til := btrim(p_fase)::public.varsel_fase;
  end if;

  select fase::text into fra from public.varsler where id = p_id;
  if not found then
    raise exception 'Fant ikke saken som skulle få fase'
      using errcode = 'P0002';
  end if;

  perform set_config('app.varsel_fase', '1', true);
  update public.varsler set fase = til where id = p_id;

  insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
  values (p_id, 'fase', fra, til::text, left(btrim(p_hvem), 200));
end
$fn$;

comment on function public.sett_varsel_fase(uuid, text, text) is
  'Eneste vei til å sette varsler.fase. service_role, postgres eller JWT med app_metadata.rolle = redaktor. Logger i varsel_endringslogg.';

revoke all on function public.sett_varsel_fase(uuid, text, text) from public;
revoke all on function public.sett_varsel_fase(uuid, text, text) from anon;
revoke all on function public.sett_varsel_fase(uuid, text, text) from authenticated;
grant execute on function public.sett_varsel_fase(uuid, text, text) to authenticated, service_role;

alter table public.kampanjer
  add column if not exists slag text,
  add column if not exists mottaker text,
  add column if not exists innsendingslenke text,
  add column if not exists utkast text,
  add column if not exists planlagt_dato date,
  add column if not exists sendt_tid timestamptz,
  add column if not exists avsluttet_tid timestamptz;

alter table public.kampanjer drop constraint if exists kampanjer_slag_chk;
alter table public.kampanjer
  add constraint kampanjer_slag_chk
  check (slag is null or slag in ('felles_innspill', 'signaturkampanje'));

comment on column public.kampanjer.slag is
  'felles_innspill er et høringssvar eller en uttalelse som kan signeres. Null eller signaturkampanje er ikke felles innspill.';

alter table public.kampanje_signaturer
  add column if not exists samtykke_tekst_versjon text,
  add column if not exists samtykke_gitt_tid timestamptz,
  add column if not exists samtykke_vist text,
  add column if not exists synlighet text,
  add column if not exists token_hash text,
  add column if not exists bekreftet_tid timestamptz,
  add column if not exists trukket_tid timestamptz,
  add column if not exists trekk_forespurt_tid timestamptz,
  add column if not exists slettes_etter timestamptz,
  add column if not exists epost_slettes_etter timestamptz,
  add column if not exists organisasjonsnavn text,
  add column if not exists rolle text,
  add column if not exists kommune text,
  add column if not exists varsel_id uuid,
  add column if not exists minstealder_bekreftet boolean not null default false;

update public.kampanje_signaturer
set synlighet = 'skjult'
where synlighet is null;

alter table public.kampanje_signaturer
  alter column synlighet set default 'skjult';

alter table public.kampanje_signaturer drop constraint if exists kampanje_signaturer_synlighet_chk;
alter table public.kampanje_signaturer
  add constraint kampanje_signaturer_synlighet_chk
  check (synlighet in ('skjult', 'fornavn_kommune', 'organisasjon'));

alter table public.kampanje_signaturer
  alter column synlighet set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'kampanje_signaturer_varsel_id_fkey'
  ) then
    alter table public.kampanje_signaturer
      add constraint kampanje_signaturer_varsel_id_fkey
      foreign key (varsel_id) references public.varsler (id) on delete set null;
  end if;
end
$$;

comment on column public.kampanje_signaturer.synlighet is
  'skjult, fornavn_kommune eller organisasjon. Standard er skjult. Nettstedet viser likevel bare antallet til Håkon åpner for navn.';
comment on column public.kampanje_signaturer.slettes_etter is
  'Når navnelisten skal bort: 12 måneder etter innsending, eller 12 måneder etter avslutning hvis innspillet aldri sendes.';
comment on column public.kampanje_signaturer.epost_slettes_etter is
  'E-post slettes 30 dager etter innsending. Ved innspill som aldri sendes, samme tidspunkt som slettes_etter.';

create unique index if not exists kampanje_signaturer_token_hash_idx
  on public.kampanje_signaturer (token_hash)
  where token_hash is not null;

create index if not exists kampanje_signaturer_bekreftet_idx
  on public.kampanje_signaturer (kampanje_id)
  where bekreftet_tid is not null and trukket_tid is null;

-- «Les signaturer» (USING true) skal være borte.
-- «Signer» fra 20261024170000 sjekket bare auth.uid() = bruker_id,
-- og authenticated hadde INSERT på hele raden. Da kan en innlogget
-- bruker sette bekreftet_tid direkte på et felles innspill og hoppe
-- over e-postbekreftelsen. Policyen slipper nå bare inn en aktiv
-- kampanje som ikke er felles innspill, og bare de fire kolonnene
-- klienten i #32 sender. Felles innspill skrives av service_role.
drop policy if exists "Les signaturer" on public.kampanje_signaturer;
drop policy if exists "Signer" on public.kampanje_signaturer;

revoke select (id, kampanje_id) on table public.kampanje_signaturer from anon, authenticated;
revoke select, update, delete, truncate on table public.kampanje_signaturer from anon, authenticated;
revoke insert on table public.kampanje_signaturer from anon;
revoke insert on table public.kampanje_signaturer from authenticated;
revoke all on table public.kampanje_signaturer from public;
grant select, insert, update, delete on table public.kampanje_signaturer to service_role;
grant insert (kampanje_id, bruker_id, navn, epost) on table public.kampanje_signaturer to authenticated;

create policy "Signer"
  on public.kampanje_signaturer
  for insert
  to authenticated
  with check (
    auth.uid() = bruker_id
    and exists (
      select 1 from public.kampanjer k
      where k.id = kampanje_id
        and k.aktiv
        and k.slag is distinct from 'felles_innspill'
    )
  );

alter table public.kampanje_signaturer enable row level security;

-- «foreslaa_kampanje» i prod er FOR INSERT TO public
-- WITH CHECK (aktiv = false). Forslaget skal ikke kunne sette slag
-- eller de nye fasekolonnene. De skrives av service_role.
drop policy if exists "foreslaa_kampanje" on public.kampanjer;
create policy "foreslaa_kampanje"
  on public.kampanjer
  for insert
  to public
  with check (
    aktiv = false
    and slag is null
    and mottaker is null
    and innsendingslenke is null
    and utkast is null
    and planlagt_dato is null
    and sendt_tid is null
    and avsluttet_tid is null
  );

insert into public.samtykke_tekster (versjon, tekst, gyldig_fra)
values (
  'felles-innspill-2026-10-24',
  $samtykke$Jeg vil signere dette innspillet til [mottaker]. Jeg samtykker til at Kulturvarsling AS lagrer navnet mitt, e-postadressen min og det jeg ellers fyller ut, og at navn, [rolle/organisasjon] og kommune sendes til [mottaker] sammen med innspillet rundt [dato].
Jeg forstår at innspill med navn ofte blir offentlige, for eksempel på regjeringen.no eller stortinget.no. E-postadressen min deles aldri. Den brukes bare til å bekrefte signaturen og si fra hvordan det gikk.
Jeg kan trekke signaturen helt til innspillet er sendt, via lenken i e-posten. E-posten min slettes 30 dager etter innsending, og navnet mitt slettes hos oss etter 12 måneder. Du må være minst 16 år. [Les mer i personvernerklæringen]$samtykke$,
  '2026-10-24T00:00:00Z'
)
on conflict (versjon) do nothing;

create or replace function public.felles_innspill_antall(p_kampanje_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select count(*)::bigint
  from public.kampanje_signaturer s
  join public.kampanjer k on k.id = s.kampanje_id
  where s.kampanje_id = p_kampanje_id
    and k.slag = 'felles_innspill'
    and k.aktiv
    and s.samtykke_gitt_tid is not null
    and s.bekreftet_tid is not null
    and s.trukket_tid is null;
$$;

comment on function public.felles_innspill_antall(uuid) is
  'Antall bekreftede signaturer som ikke er trukket, på et aktivt felles innspill. Ingen navn, e-post eller rader.';

revoke all on function public.felles_innspill_antall(uuid) from public;
grant execute on function public.felles_innspill_antall(uuid) to anon, authenticated, service_role;

create or replace function public.felles_innspill_til_mottaker(p_kampanje_id uuid)
returns table (
  navn text,
  rolle text,
  organisasjonsnavn text,
  kommune text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select s.navn, s.rolle, s.organisasjonsnavn, s.kommune
  from public.kampanje_signaturer s
  join public.kampanjer k on k.id = s.kampanje_id
  where s.kampanje_id = p_kampanje_id
    and k.slag = 'felles_innspill'
    and k.aktiv
    and s.samtykke_gitt_tid is not null
    and s.bekreftet_tid is not null
    and s.trukket_tid is null
    and s.navn is not null;
$$;

comment on function public.felles_innspill_til_mottaker(uuid) is
  'Navneliste til mottakeren, bare for et aktivt felles innspill. Ingen e-postkolonne. Bare service_role.';

revoke all on function public.felles_innspill_til_mottaker(uuid) from public;
revoke all on function public.felles_innspill_til_mottaker(uuid) from anon, authenticated;
grant execute on function public.felles_innspill_til_mottaker(uuid) to service_role;

create or replace function public.merk_innspill_sendt(p_id uuid, p_sendt timestamptz)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  rolle text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json->>'role',
    session_user
  );
begin
  if rolle not in ('service_role', 'postgres') then
    raise exception 'merk_innspill_sendt kan bare kalles av service_role eller postgres'
      using errcode = '42501';
  end if;
  update public.kampanjer
  set sendt_tid = p_sendt, avsluttet_tid = null
  where id = p_id and slag = 'felles_innspill';
  if not found then
    raise exception 'Fant ikke felles innspill som skulle merkes sendt'
      using errcode = 'P0002';
  end if;
  update public.kampanje_signaturer
  set
    epost_slettes_etter = p_sendt + interval '30 days',
    slettes_etter = p_sendt + interval '12 months'
  where kampanje_id = p_id;
end
$fn$;

revoke all on function public.merk_innspill_sendt(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.merk_innspill_sendt(uuid, timestamptz) to service_role;

create or replace function public.merk_innspill_avsluttet(p_id uuid, p_avsluttet timestamptz)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  rolle text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json->>'role',
    session_user
  );
begin
  if rolle not in ('service_role', 'postgres') then
    raise exception 'merk_innspill_avsluttet kan bare kalles av service_role eller postgres'
      using errcode = '42501';
  end if;
  update public.kampanjer
  set avsluttet_tid = p_avsluttet
  where id = p_id and slag = 'felles_innspill' and sendt_tid is null;
  if not found then
    raise exception 'Fant ikke uavsendt felles innspill som skulle avsluttes'
      using errcode = 'P0002';
  end if;
  update public.kampanje_signaturer
  set
    epost_slettes_etter = p_avsluttet + interval '12 months',
    slettes_etter = p_avsluttet + interval '12 months'
  where kampanje_id = p_id;
end
$fn$;

revoke all on function public.merk_innspill_avsluttet(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.merk_innspill_avsluttet(uuid, timestamptz) to service_role;

-- Jobben finnes. Den er ikke planlagt. Ikke legg den i pg_cron.
create or replace function public.slett_utlopte_signaturer(p_naa timestamptz default now())
returns table (epost_slettet integer, navn_slettet integer, rader_slettet integer)
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  rolle text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json->>'role',
    session_user
  );
  n_epost integer := 0;
  n_navn integer := 0;
  n_rader integer := 0;
begin
  if rolle not in ('service_role', 'postgres') then
    raise exception 'slett_utlopte_signaturer kan bare kalles av service_role eller postgres'
      using errcode = '42501';
  end if;

  update public.kampanje_signaturer
  set epost = null
  where epost is not null
    and epost_slettes_etter is not null
    and epost_slettes_etter <= p_naa;
  get diagnostics n_epost = row_count;

  update public.kampanje_signaturer s
  set
    navn = null,
    epost = null,
    rolle = null,
    organisasjonsnavn = null,
    kommune = null,
    token_hash = null,
    samtykke_vist = null
  from public.kampanjer k
  where s.kampanje_id = k.id
    and k.sendt_tid is not null
    and s.slettes_etter is not null
    and s.slettes_etter <= p_naa
    and (s.navn is not null or s.token_hash is not null or s.epost is not null);
  get diagnostics n_navn = row_count;

  delete from public.kampanje_signaturer s
  using public.kampanjer k
  where s.kampanje_id = k.id
    and k.sendt_tid is null
    and s.slettes_etter is not null
    and s.slettes_etter <= p_naa;
  get diagnostics n_rader = row_count;

  return query select n_epost, n_navn, n_rader;
end
$fn$;

comment on function public.slett_utlopte_signaturer(timestamptz) is
  'Sletter e-post 30 dager etter innsending og navn etter 12 måneder. Uten innsending slettes raden etter 12 måneder. Ikke planlagt i cron.';

revoke all on function public.slett_utlopte_signaturer(timestamptz) from public, anon, authenticated;
grant execute on function public.slett_utlopte_signaturer(timestamptz) to service_role;

create table if not exists public.mobiliser_forsok (
  id bigint generated always as identity primary key,
  nokkel text not null,
  opprettet_at timestamptz not null default now()
);

alter table public.mobiliser_forsok enable row level security;
revoke all on table public.mobiliser_forsok from anon, authenticated, public;
grant select, insert, update, delete on table public.mobiliser_forsok to service_role;
revoke all on sequence public.mobiliser_forsok_id_seq from anon, authenticated, public;
grant usage, select on sequence public.mobiliser_forsok_id_seq to service_role;

create index if not exists mobiliser_forsok_nokkel_tid_idx
  on public.mobiliser_forsok (nokkel, opprettet_at);

comment on table public.mobiliser_forsok is
  'Rate-grense for signering. Nøkkelen er en hash, ikke e-post eller IP. Ingen klientrettigheter.';
