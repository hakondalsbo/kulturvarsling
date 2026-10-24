-- Stenger lesing av public.kampanje_signaturer for anon og authenticated.
-- Bare service_role (og tabellens eier) skal kunne lese radene.
-- Anonym innsetting stenges til signering bygges med samtykke.
-- Innloggede kan fortsatt signere egen rad.
--
-- Etter 20261024163600 har anon og authenticated INSERT, og
-- kolonne-SELECT på id og kampanje_id. «Les signaturer» er
-- USING (true). «Signer» er
-- WITH CHECK ((auth.uid() = bruker_id) OR (bruker_id IS NULL)),
-- som slipper inn anonyme rader.
--
-- Klienten setter inn med return=minimal og trenger ikke SELECT.
-- Kolonne-SELECT trekkes derfor tilbake. Uten SELECT-policy ville
-- RETURNING uansett feile, og raden ville ikke blitt lagret.
--
-- kampanje_med_signaturer er security_invoker og tellet med en
-- join mot tabellen. Uten SELECT på tabellen feiler viewet for
-- anon og authenticated, og antallet blir borte. Viewet beholdes
-- som security_invoker, så RLS på kampanjer fortsatt gjelder
-- (inaktive kampanjer vises ikke). Antallet hentes fra
-- privat.antall_signaturer, som bare returnerer kampanje_id og
-- antall for aktive kampanjer. Navn og e-post er ikke med.
-- Skjemaet privat er ikke en del av Data-API-et.

drop policy if exists "Les signaturer" on public.kampanje_signaturer;

revoke select (id, kampanje_id) on table public.kampanje_signaturer from anon, authenticated;

revoke select on table public.kampanje_signaturer from anon, authenticated;

revoke insert on table public.kampanje_signaturer from anon;

drop policy if exists "Signer" on public.kampanje_signaturer;

create policy "Signer"
  on public.kampanje_signaturer
  for insert
  to authenticated
  with check (auth.uid() = bruker_id);

create schema if not exists privat;

revoke all on schema privat from public;

grant usage on schema privat to anon, authenticated, service_role;

create or replace function privat.antall_signaturer()
returns table (kampanje_id uuid, antall integer)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
    select s.kampanje_id, count(s.id)::integer
    from public.kampanje_signaturer as s
    join public.kampanjer as k on k.id = s.kampanje_id
    where k.aktiv is true
    group by s.kampanje_id;
end;
$$;

alter function privat.antall_signaturer() owner to postgres;

comment on function privat.antall_signaturer() is
  'Antall signaturer per aktiv kampanje. SECURITY DEFINER fordi kampanje_med_signaturer er security_invoker og kalleren ikke har SELECT på kampanje_signaturer. Returnerer ikke navn eller e-post. Eieren er postgres, som eier tabellen, og omgår RLS fordi FORCE ROW LEVEL SECURITY ikke er satt.';

revoke all on function privat.antall_signaturer() from public;

grant execute on function privat.antall_signaturer() to anon, authenticated, service_role;

create or replace view public.kampanje_med_signaturer
with (security_invoker = true) as
select
  k.id,
  k.tittel,
  k.beskrivelse,
  k.mal,
  k.kategori,
  k.sak_id,
  k.tags,
  k.dager,
  k.aktiv,
  k.opprettet,
  coalesce(a.antall, 0)::integer as signaturer
from public.kampanjer as k
left join privat.antall_signaturer() as a on a.kampanje_id = k.id;

alter view public.kampanje_med_signaturer set (security_invoker = true);

comment on view public.kampanje_med_signaturer is
  'Kampanjer med antall signaturer. security_invoker, så RLS på kampanjer gjelder. Antallet kommer fra privat.antall_signaturer og inneholder ikke navn eller e-post.';
