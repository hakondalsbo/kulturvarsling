-- Additivt. Lagrer varselpreferanser per bruker. Ingen utsending.
--
-- Enkeltsaker ligger allerede i fulgte_saker.
-- Fagområde ligger i profiler.fagfelt (tom liste = alle fag).
-- Geografi ligger i profiler.geografisk som tokens:
--   land                         hele landet
--   niva:nasjonalt|fylke|kommune alle saker på det nivået
--   fylke:<to siffer>            fylket, inkludert kommuner med samme fylkesnr
--   kommune:<fire siffer>        kommunenr
--   sted:<navn i små bokstaver>  eksakt sted når saken ikke har kommunenr
-- profiler.varsler_aktive er av/på for abonnementet. Fulgte saker gjelder
-- uavhengig av bryteren, så en senere motor kan lese begge.

alter table public.profiler
  add column if not exists varsler_aktive boolean not null default false;

comment on column public.profiler.varsler_aktive is
  'Om brukeren vil ha varsler for fagfelt og geografisk. Fulgte saker er uavhengig av denne.';

comment on column public.profiler.fagfelt is
  'Fagområder brukeren følger. Tom liste betyr alle fag når varsler_aktive er sann.';

comment on column public.profiler.geografisk is
  'Geografi-tokens: land, niva:nasjonalt|fylke|kommune, fylke:NN, kommune:NNNN, sted:<små bokstaver>. Tom liste betyr hele landet når varsler_aktive er sann.';

-- CHECK kan ikke inneholde underspørring. Funksjonen er immutable og uten sideeffekter.
create or replace function public.geografisk_tokens_gyldige(tokens text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select tokens is null or not exists (
    select 1
    from unnest(tokens) as tok
    where tok !~ '^(land|niva:(nasjonalt|fylke|kommune)|fylke:[0-9]{2}|kommune:[0-9]{4}|sted:[^[:cntrl:]]{1,120})$'
  );
$$;

comment on function public.geografisk_tokens_gyldige(text[]) is
  'Sant når hvert geografisk-token er land, niva, fylke, kommune eller sted.';

alter table public.profiler
  drop constraint if exists profiler_geografisk_token;

alter table public.profiler
  add constraint profiler_geografisk_token
  check (public.geografisk_tokens_gyldige(geografisk));

create index if not exists fulgte_saker_sak_idx
  on public.fulgte_saker (sak_id);

create index if not exists profiler_varsler_aktive_idx
  on public.profiler (id)
  where varsler_aktive;

-- Ren treff-test, uten brukerdata. Samme regler som src/preferanser.ts.
create or replace function public.sak_treffer_abonnement(
  sak_kategori text,
  sak_niva text,
  sak_fylkesnr text,
  sak_kommunenr text,
  sak_sted text,
  fagfelt text[],
  geografisk text[]
) returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    (
      fagfelt is null
      or cardinality(fagfelt) = 0
      or sak_kategori = any (fagfelt)
    )
    and (
      geografisk is null
      or cardinality(geografisk) = 0
      or 'land' = any (geografisk)
      or (sak_niva is not null and ('niva:' || sak_niva) = any (geografisk))
      or (
        nullif(btrim(sak_fylkesnr), '') is not null
        and ('fylke:' || btrim(sak_fylkesnr)) = any (geografisk)
      )
      or (
        nullif(btrim(sak_kommunenr), '') is not null
        and ('kommune:' || btrim(sak_kommunenr)) = any (geografisk)
      )
      or (
        nullif(btrim(sak_sted), '') is not null
        and ('sted:' || lower(btrim(sak_sted))) = any (geografisk)
      )
    ),
    false
  );
$$;

comment on function public.sak_treffer_abonnement(text, text, text, text, text, text[], text[]) is
  'Om en sak treffer fag- og geografifilter. Tomme lister betyr alle fag og hele landet.';

-- Mottakere for én sak. security invoker: service_role (som omgår RLS) ser alle,
-- andre roller ser bare egne rader hvis de i det hele tatt får kjøre funksjonen.
-- Ingen e-post sendes her.
create or replace function public.mottakere_for_sak(p_sak_id uuid)
returns table (
  bruker_id uuid,
  epost text,
  varsel_frekvens text,
  grunn text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select distinct on (q.bruker_id)
    q.bruker_id,
    q.epost,
    q.varsel_frekvens,
    q.grunn
  from (
    select
      p.id as bruker_id,
      coalesce(nullif(btrim(p.epost), ''), u.email) as epost,
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
      coalesce(nullif(btrim(p.epost), ''), u.email),
      p.varsel_frekvens,
      'abonnement'::text,
      1
    from public.varsler v
    join public.profiler p on p.varsler_aktive
    left join auth.users u on u.id = p.id
    where v.id = p_sak_id
      and public.sak_treffer_abonnement(
        v.kategori, v.niva, v.fylkesnr, v.kommunenr, v.sted, p.fagfelt, p.geografisk
      )
  ) q
  order by q.bruker_id, q.prioritet;
$$;

comment on function public.mottakere_for_sak(uuid) is
  'Mottakere for en sak: fulgte saker (grunn sak) og aktive abonnement som treffer fag og geografi (grunn abonnement). Frekvens returneres, filtreres ikke. Sender ingen e-post.';

revoke all on function public.sak_treffer_abonnement(text, text, text, text, text, text[], text[]) from public;
revoke all on function public.sak_treffer_abonnement(text, text, text, text, text, text[], text[]) from anon;
revoke all on function public.sak_treffer_abonnement(text, text, text, text, text, text[], text[]) from authenticated;
grant execute on function public.sak_treffer_abonnement(text, text, text, text, text, text[], text[]) to service_role;

revoke all on function public.mottakere_for_sak(uuid) from public;
revoke all on function public.mottakere_for_sak(uuid) from anon;
revoke all on function public.mottakere_for_sak(uuid) from authenticated;
grant execute on function public.mottakere_for_sak(uuid) to service_role;
