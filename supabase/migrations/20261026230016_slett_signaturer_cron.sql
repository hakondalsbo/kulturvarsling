-- Daglig telling av utløpte signaturer.
-- Kl. 03:00 UTC, etter eInnsyn-bolkene 01:00–02:10 UTC og backup rundt 02:30 UTC.
-- Cron kaller slett_utlopte_signaturer(now(), true), altså bare telling.
-- Standardverdien er også true, så et kall uten andre argument teller.
-- Ekte sletting (andre argument false) kommer i en egen migrasjon etter at tellingen er sjekket.
-- Erstatter slett_utlopte_signaturer med tellemodus. Den gamle migrasjonen er urørt.
-- kilde_kjoringer brukes ikke: den kan leses av alle, og den logger kildehenting.
-- Funksjonen skriver aldri til public.varsler.

create extension if not exists pg_cron;

create table if not exists public.slett_signatur_kjoringer (
  id bigint generated always as identity primary key,
  kjort timestamptz not null default now(),
  dry_run boolean not null,
  epost_slettet integer not null,
  navn_slettet integer not null,
  rader_slettet integer not null,
  constraint slett_signatur_kjoringer_antall_chk check (
    epost_slettet >= 0
    and navn_slettet >= 0
    and rader_slettet >= 0
  )
);

comment on table public.slett_signatur_kjoringer is
  'Én rad per kjøring av slett_utlopte_signaturer. Bare antall, ingen personopplysninger.';

alter table public.slett_signatur_kjoringer enable row level security;

revoke all on table public.slett_signatur_kjoringer from public, anon, authenticated, service_role;
grant select, insert on table public.slett_signatur_kjoringer to service_role;

revoke all on sequence public.slett_signatur_kjoringer_id_seq from public, anon, authenticated;
grant usage, select on sequence public.slett_signatur_kjoringer_id_seq to service_role;

-- Innspill som verken er sendt eller avsluttet, får frist ved opprettelse.
-- Triggeren ligger i privat, som ikke er med i Data-API-et.
create or replace function privat.sett_innspill_slettefrist()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_sendt timestamptz;
  v_avsluttet timestamptz;
  v_slag text;
  v_frist timestamptz;
begin
  if new.slettes_etter is not null and new.epost_slettes_etter is not null then
    return new;
  end if;

  select k.sendt_tid, k.avsluttet_tid, k.slag
    into v_sendt, v_avsluttet, v_slag
  from public.kampanjer k
  where k.id = new.kampanje_id;

  if v_slag is distinct from 'felles_innspill' then
    return new;
  end if;
  if v_sendt is not null or v_avsluttet is not null then
    return new;
  end if;

  v_frist := coalesce(new.opprettet, now()) + interval '12 months';
  if new.slettes_etter is null then
    new.slettes_etter := v_frist;
  end if;
  if new.epost_slettes_etter is null then
    new.epost_slettes_etter := v_frist;
  end if;
  return new;
end
$fn$;

alter function privat.sett_innspill_slettefrist() owner to postgres;

comment on function privat.sett_innspill_slettefrist() is
  'Før innsetting: uavsendt og uavsluttet felles innspill får slettes_etter og epost_slettes_etter tolv måneder etter opprettet. Overskriver ikke frister som alt er satt.';

revoke all on function privat.sett_innspill_slettefrist() from public;
grant execute on function privat.sett_innspill_slettefrist() to authenticated, service_role;

drop trigger if exists sett_innspill_slettefrist on public.kampanje_signaturer;
create trigger sett_innspill_slettefrist
  before insert on public.kampanje_signaturer
  for each row
  execute function privat.sett_innspill_slettefrist();

update public.kampanje_signaturer s
set
  slettes_etter = coalesce(s.slettes_etter, coalesce(s.opprettet, now()) + interval '12 months'),
  epost_slettes_etter = coalesce(s.epost_slettes_etter, coalesce(s.opprettet, now()) + interval '12 months')
from public.kampanjer k
where s.kampanje_id = k.id
  and k.slag = 'felles_innspill'
  and k.sendt_tid is null
  and k.avsluttet_tid is null
  and (s.slettes_etter is null or s.epost_slettes_etter is null);

drop function if exists public.slett_utlopte_signaturer(timestamptz);

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
  telle boolean := coalesce(p_dry_run, false);
begin
  if rolle not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'slett_utlopte_signaturer kan bare kalles av service_role eller postgres'
      using errcode = '42501';
  end if;

  -- Skriver aldri til public.varsler. Signaturrader telles og, når p_dry_run
  -- er false, oppdateres eller slettes uansett hvilken sak de peker på.

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
  'Teller e-post 30 dager etter innsending og navn etter 12 måneder. Uten innsending teller raden etter slettes_etter. Standard og cron er telling. false sletter, og tas i bruk i en senere migrasjon. Idempotent. Skriver aldri til public.varsler.';

revoke all on function public.slett_utlopte_signaturer(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.slett_utlopte_signaturer(timestamptz, boolean) to service_role;

do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'slett-utlopte-signaturer-daglig') then
    perform cron.unschedule('slett-utlopte-signaturer-daglig');
  end if;
  perform cron.schedule(
    'slett-utlopte-signaturer-daglig',
    '0 3 * * *',
    'select public.slett_utlopte_signaturer(now(), true)'
  );
end
$cron$;
