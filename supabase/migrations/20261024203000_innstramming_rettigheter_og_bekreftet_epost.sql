-- Innstramming som ikke krever nytt produktvalg.
--
-- M3/L3: nye objekter i public får ikke lenger alle rettigheter til
-- anon og authenticated. Eksisterende sekvenser mister rwU.
-- Overflødige REFERENCES, TRIGGER og MAINTAIN (PG17) tas bort.
-- SELECT, INSERT, UPDATE og DELETE som klienten bruker, blir stående:
--   fulgte_saker insert/delete, aktivitet insert,
--   kampanje_signaturer insert for authenticated (policy «Signer»),
--   kampanjer insert for authenticated, feedback insert,
--   profiler kolonne-update unntatt epost,
--   horingssvar select/insert/update og kommune_innspill select/insert
--   for authenticated eier (policyene fra 20261024190000 røres ikke).
--
-- L2: budsjett_cache, klartekst_cache, kommune_brukere og kommuner
-- brukes bare av service_role. SELECT tas bort der.
-- L1: EXECUTE i skjemaet net tas fra public/anon/authenticated og gis
-- til postgres, som kjører pg_cron. supabase_admin eier funksjonene.
-- Hvis migreringsrollen ikke får lov, logges en advarsel og resten
-- kjøres likevel.
-- L11: overstyr_varsel får search_path tomt og fullt kvalifiserte kall.
-- M4: mottakere_for_sak er SECURITY DEFINER, eid av postgres, med tom
-- search_path. service_role har ikke SELECT på auth.users (RLS og ACL
-- tilhører supabase_auth_admin; postgres har leserett og bypassrls).
-- Uten DEFINER feiler kallet med permission denied for table users.
-- E-post er bare auth.users.email når email_confirmed_at er satt.
-- EXECUTE er bare service_role. profiler.epost brukes ikke, og
-- innloggede kan ikke lenger oppdatere kolonnen.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    raise notice 'rollen supabase_admin finnes ikke, standardrettigheter hoppes over';
    return;
  end if;
  begin
    execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from anon, authenticated';
  exception
    when insufficient_privilege then
      raise warning 'Standardrettigheter for supabase_admin er uendret (postgres er ikke medlem): %', sqlerrm;
  end;
end $$;

revoke all on sequence
  public.kilde_kjoringer_id_seq,
  public.nyhetsbrev_utsendelser_id_seq,
  public.meld_pa_forsok_id_seq,
  public.bekreftelse_utsendelser_id_seq
from anon, authenticated;

do $$
declare
  rel record;
begin
  for rel in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
  loop
    execute format(
      'revoke references, trigger, maintain on table public.%I from anon, authenticated',
      rel.relname
    );
  end loop;
end $$;

revoke all on table
  public.budsjett_cache,
  public.klartekst_cache,
  public.kommune_brukere,
  public.kommuner
from anon, authenticated;

revoke all on function public.adapter_fra_kilde(text) from public, anon, authenticated;
revoke all on function public.innhold_dedup_nokkel(text, text, date, text) from public, anon, authenticated;
revoke all on function public.normaliser_innhold_tekst(text) from public, anon, authenticated;
revoke all on function public.normaliser_kilde_url(text) from public, anon, authenticated;

grant execute on function public.adapter_fra_kilde(text) to service_role;
grant execute on function public.innhold_dedup_nokkel(text, text, date, text) to service_role;
grant execute on function public.normaliser_innhold_tekst(text) to service_role;
grant execute on function public.normaliser_kilde_url(text) to service_role;

-- CHECK på profiler.geografisk kjører som den som oppdaterer raden.
-- authenticated må derfor beholde EXECUTE. anon trenger den ikke.
revoke all on function public.geografisk_tokens_gyldige(text[]) from public, anon, authenticated;
grant execute on function public.geografisk_tokens_gyldige(text[]) to authenticated, service_role;

do $$
begin
  if to_regnamespace('net') is null then
    raise notice 'skjemaet net finnes ikke';
    return;
  end if;
  begin
    execute 'revoke execute on all functions in schema net from public, anon, authenticated';
    execute 'grant execute on all functions in schema net to postgres';
  exception
    when insufficient_privilege then
      raise warning 'L1 er uendret: funksjonene i net eies av supabase_admin (%).', sqlerrm;
  end;
end $$;

