-- Additivt. Setter varsler.kilde_id fra kilderegisteret ut fra kilde-URL.
-- Idempotent: rader som allerede peker på riktig kilde hoppes over.
--
-- adapter_fra_kilde må holde seg lik adapterFraKildeUrl i
-- supabase/functions/hent-saker/logikk.ts.
--
-- kilde_nokkel er generert fra kilde og røres ikke her.
-- NOT NULL settes ikke: dry-run 2026-10-20 mot prod (426 rader, unik
-- kilde_nokkel) mapper 425. Én rad kan ikke mappes fordi det ikke finnes
-- en kilde for vertsnavnet:
--   319eb402-bc77-424f-91b2-3db153bd4c38
--   https://www.stavanger.kommune.no/nytt-teater-og-museum/
--   «Ny reguleringsplan – Rogaland Teater og Stavanger museum»
-- Det er et eldre frø, ikke en adapter i kilder.

create or replace function public.adapter_fra_kilde(raw text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when raw is null or btrim(raw) = '' then null
    when lower(raw) like '%stortinget.no%'
      and (lower(raw) like '%ventede-saker%' or lower(raw) like '%#sak-%')
      then 'stortinget-ventede'
    when lower(raw) like '%stortinget.no%' then 'stortinget-saker'
    when lower(raw) like '%regjeringen.no%' then 'regjeringen-rss'
    when lower(raw) like '%einnsyn.no%' then 'einnsyn'
    when lower(raw) like '%bergen.kommune.no%' then 'bergen'
    when lower(raw) like '%kulturdirektoratet.no%' then 'kulturdirektoratet'
    when lower(raw) like '%sametinget.no%' then 'sametinget'
    else null
  end;
$$;

comment on function public.adapter_fra_kilde(text) is
  'Mapper varsler.kilde til kilder.adapter. Samme regler som adapterFraKildeUrl. Ikke security definer.';

update public.varsler v
set kilde_id = k.id
from public.kilder k
where k.adapter = public.adapter_fra_kilde(v.kilde)
  and v.kilde_id is distinct from k.id;

do $rapport$
declare
  n int;
  eksempler text;
begin
  select count(*),
         string_agg(
           format('%s | %s', id, left(coalesce(kilde, ''), 140)),
           E'\n'
           order by id
         )
    into n, eksempler
  from public.varsler
  where kilde_id is null;

  if n = 0 then
    raise notice 'kilde_id: alle varsler er mappet';
  else
    raise warning
      'kilde_id: % rader uten kjent kilde. NOT NULL settes ikke. %',
      n,
      coalesce(eksempler, '');
  end if;
end
$rapport$;

comment on column public.varsler.kilde_id is
  'UUID i kilder. Nullable fordi eldre rader uten kjent adapter (Stavanger-frøet) ikke kan mappes.';
