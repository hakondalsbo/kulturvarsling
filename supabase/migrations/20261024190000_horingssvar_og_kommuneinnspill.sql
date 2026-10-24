-- Åpner høringssvar og kommuneinnspill for innloggede brukere.
-- Skrivingen ble stengt i 20261024163600 fordi funksjonene ikke var ferdige.
--
-- Høringssvar skrives fra klienten, bare egne rader.
-- Edge-funksjonen horingshjelp skriver ikke i tabellen. Den bruker
-- service_role til døgnkvoten i ai_dognkvoter (reserver_ai_kvote).
-- «Les horing» og «Les innspill» (USING true, rolle public) fjernes.
-- Ingenting på disse tabellene er offentlig lesbart. Om kommuneinnspill
-- senere skal vises for kommunen, er det et eget produktvalg.
-- Anon får ingen rettigheter. authenticated får bare det klienten trenger.
-- sendt_til tømmes når en innlogget bruker skriver. Kulturvarsling
-- sender ikke inn svaret.
--
-- kommune_innspill.bruker_id er null på rader som fantes fra før.
-- De radene treffer ingen eier og er derfor ikke lesbare for klienter.
-- INSERT for authenticated med auth.uid() = bruker_id.
-- Ingen UPDATE eller DELETE fra klienten.

alter table public.horingssvar enable row level security;
alter table public.kommune_innspill enable row level security;

alter table public.horingssvar
  add column if not exists kilde_url text,
  add column if not exists kilde_hentet timestamptz,
  add column if not exists kilde_hash text,
  add column if not exists oppdatert timestamptz default now();

revoke all on table public.horingssvar from public, anon, authenticated;
grant select, insert, update on table public.horingssvar to authenticated;

drop policy if exists "Les horing" on public.horingssvar;
drop policy if exists "Les egne horingssvar" on public.horingssvar;
drop policy if exists "Skriv egne horingssvar" on public.horingssvar;
drop policy if exists "Endre egne horingssvar" on public.horingssvar;

create policy "Les egne horingssvar"
  on public.horingssvar
  for select
  to authenticated
  using ((select auth.uid()) = bruker_id);

create policy "Skriv egne horingssvar"
  on public.horingssvar
  for insert
  to authenticated
  with check ((select auth.uid()) = bruker_id);

create policy "Endre egne horingssvar"
  on public.horingssvar
  for update
  to authenticated
  using ((select auth.uid()) = bruker_id)
  with check ((select auth.uid()) = bruker_id);

create or replace function public.horingssvar_hold_utkast()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.bruker_id := old.bruker_id;
  end if;
  if auth.uid() is not null then
    new.sendt_til := null;
  end if;
  new.oppdatert := now();
  return new;
end;
$$;

drop trigger if exists horingssvar_hold_utkast on public.horingssvar;
create trigger horingssvar_hold_utkast
  before insert or update on public.horingssvar
  for each row execute function public.horingssvar_hold_utkast();

-- Ny funksjon får ikke standardrettigheten execute til public.
-- Triggeren kjører som den som skriver raden, og trenger execute.
revoke all on function public.horingssvar_hold_utkast() from public;
revoke all on function public.horingssvar_hold_utkast() from anon, authenticated;
grant execute on function public.horingssvar_hold_utkast() to authenticated;

alter table public.kommune_innspill
  add column if not exists bruker_id uuid references auth.users (id) on delete set null;

revoke all on table public.kommune_innspill from public, anon, authenticated;
grant select, insert on table public.kommune_innspill to authenticated;

drop policy if exists "Les innspill" on public.kommune_innspill;
drop policy if exists "Les egne innspill" on public.kommune_innspill;
drop policy if exists "Send egne innspill" on public.kommune_innspill;

create policy "Les egne innspill"
  on public.kommune_innspill
  for select
  to authenticated
  using ((select auth.uid()) = bruker_id);

create policy "Send egne innspill"
  on public.kommune_innspill
  for insert
  to authenticated
  with check (
    (select auth.uid()) = bruker_id
    and (status is null or status = 'ny')
    and svar_tekst is null
    and svar_dato is null
  );
