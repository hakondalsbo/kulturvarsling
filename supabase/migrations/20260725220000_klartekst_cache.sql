-- E2 Klartekst (VEIKART): cache for personlige «hva betyr dette for deg»-
-- forklaringer. Nøkkel = sak + profiltype (org-type|fagfelt|fylke), så samme
-- forklaring gjenbrukes på tvers av like brukere og Claude-kostnaden betales
-- kun én gang per sak+profiltype. sak_id er text (ikke FK) så cachen er robust
-- mot varsler.id-typen; foreldreløse rader er ufarlige (ren cache).
create table if not exists klartekst_cache (
  sak_id      text        not null,
  profiltype  text        not null,
  tekst       jsonb       not null,
  modell      text,
  opprettet   timestamptz not null default now(),
  primary key (sak_id, profiltype)
);

-- Cachen inneholder ingen persondata (kun sak + grov profiltype-forklaring),
-- så lesing er trygt for alle. Skriving skjer kun via service-role i
-- edge-funksjonen forklar-sak, som uansett omgår RLS.
alter table klartekst_cache enable row level security;
drop policy if exists "klartekst lesbar for alle" on klartekst_cache;
create policy "klartekst lesbar for alle" on klartekst_cache for select using (true);
