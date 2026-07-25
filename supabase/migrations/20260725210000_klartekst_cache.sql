-- Klartekst-cache (VEIKART E2): ett Claude-svar per sak + profiltype.
-- Samme kombinasjon av sak og profil skal aldri koste to Claude-kall.
-- Kjøres med: supabase db push

create table if not exists klartekst_cache (
  id            uuid primary key default gen_random_uuid(),
  varsel_id     uuid not null references varsler(id) on delete cascade,
  profil_nokkel text not null,
  svar          jsonb not null,
  opprettet     timestamptz not null default now(),
  unique (varsel_id, profil_nokkel)
);

-- Kun edge-funksjonen (service role) leser og skriver cachen.
-- Ingen policyer = anon/authenticated har ikke tilgang.
alter table klartekst_cache enable row level security;
