-- Kilderegister + kjøringslogg (ARKITEKTUR.md §3)
-- Kjøres med: supabase db push  (krever `supabase login` + `supabase link` først)

create table if not exists kilder (
  id            uuid primary key default gen_random_uuid(),
  navn          text not null,
  niva          text not null check (niva in ('nasjonalt','fylke','kommune')),
  organ         text not null,
  kommunenr     text,
  fylkesnr      text,
  adapter       text not null,
  config        jsonb not null default '{}',
  aktiv         boolean default true,
  prioritet     int default 3,
  sist_hentet   timestamptz,
  sist_status   text
);

create table if not exists kilde_kjoringer (
  id            bigint generated always as identity primary key,
  kilde_id      uuid references kilder(id),
  kjort         timestamptz default now(),
  status        text not null,
  antall_funnet int,
  antall_nye    int,
  feilmelding   text,
  varighet_ms   int
);

alter table varsler add column if not exists kilde_id  uuid references kilder(id);
alter table varsler add column if not exists kommunenr text;
alter table varsler add column if not exists fylkesnr  text;
alter table varsler add column if not exists klartekst text;
alter table varsler add column if not exists sakstype  text;

-- RLS: kilderegisteret skal kun leses/skrives av service-rollen (Edge Functions).
alter table kilder enable row level security;
alter table kilde_kjoringer enable row level security;
