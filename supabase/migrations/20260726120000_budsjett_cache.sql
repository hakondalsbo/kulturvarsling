-- Cache for budsjettverktøyet (VEIKART E4). KOSTRA-tall + Claude-tolkning per
-- kommune. Tallene endres årlig, så cachen kan leve lenge. Uten tabellen virker
-- funksjonen fortsatt (den cacher bare ikke → Claude betales per oppslag).

create table if not exists budsjett_cache (
  kommunenr  text        not null primary key,
  data       jsonb       not null,
  opprettet  timestamptz not null default now()
);
alter table budsjett_cache enable row level security;
-- Kun service-rollen (Edge Function) skriver; ingen lesepolicy = ikke lesbar
-- direkte fra frontend (går alltid via funksjonen).
