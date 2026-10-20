-- Lås plan og stripe_customer_id for innloggede brukere.
--
-- «Eget profil» er FOR ALL. Uten kolonnegrenser gir det authenticated UPDATE
-- på hele raden, inkludert betalingsfeltene. Triggeren fantes i databasen
-- uten migrasjon og avviser selve verdiendringen. Denne filen tar den inn i
-- versjonskontroll, setter eksplisitt WITH CHECK, og fjerner UPDATE-retten
-- på betalingskolonnene. service_role (stripe-webhook og stripe-checkout)
-- beholder tabell-UPDATE og bypasser RLS.
--
-- En senere migrasjon som legger til en kolonne brukeren skal kunne lagre,
-- må gi authenticated GRANT UPDATE på den kolonnen.

create or replace function public.beskytt_profil_betaling()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if TG_OP = 'INSERT' then
      if new.plan is distinct from 'gratis' or new.stripe_customer_id is not null then
        raise exception 'Betalingsstatus kan bare endres av serveren' using errcode = '42501';
      end if;
    elsif new.plan is distinct from old.plan
       or new.stripe_customer_id is distinct from old.stripe_customer_id then
      raise exception 'Betalingsstatus kan bare endres av serveren' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists beskytt_profil_betaling on public.profiler;
create trigger beskytt_profil_betaling
  before insert or update on public.profiler
  for each row
  execute function public.beskytt_profil_betaling();

comment on function public.beskytt_profil_betaling() is
  'Hindrer anon og authenticated i å sette plan eller stripe_customer_id. service_role slipper gjennom.';

drop policy if exists "Eget profil" on public.profiler;
create policy "Eget profil"
  on public.profiler
  for all
  to public
  using (auth.uid() = id)
  with check (auth.uid() = id);

revoke update on table public.profiler from anon, authenticated;

grant update (
  navn,
  epost,
  org,
  org_type,
  fagfelt,
  geografisk,
  varsel_frekvens,
  onboarding_done,
  opprettet,
  oppdatert,
  kommunenr,
  fylkesnr,
  personvern_akseptert_at,
  personvern_versjon
) on table public.profiler to authenticated;
