-- Stenger direkte innsetting av signaturer for authenticated.
-- Alle signaturrader får slettefrist, uten hull.
-- coalesce(p_dry_run, true) slik at et kall uten verdi teller.
-- Ny samtykketekst. Den gamle versjonen blir liggende.

drop policy if exists "Signer" on public.kampanje_signaturer;

revoke insert on table public.kampanje_signaturer from anon, authenticated, public;
revoke insert (kampanje_id, bruker_id, navn, epost)
  on table public.kampanje_signaturer from anon, authenticated, public;

create or replace function privat.sett_innspill_slettefrist()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_sendt timestamptz;
  v_avsluttet timestamptz;
  v_frist timestamptz;
begin
  if new.slettes_etter is not null and new.epost_slettes_etter is not null then
    return new;
  end if;

  select k.sendt_tid, k.avsluttet_tid
    into v_sendt, v_avsluttet
  from public.kampanjer k
  where k.id = new.kampanje_id;

  if v_sendt is not null then
    if new.epost_slettes_etter is null then
      new.epost_slettes_etter := v_sendt + interval '30 days';
    end if;
    if new.slettes_etter is null then
      new.slettes_etter := v_sendt + interval '12 months';
    end if;
  elsif v_avsluttet is not null then
    v_frist := v_avsluttet + interval '12 months';
    if new.slettes_etter is null then
      new.slettes_etter := v_frist;
    end if;
    if new.epost_slettes_etter is null then
      new.epost_slettes_etter := v_frist;
    end if;
  else
    v_frist := coalesce(new.opprettet, now()) + interval '12 months';
    if new.slettes_etter is null then
      new.slettes_etter := v_frist;
    end if;
    if new.epost_slettes_etter is null then
      new.epost_slettes_etter := v_frist;
    end if;
  end if;

  return new;
end
$fn$;

comment on function privat.sett_innspill_slettefrist() is
  'Før innsetting og oppdatering: alle signaturer får frist. Sendt kampanje: e-post 30 dager og navn 12 måneder etter sendt_tid. Avsluttet uten sending: begge 12 måneder etter avsluttet_tid. Ellers 12 måneder etter opprettet. Gjelder også signaturkampanje. Overskriver ikke frister som alt er satt.';

revoke all on function privat.sett_innspill_slettefrist() from public, anon, authenticated;
grant execute on function privat.sett_innspill_slettefrist() to service_role;

drop trigger if exists sett_innspill_slettefrist on public.kampanje_signaturer;
create trigger sett_innspill_slettefrist
  before insert or update on public.kampanje_signaturer
  for each row
  execute function privat.sett_innspill_slettefrist();

update public.kampanje_signaturer s
set
  epost_slettes_etter = coalesce(s.epost_slettes_etter, k.sendt_tid + interval '30 days'),
  slettes_etter = coalesce(s.slettes_etter, k.sendt_tid + interval '12 months')
from public.kampanjer k
where s.kampanje_id = k.id
  and k.sendt_tid is not null
  and (s.slettes_etter is null or s.epost_slettes_etter is null);

update public.kampanje_signaturer s
set
  epost_slettes_etter = coalesce(s.epost_slettes_etter, k.avsluttet_tid + interval '12 months'),
  slettes_etter = coalesce(s.slettes_etter, k.avsluttet_tid + interval '12 months')
from public.kampanjer k
where s.kampanje_id = k.id
  and k.sendt_tid is null
  and k.avsluttet_tid is not null
  and (s.slettes_etter is null or s.epost_slettes_etter is null);

update public.kampanje_signaturer s
set
  epost_slettes_etter = coalesce(s.epost_slettes_etter, coalesce(s.opprettet, now()) + interval '12 months'),
  slettes_etter = coalesce(s.slettes_etter, coalesce(s.opprettet, now()) + interval '12 months')
where s.slettes_etter is null
   or s.epost_slettes_etter is null;

do $sjekk$
begin
  if exists (
    select 1
    from public.kampanje_signaturer
    where slettes_etter is null
       or epost_slettes_etter is null
  ) then
    raise exception 'kampanje_signaturer har rad uten slettes_etter';
  end if;
