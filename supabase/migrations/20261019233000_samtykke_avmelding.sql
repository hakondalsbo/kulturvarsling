-- Samtykke, dobbel opt-in og avmelding for nyhetsbrevlisten.
-- Additivt: ingen sletting, og ingen backfill av de eksisterende radene.
-- kilde forblir NULL på dagens rader. De kan senere merkes
-- 'gammel_liste_uten_dokumentert_samtykke' av Håkon. Denne filen gjør det ikke.
--
-- avmeldings_token får default kun for fremtidige INSERT. Eksisterende rader
-- forblir NULL (SET DEFAULT skriver ikke om gamle rader).

alter table public.pamelding
  add column if not exists samtykke_gitt_at timestamptz,
  add column if not exists samtykke_tekst_versjon text,
  add column if not exists kilde text,
  add column if not exists bekreftet_at timestamptz,
  add column if not exists avmeldt_at timestamptz,
  add column if not exists avmeldings_token uuid,
  add column if not exists bekreftelses_token uuid,
  add column if not exists epost_normalisert text
    generated always as (lower(btrim(epost))) stored;

alter table public.pamelding
  alter column avmeldings_token set default gen_random_uuid();

comment on column public.pamelding.kilde is
  'Opphav. Nye skjema setter venteside. Eksisterende rader røres ikke og kan senere settes til gammel_liste_uten_dokumentert_samtykke. Ingen backfill.';

comment on column public.pamelding.samtykke_gitt_at is
  'Tidspunkt da et dokumentert samtykke ble lagret. NULL betyr at samtykket ikke er dokumentert.';

comment on column public.pamelding.bekreftet_at is
  'Dobbel opt-in. NULL betyr at bekreftelseslenken ikke er klikket.';

comment on column public.pamelding.avmeldt_at is
  'Satt når mottakeren melder seg av. NULL betyr ikke avmeldt.';

create unique index if not exists pamelding_avmeldings_token_idx
  on public.pamelding (avmeldings_token);

create unique index if not exists pamelding_bekreftelses_token_idx
  on public.pamelding (bekreftelses_token);

create index if not exists pamelding_epost_normalisert_idx
  on public.pamelding (epost_normalisert);

create index if not exists pamelding_klar_til_utsending_idx
  on public.pamelding (epost_normalisert)
  where samtykke_gitt_at is not null
    and bekreftet_at is not null
    and avmeldt_at is null;

-- Direkte innsetting fra nettleseren stenges. Påmelding går via meld-pa.
drop policy if exists "Åpen påmelding" on public.pamelding;

revoke all on table public.pamelding from anon, authenticated;
revoke all on table public.pamelding from PUBLIC;
revoke all on sequence public.pamelding_id_seq from anon, authenticated;
revoke all on sequence public.pamelding_id_seq from PUBLIC;

grant select, insert, update, delete on table public.pamelding to service_role;
grant usage, select on sequence public.pamelding_id_seq to service_role;

-- Revisjonsspor for samtykketeksten. Ikke en oppdatering av påmeldingsradene.
create table if not exists public.samtykke_tekster (
  versjon text primary key,
  tekst text not null,
  gyldig_fra timestamptz not null default now()
);

insert into public.samtykke_tekster (versjon, tekst, gyldig_fra)
values (
  'nyhetsbrev-2026-10',
  'Ja, jeg vil motta Kulturvarslings nyhetsbrev på e-post (ca. ukentlig) med kulturpolitiske saker og frister. Jeg kan melde meg av når som helst.',
  '2026-10-19T00:00:00Z'
)
on conflict (versjon) do nothing;

alter table public.samtykke_tekster enable row level security;
revoke all on table public.samtykke_tekster from anon, authenticated;
revoke all on table public.samtykke_tekster from PUBLIC;
grant select, insert, update, delete on table public.samtykke_tekster to service_role;

-- Én rad per forsøk på å sende et brev til en påmelding.
create table if not exists public.nyhetsbrev_utsendelser (
  id bigint generated always as identity primary key,
  utsendelse_id uuid not null,
  pamelding_id bigint references public.pamelding (id) on delete cascade,
  sendt_at timestamptz not null default now(),
  resend_id text,
  status text not null
);

create index if not exists nyhetsbrev_utsendelser_utsendelse_idx
  on public.nyhetsbrev_utsendelser (utsendelse_id);

create index if not exists nyhetsbrev_utsendelser_pamelding_idx
  on public.nyhetsbrev_utsendelser (pamelding_id);

alter table public.nyhetsbrev_utsendelser enable row level security;
revoke all on table public.nyhetsbrev_utsendelser from anon, authenticated;
revoke all on table public.nyhetsbrev_utsendelser from PUBLIC;
grant select, insert, update, delete on table public.nyhetsbrev_utsendelser to service_role;
grant usage, select on sequence public.nyhetsbrev_utsendelser_id_seq to service_role;

-- Enkel misbruksvern for meld-pa. Ingen personopplysninger, bare hash-nøkler.
create table if not exists public.meld_pa_forsok (
  id bigint generated always as identity primary key,
  nokkel text not null,
  opprettet_at timestamptz not null default now()
);

create index if not exists meld_pa_forsok_nokkel_tid_idx
  on public.meld_pa_forsok (nokkel, opprettet_at desc);

alter table public.meld_pa_forsok enable row level security;
revoke all on table public.meld_pa_forsok from anon, authenticated;
revoke all on table public.meld_pa_forsok from PUBLIC;
grant select, insert, update, delete on table public.meld_pa_forsok to service_role;
grant usage, select on sequence public.meld_pa_forsok_id_seq to service_role;

-- Konto-samtykke fra onboarding. Nyhetsbrevlisten er en annen tabell.
alter table public.profiler
  add column if not exists personvern_akseptert_at timestamptz,
  add column if not exists personvern_versjon text;

comment on column public.profiler.personvern_versjon is
  'Versjon av personvernerklæringen som ble akseptert, f.eks. personvern-2026-10.';