create or replace function public.mottakere_for_sak(p_sak_id uuid)
returns table (
  bruker_id uuid,
  epost text,
  varsel_frekvens text,
  grunn text
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (q.bruker_id)
    q.bruker_id,
    q.epost,
    q.varsel_frekvens,
    q.grunn
  from (
    select
      p.id as bruker_id,
      case
        when u.email_confirmed_at is not null
          and nullif(pg_catalog.btrim(u.email), '') is not null
          then u.email
        else null
      end as epost,
      p.varsel_frekvens,
      'sak'::text as grunn,
      0 as prioritet
    from public.fulgte_saker f
    join public.profiler p on p.id = f.bruker_id
    left join auth.users u on u.id = p.id
    where f.sak_id = p_sak_id

    union all

    select
      p.id,
      case
        when u.email_confirmed_at is not null
          and nullif(pg_catalog.btrim(u.email), '') is not null
          then u.email
        else null
      end,
      p.varsel_frekvens,
      'abonnement'::text,
      1
    from public.varsler v
    join public.profiler p on p.varsler_aktive
    left join auth.users u on u.id = p.id
    where v.id = p_sak_id
      and public.sak_treffer_abonnement(
        v.kategori, v.niva, v.fylkesnr, v.kommunenr, v.sted, p.fagfelt, p.geografisk,
        v.instans, v.kilde, p.organ, p.komiteer
      )

    union all

    select
      p.id,
      case
        when u.email_confirmed_at is not null
          and nullif(pg_catalog.btrim(u.email), '') is not null
          then u.email
        else null
      end,
      p.varsel_frekvens,
      'sok'::text,
      2
    from public.lagrede_sok s
    join public.profiler p on p.id = s.bruker_id
    join public.varsler v on v.id = p_sak_id
    left join auth.users u on u.id = p.id
    where public.tekst_inneholder(v.tittel, s.sporretekst)
      or public.tekst_inneholder(v.sammendrag, s.sporretekst)
      or public.tekst_inneholder(v.instans, s.sporretekst)
  ) q
  order by q.bruker_id, q.prioritet;
$$;

comment on function public.mottakere_for_sak(uuid) is
  'Mottakere for en sak. SECURITY DEFINER med tom search_path, så service_role kan lese bekreftet auth.users.email uten egen tabellrett. profiler.epost brukes ikke. Ubekreftet adresse blir null. Frekvens filtreres ikke. EXECUTE bare for service_role. Sender ingen e-post.';

alter function public.mottakere_for_sak(uuid) owner to postgres;
revoke all on function public.mottakere_for_sak(uuid) from public, anon, authenticated;
grant execute on function public.mottakere_for_sak(uuid) to service_role;

revoke update (epost) on table public.profiler from public, anon, authenticated;

create or replace function public.overstyr_varsel(
  p_id uuid,
  p_tittel text,
  p_sammendrag text,
  p_kategori text,
  p_hvem text,
  p_frist date default null,
  p_motedato date default null,
  p_status text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  -- coalesce og nullif er SQL-konstruksjoner, ikke funksjoner i pg_catalog.
  rolle text := coalesce(
    pg_catalog.json_extract_path_text(
      nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::pg_catalog.json,
      'role'
    ),
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    session_user::pg_catalog.text
  );
begin
  if rolle not in ('service_role', 'postgres') then
    raise exception 'overstyr_varsel kan bare kalles av service_role eller postgres'
      using errcode = '42501';
  end if;
  if p_hvem is null or pg_catalog.length(pg_catalog.btrim(p_hvem)) = 0 then
    raise exception 'overstyr_varsel krever hvem som gjør endringen'
      using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('kritisk', 'viktig', 'normal', 'passert') then
    raise exception 'overstyr_varsel godtar bare status kritisk, viktig, normal eller passert'
      using errcode = '23514';
  end if;

  perform pg_catalog.set_config('app.varsel_overstyr', '1', true);
  perform pg_catalog.set_config('app.varsel_hvem', pg_catalog.left(pg_catalog.btrim(p_hvem), 200), true);

  update public.varsler
  set
    tittel = coalesce(p_tittel, tittel),
    sammendrag = coalesce(p_sammendrag, sammendrag),
    kategori = coalesce(p_kategori, kategori),
    frist = coalesce(p_frist, frist),
    motedato = coalesce(p_motedato, motedato),
    status = coalesce(p_status, status)
  where id = p_id;

  if not found then
    raise exception 'Fant ikke saken som skulle overstyres'
      using errcode = 'P0002';
  end if;
end
$fn$;

comment on function public.overstyr_varsel(uuid, text, text, text, text, date, date, text) is
  'Eneste vei til å endre låst tittel, sammendrag, kategori, frist, møtedato eller status. SECURITY DEFINER med tom search_path. Bare service_role og postgres.';

revoke all on function public.overstyr_varsel(uuid, text, text, text, text, date, date, text) from public, anon, authenticated;
grant execute on function public.overstyr_varsel(uuid, text, text, text, text, date, date, text) to service_role;
