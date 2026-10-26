-- Daglig sletting av utløpte signaturer.
-- Kl. 03:00 UTC, etter eInnsyn-bolkene 01:00–01:30 UTC og backup rundt 02:30 UTC.
-- Erstatter slett_utlopte_signaturer med tellemodus. Den gamle migrasjonen er urørt.
-- kilde_kjoringer brukes ikke: den kan leses av alle, og den logger kildehenting.

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

revoke all on table public.slett_signatur_kjoringer from public, anon, authenticated;
grant select, insert on table public.slett_signatur_kjoringer to service_role;

revoke all on sequence public.slett_signatur_kjoringer_id_seq from public, anon, authenticated;
grant usage, select on sequence public.slett_signatur_kjoringer_id_seq to service_role;

drop function if exists public.slett_utlopte_signaturer(timestamptz);

create or replace function public.slett_utlopte_signaturer(
  p_naa timestamptz default now(),
  p_dry_run boolean default false
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

  -- Rører aldri public.varsler. Signaturer som peker på en sak med
  -- manuelt_redigert = true, hoppes over. Kampanje_signaturer har ikke feltet.

  select count(*)::integer into n_epost
  from public.kampanje_signaturer s
  where s.epost is not null
    and s.epost_slettes_etter is not null
    and s.epost_slettes_etter <= p_naa
    and not exists (
      select 1 from public.varsler v
      where v.id = s.varsel_id
        and v.manuelt_redigert is true
    );

  select count(*)::integer into n_navn
  from public.kampanje_signaturer s
  join public.kampanjer k on k.id = s.kampanje_id
  where k.sendt_tid is not null
    and s.slettes_etter is not null
    and s.slettes_etter <= p_naa
    and not exists (
      select 1 from public.varsler v
      where v.id = s.varsel_id
        and v.manuelt_redigert is true
    )
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
    and s.slettes_etter <= p_naa
    and not exists (
      select 1 from public.varsler v
      where v.id = s.varsel_id
        and v.manuelt_redigert is true
    );

  if not telle then
    update public.kampanje_signaturer s
    set epost = null
    where s.epost is not null
      and s.epost_slettes_etter is not null
      and s.epost_slettes_etter <= p_naa
      and not exists (
        select 1 from public.varsler v
        where v.id = s.varsel_id
          and v.manuelt_redigert is true
      );

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
      and (s.navn is not null or s.token_hash is not null or s.epost is not null)
      and not exists (
        select 1 from public.varsler v
        where v.id = s.varsel_id
          and v.manuelt_redigert is true
      );

    delete from public.kampanje_signaturer s
    using public.kampanjer k
    where s.kampanje_id = k.id
      and k.sendt_tid is null
      and s.slettes_etter is not null
      and s.slettes_etter <= p_naa
      and not exists (
        select 1 from public.varsler v
        where v.id = s.varsel_id
          and v.manuelt_redigert is true
      );
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
  'Sletter e-post 30 dager etter innsending og navn etter 12 måneder. Uten innsending slettes raden etter 12 måneder. p_dry_run teller uten å skrive. Idempotent. Rører ikke rader med manuelt_redigert.';

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
    'select public.slett_utlopte_signaturer(now(), false)'
  );
end
$cron$;