end
$sjekk$;

alter table public.kampanje_signaturer
  alter column slettes_etter set not null,
  alter column epost_slettes_etter set not null;

create or replace function public.slett_utlopte_signaturer(
  p_naa timestamptz default now(),
  p_dry_run boolean default true
)
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
  telle boolean := coalesce(p_dry_run, true);
begin
  if rolle not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'slett_utlopte_signaturer kan bare kalles av service_role eller postgres'
      using errcode = '42501';
  end if;

  select count(*)::integer into n_epost
  from public.kampanje_signaturer s
  where s.epost is not null
    and s.epost_slettes_etter is not null
    and s.epost_slettes_etter <= p_naa;

  select count(*)::integer into n_navn
  from public.kampanje_signaturer s
  join public.kampanjer k on k.id = s.kampanje_id
  where k.sendt_tid is not null
    and s.slettes_etter is not null
    and s.slettes_etter <= p_naa
    and (
      s.navn is not null
      or s.token_hash is not null
      or (
        s.epost is not null
        and not (
          s.epost_slettes_etter is not null
          and s.epost_slettes_etter <= p_naa
        )
      )
    );

  select count(*)::integer into n_rader
  from public.kampanje_signaturer s
  join public.kampanjer k on k.id = s.kampanje_id
  where k.sendt_tid is null
    and s.slettes_etter is not null
    and s.slettes_etter <= p_naa;

  if not telle then
    update public.kampanje_signaturer s
    set epost = null
    where s.epost is not null
      and s.epost_slettes_etter is not null
      and s.epost_slettes_etter <= p_naa;

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

    delete from public.kampanje_signaturer s
    using public.kampanjer k
    where s.kampanje_id = k.id
      and k.sendt_tid is null
      and s.slettes_etter is not null
      and s.slettes_etter <= p_naa;
  end if;

  insert into public.slett_signatur_kjoringer (
    dry_run,
    epost_slettet,
    navn_slettet,
    rader_slettet
  ) values (
    telle,
    n_epost,
    n_navn,
    n_rader
  );

  return query select n_epost, n_navn, n_rader;
end
$fn$;

comment on function public.slett_utlopte_signaturer(timestamptz, boolean) is
  'Teller utløpte signaturer. coalesce av p_dry_run er true, så et kall uten verdi teller. false sletter, og tas i bruk i en senere migrasjon. Skriver aldri til public.varsler.';

revoke all on function public.slett_utlopte_signaturer(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.slett_utlopte_signaturer(timestamptz, boolean) to service_role;

insert into public.samtykke_tekster (versjon, tekst, gyldig_fra)
values (
  'felles-innspill-2026-10-27',
  $samtykke$Jeg vil signere dette innspillet til [mottaker]. Jeg samtykker til at Kulturvarsling AS lagrer navnet mitt, e-postadressen min og det jeg ellers fyller ut, og at navn, [rolle/organisasjon] og kommune sendes til [mottaker] sammen med innspillet rundt [dato].
Jeg forstår at innspill med navn ofte blir offentlige, for eksempel på regjeringen.no eller stortinget.no. E-postadressen min deles aldri. Den brukes bare til å bekrefte signaturen og si fra hvordan det gikk.
Jeg kan trekke signaturen når som helst via lenken i e-posten. Da sletter Kulturvarsling AS med en gang navnet mitt, e-postadressen min og det jeg har skrevet om meg selv. Er innspillet allerede sendt, kan det ikke hentes tilbake fra [mottaker]. E-postadressen min slettes 30 dager etter innsending, og navnet mitt 12 måneder etter innsending. Blir innspillet ikke sendt, slettes alt 12 måneder etter at det ble avsluttet, eller 12 måneder etter at jeg signerte hvis det aldri avsluttes. Jeg bekrefter at jeg er minst 16 år. [Les mer i personvernerklæringen]$samtykke$,
  '2026-10-27T00:00:00Z'
)
on conflict (versjon) do nothing;
