-- Additivt. Rydder dubletter på normalisert kilde-URL (beholder eldste rad
-- og flytter referanser), legger unik nøkkel, og gir Kildevakt en alarm
-- når en kilde som normalt har treff svarer 0 rå (feil_tomt_svar).
--
-- normaliser_kilde_url må holde seg lik normaliserKildeUrl i
-- supabase/functions/hent-saker/logikk.ts.

create or replace function public.normaliser_kilde_url(raw text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  s text := btrim(raw);
  fragment text := '';
  query text := '';
  hash_pos int;
  q_pos int;
  scheme text;
  rest text;
  slash_pos int;
  authority text;
  path text;
  userinfo text := '';
  hostport text;
  at_pos int;
  qnorm text := '';
begin
  if s is null or s = '' then
    return null;
  end if;

  hash_pos := position('#' in s);
  if hash_pos > 0 then
    fragment := substring(s from hash_pos);
    s := substring(s from 1 for hash_pos - 1);
  end if;

  q_pos := position('?' in s);
  if q_pos > 0 then
    query := substring(s from q_pos + 1);
    s := substring(s from 1 for q_pos - 1);
  end if;

  if query <> '' then
    select coalesce(string_agg(part, '&' order by part collate "C"), '')
      into qnorm
    from unnest(string_to_array(query, '&')) as u(part)
    where part <> '';
  end if;

  if s ~* '^https?://' then
    scheme := lower((regexp_match(s, '^(https?)://', 'i'))[1]);
    rest := substring(s from length(scheme) + 4);
    slash_pos := position('/' in rest);
    if slash_pos = 0 then
      authority := rest;
      path := '';
    else
      authority := substring(rest from 1 for slash_pos - 1);
      path := substring(rest from slash_pos);
    end if;

    if position('@' in authority) > 0 then
      at_pos := length(authority) - position('@' in reverse(authority)) + 1;
      userinfo := substring(authority from 1 for at_pos);
      hostport := substring(authority from at_pos + 1);
    else
      hostport := authority;
    end if;
    hostport := lower(hostport);
    if scheme = 'http' and hostport ~ ':80$' then
      hostport := left(hostport, length(hostport) - 3);
    elsif scheme = 'https' and hostport ~ ':443$' then
      hostport := left(hostport, length(hostport) - 4);
    end if;
    if length(path) > 1 then
      path := regexp_replace(path, '/+$', '');
    end if;

    return scheme || '://' || userinfo || hostport || path
      || case when qnorm <> '' then '?' || qnorm else '' end
      || fragment;
  end if;

  if length(s) > 1 then
    s := regexp_replace(s, '/+$', '');
  end if;
  return s
    || case when qnorm <> '' then '?' || qnorm else '' end
    || fragment;
end
$fn$;

comment on function public.normaliser_kilde_url(text) is
  'Dedup-nøkkel for varsler.kilde. Samme regler som normaliserKildeUrl i hent-saker/logikk.ts. Ikke security definer.';

-- Eldste rad (opprettet, deretter id) beholdes. Referanser flyttes før sletting.
-- Unike par (bruker, sak) som allerede peker på den beholdte raden, slettes
-- fra dublett-siden så oppdateringen ikke krasjer.
do $rydd$
begin
  create temporary table _kilde_duplikat on commit drop as
  with gruppert as (
    select
      id,
      public.normaliser_kilde_url(kilde) as nokkel,
      row_number() over (
        partition by public.normaliser_kilde_url(kilde)
        order by opprettet asc nulls last, id asc
      ) as rn
    from public.varsler
    where public.normaliser_kilde_url(kilde) is not null
  )
  select g.id as slett_id, b.id as behold_id
  from gruppert g
  join gruppert b on b.nokkel = g.nokkel and b.rn = 1
  where g.rn > 1;

  update public.aktivitet a
  set sak_id = d.behold_id
  from _kilde_duplikat d
  where a.sak_id = d.slett_id;

  delete from public.epost_varsler e
  using _kilde_duplikat d
  where e.sak_id = d.slett_id
    and exists (
      select 1 from public.epost_varsler e2
      where e2.bruker_id = e.bruker_id and e2.sak_id = d.behold_id
    );
  update public.epost_varsler e
  set sak_id = d.behold_id
  from _kilde_duplikat d
  where e.sak_id = d.slett_id;

  delete from public.fulgte_saker f
  using _kilde_duplikat d
  where f.sak_id = d.slett_id
    and exists (
      select 1 from public.fulgte_saker f2
      where f2.bruker_id = f.bruker_id and f2.sak_id = d.behold_id
    );
  update public.fulgte_saker f
  set sak_id = d.behold_id
  from _kilde_duplikat d
  where f.sak_id = d.slett_id;

  update public.horingssvar h
  set sak_id = d.behold_id
  from _kilde_duplikat d
  where h.sak_id = d.slett_id;

  update public.kampanjer k
  set sak_id = d.behold_id
  from _kilde_duplikat d
  where k.sak_id = d.slett_id;

  delete from public.klartekst_cache c
  using _kilde_duplikat d
  where c.varsel_id = d.slett_id
    and exists (
      select 1 from public.klartekst_cache c2
      where c2.varsel_id = d.behold_id
        and c2.profil_nokkel = c.profil_nokkel
    );
  update public.klartekst_cache c
  set varsel_id = d.behold_id
  from _kilde_duplikat d
  where c.varsel_id = d.slett_id;

  delete from public.varsler v
  using _kilde_duplikat d
  where v.id = d.slett_id;
end
$rydd$;

alter table public.varsler
  add column kilde_nokkel text
  generated always as (public.normaliser_kilde_url(kilde)) stored;

alter table public.varsler
  add constraint varsler_kilde_nokkel_unik unique (kilde_nokkel);

comment on column public.varsler.kilde_nokkel is
  'Generert dedup-nøkkel. Unik når den ikke er null. Fragment inngår, så tildelingsrunder med samme sti og ulikt # er ulike saker.';

alter table public.kilder
  add column if not exists forventer_treff boolean not null default false;

comment on column public.kilder.forventer_treff is
  'Når sant: 0 råtreff er feil_tomt_svar, ikke tom. Kilder som normalt har et korpus.';

update public.kilder
set forventer_treff = true
where adapter in (
  'stortinget-saker',
  'stortinget-ventede',
  'regjeringen-rss',
  'einnsyn',
  'bergen',
  'kulturdirektoratet',
  'sametinget'
);

alter table public.kilde_kjoringer
  add column alarm boolean
  generated always as (left(status, 5) = 'feil_' or status = 'delvis') stored;

comment on column public.kilde_kjoringer.alarm is
  'Sant for feil_* (inkl. feil_tomt_svar) og delvis. Kildevakt kan filtrere på denne.';

comment on column public.kilde_kjoringer.http_status is
  'HTTP-status for vellykket kall, for feil_http/feil_auth, eller første feilende kall ved delvis. Også satt ved feil_tomt_svar når kroppen var 200 med 0 treff.';

comment on column public.kilde_kjoringer.status is
  'ok_nye | ok_ingen_nye | tom | delvis | feil_http | feil_timeout | feil_parse | feil_auth | feil_nett | feil_tomt_svar';

create view public.kilde_alarmer
with (security_invoker = true) as
select
  k.id as kilde_id,
  k.navn,
  k.adapter,
  k.organ,
  k.forventer_treff,
  kk.id as kjoring_id,
  kk.kjort,
  kk.status,
  kk.antall_funnet,
  kk.antall_etter_filter,
  kk.antall_nye,
  kk.http_status,
  kk.feilmelding,
  kk.varighet_ms,
  kk.kjoert_av,
  kk.alarm
from public.kilder k
join lateral (
  select *
  from public.kilde_kjoringer
  where kilde_id = k.id
  order by kjort desc
  limit 1
) kk on true
where kk.alarm;

comment on view public.kilde_alarmer is
  'Siste kjøring per kilde, bare når den er en alarm (alarm = true). security_invoker: følger RLS på kilder og kilde_kjoringer.';

grant select on public.kilde_alarmer to anon, authenticated, service_role;
