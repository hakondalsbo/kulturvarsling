-- Godkjent av Håkon 24.10 kl. 16:36.
--
-- Strammer inn tabellrettigheter for anon og authenticated etter
-- kartleggingen i PR #25. SELECT, REFERENCES, TRIGGER og MAINTENANCE
-- blir stående. service_role og postgres røres ikke.
-- public.varsler er allerede uten INSERT, UPDATE, DELETE og TRUNCATE
-- for disse rollene, og er ikke med her.
--
-- Kolonne-UPDATE på public.profiler røres ikke. REVOKE under tar
-- INSERT, DELETE og TRUNCATE, ikke UPDATE.
--
-- «Send horing» fjernes. Grantet for insert, update og delete går
-- uansett bort. Policyen var FOR INSERT TO public med
-- auth.uid() = bruker_id, og ville åpnet innloggede innsettinger
-- igjen ved et senere GRANT INSERT. «Les horing» blir stående.
--
-- kommune_innspill har ingen eierkolonne. Kolonnene er id, horing_id,
-- org, tekst, status, tags, svar_tekst, svar_dato og opprettet.
-- org er et tekstnavn, ikke en bruker. Derfor kan «Send innspill»
-- (WITH CHECK true, rolle public) ikke byttes ut med en sjekk mot
-- auth.uid(). INSERT trekkes for authenticated også, og policyen
-- fjernes så den ikke åpner skriving ved et senere GRANT INSERT.
-- «Les innspill» blir stående. Funksjonen åpnes igjen når den bygges.

revoke update, delete, truncate on table
  public.aktivitet,
  public.kampanje_signaturer,
  public.kampanjer,
  public.feedback
from anon, authenticated;

revoke insert on table public.kampanjer from anon;

revoke update, truncate on table public.fulgte_saker from anon, authenticated;

revoke insert, delete, truncate on table public.profiler from anon, authenticated;

revoke insert, update, delete, truncate on table public.horingssvar from anon, authenticated;

drop policy if exists "Send horing" on public.horingssvar;

revoke insert, update, delete, truncate on table
  public.kilder,
  public.kilde_kjoringer,
  public.epost_varsler,
  public.budsjett_cache,
  public.klartekst_cache,
  public.kommune_brukere,
  public.kommuner,
  public.kommune_horinger
from anon, authenticated;

revoke insert, update, delete, truncate on table
  public.kilde_alarmer,
  public.kilde_alarmer_frister
from anon, authenticated;

revoke insert, update, delete, truncate on table public.kommune_innspill from anon, authenticated;

drop policy if exists "Send innspill" on public.kommune_innspill;
