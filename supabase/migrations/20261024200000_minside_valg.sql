-- Min side. Forslag, ikke kjørt mot prod i denne PR-en.
--
-- Sted og fag ligger som før i profiler.geografisk og profiler.fagfelt.
-- Enkeltsaker ligger i fulgte_saker. Samme rader styrer en senere
-- e-postmotor via mottakere_for_sak. Denne filen sender ingen e-post
-- og rører ikke utsending, betalingsplan eller betalingskunde.
--
-- Nytt, fordi det ikke fantes et sted å lagre det:
--   profiler.organ       stortinget, regjeringen
--   profiler.komiteer    blant annet famkult (Familie- og kulturkomiteen)
--   profiler.minside_klar om førstegangsoppsettet er fullført eller hoppet over
--   public.lagrede_sok   lagrede søk, slått sammen med følg-sak i treffet
--
-- Nytt geografisk token: fylkeskommune:NN. Det matcher bare niva = fylke.
-- Det eldre tokenet fylke:NN tar fortsatt med kommunesaker i fylket.
--
-- PR #29 trakk tabell-UPDATE på profiler. Nye kolonner får derfor eget
-- kolonne-GRANT til authenticated, og ikke til anon.
--
-- Kulturpolitikk: public.kulturpolitikk_valgbart() er false til Håkon
-- bekrefter. Se kommentaren på funksjonen. Samme konstant ligger i
-- src/minside/kulturpolitikk.ts.

create or replace function public.kulturpolitikk_valgbart()
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select false
$$;

comment on function public.kulturpolitikk_valgbart() is
  'Lett flagg, samme verdi som KULTURPOLITIKK_VALGBART. false til Håkon bekrefter kulturpolitikk som fagområde. Når false ignoreres verdien i fagfelt: ligger den alene igjen, blir filteret tomt og betyr alle fag. Når true er den et vanlig fag. Saker merket kulturpolitikk, blant annet eInnsyn-tilskudd og budsjett uten navngitt kunstform, treffer da bare tomt fagfelt eller et fagfelt som inneholder kulturpolitikk.';

revoke all on function public.kulturpolitikk_valgbart() from public;
revoke all on function public.kulturpolitikk_valgbart() from anon, authenticated;
grant execute on function public.kulturpolitikk_valgbart() to service_role;

create or replace function public.geografisk_tokens_gyldige(tokens text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select tokens is null or not exists (
    select 1
    from unnest(tokens) as tok
    where tok !~ '^(land|niva:(nasjonalt|fylke|kommune)|fylke:[0-9]{2}|fylkeskommune:[0-9]{2}|kommune:[0-9]{4}|sted:[^[:cntrl:]]{1,120})$'
  );
$$;

comment on function public.geografisk_tokens_gyldige(text[]) is
  'Sant når hvert geografisk-token er land, niva, fylke, fylkeskommune, kommune eller sted.';

alter table public.profiler
  drop constraint if exists profiler_geografisk_token;

alter table public.profiler
  add constraint profiler_geografisk_token
  check (public.geografisk_tokens_gyldige(geografisk));

alter table public.profiler
  add column if not exists organ text[] not null default '{}',
  add column if not exists komiteer text[] not null default '{}',
  add column if not exists minside_klar boolean not null default false;

comment on column public.profiler.organ is
  'Organ brukeren følger: stortinget og regjeringen. Tom liste avgrenser ikke. Samme valg leses av mottakere_for_sak. Sender ingen e-post.';

comment on column public.profiler.komiteer is
  'Stortingskomiteer brukeren følger, inkludert komiteens høringer. famkult er Familie- og kulturkomiteen. Tom liste avgrenser ikke.';

comment on column public.profiler.minside_klar is
  'Om brukeren har fullført eller hoppet over førstegangsoppsettet på Min side.';

alter table public.profiler
  drop constraint if exists profiler_organ_kjent;

alter table public.profiler
  add constraint profiler_organ_kjent
  check (organ <@ array['stortinget', 'regjeringen']::text[]);

alter table public.profiler
  drop constraint if exists profiler_komiteer_kjent;

alter table public.profiler
  add constraint profiler_komiteer_kjent
  check (komiteer <@ array['famkult', 'finans', 'naering', 'utdanning']::text[]);

-- Tabell-UPDATE er trukket. Uten kolonne-grant kan ikke innloggede lagre de nye feltene.
revoke update (organ, komiteer, minside_klar) on table public.profiler from anon;
grant update (organ, komiteer, minside_klar) on table public.profiler to authenticated;

create table if not exists public.lagrede_sok (
  id uuid primary key default gen_random_uuid(),
  bruker_id uuid not null references public.profiler (id) on delete cascade,
  navn text not null,
  sporretekst text not null default '',
  opprettet timestamptz not null default now(),
  constraint lagrede_sok_navn_lengde check (char_length(btrim(navn)) between 1 and 80),
  constraint lagrede_sok_sporring_lengde check (char_length(sporretekst) <= 200)
);

comment on table public.lagrede_sok is
  'Lagrede søk på Min side. Treffet slås sammen med fulgte saker. Ingen e-post sendes her.';

create index if not exists lagrede_sok_bruker_idx
  on public.lagrede_sok (bruker_id);

alter table public.lagrede_sok enable row level security;
alter table public.lagrede_sok force row level security;

revoke all on table public.lagrede_sok from public;
revoke all on table public.lagrede_sok from anon;
revoke all on table public.lagrede_sok from authenticated;

grant select, insert, update, delete on table public.lagrede_sok to authenticated;
grant select, insert, update, delete on table public.lagrede_sok to service_role;

drop policy if exists "Egne lagrede sok" on public.lagrede_sok;

create policy "Egne lagrede sok"
  on public.lagrede_sok
  for all
  to authenticated
  using ((select auth.uid()) = bruker_id)
  with check ((select auth.uid()) = bruker_id);

create or replace function public.tekst_inneholder(haystack text, ord text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select char_length(btrim(coalesce(ord, ''))) > 0
    and position(
      lower(btrim(ord)) in lower(coalesce(haystack, ''))
    ) > 0;
$$;

comment on function public.tekst_inneholder(text, text) is
  'Om søkeordet finnes i teksten. Tomt søkeord treffer ingenting. Prosent og understrek er vanlige tegn, ikke jokertegn.';

revoke all on function public.tekst_inneholder(text, text) from public;
revoke all on function public.tekst_inneholder(text, text) from anon, authenticated;
grant execute on function public.tekst_inneholder(text, text) to service_role;

drop function if exists public.mottakere_for_sak(uuid);
drop function if exists public.sak_treffer_abonnement(text, text, text, text, text, text[], text[]);

create function public.sak_treffer_abonnement(
  sak_kategori text,
  sak_niva text,
  sak_fylkesnr text,
  sak_kommunenr text,
  sak_sted text,
  fagfelt text[],
  geografisk text[],
  sak_instans text default null,
  sak_kilde text default null,
  organ text[] default null,
  komiteer text[] default null
) returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  with renset as (
    select case
      when public.kulturpolitikk_valgbart() then coalesce(fagfelt, '{}'::text[])
      else coalesce(array_remove(coalesce(fagfelt, '{}'::text[]), 'kulturpolitikk'), '{}'::text[])
    end as fag
  )
  select coalesce((
    (select cardinality(fag) = 0 or sak_kategori = any (fag) from renset)
    and (
      (
        not (
          geografisk is not null
          and cardinality(geografisk) > 0
          and not ('land' = any (geografisk))
        )
        and (organ is null or cardinality(organ) = 0)
        and (komiteer is null or cardinality(komiteer) = 0)
      )
      or (
        geografisk is not null
        and cardinality(geografisk) > 0
        and not ('land' = any (geografisk))
        and (
          (sak_niva is not null and ('niva:' || sak_niva) = any (geografisk))
          or (
            nullif(btrim(sak_fylkesnr), '') is not null
            and ('fylke:' || btrim(sak_fylkesnr)) = any (geografisk)
          )
          or (
            sak_niva = 'fylke'
            and nullif(btrim(sak_fylkesnr), '') is not null
            and ('fylkeskommune:' || btrim(sak_fylkesnr)) = any (geografisk)
          )
          or (
            nullif(btrim(sak_kommunenr), '') is not null
            and ('kommune:' || btrim(sak_kommunenr)) = any (geografisk)
          )
          or (
            nullif(btrim(sak_sted), '') is not null
            and ('sted:' || lower(btrim(sak_sted))) = any (geografisk)
          )
        )
      )
      or (
        organ is not null
        and cardinality(organ) > 0
        and (
          (
            'stortinget' = any (organ)
            and (
              coalesce(sak_kilde, '') ilike '%stortinget.no%'
              or coalesce(sak_instans, '') ilike '%stortinget%'
            )
          )
          or (
            'regjeringen' = any (organ)
            and (
              coalesce(sak_kilde, '') ilike '%regjeringen.no%'
              or coalesce(sak_instans, '') ilike '%regjeringen%'
              or coalesce(sak_instans, '') ~* '(^|[^[:alnum:]])KUD([^[:alnum:]]|$)'
              or coalesce(sak_instans, '') ilike '%departementet%'
            )
          )
        )
      )
      or (
        komiteer is not null
        and cardinality(komiteer) > 0
        and (
          ('famkult' = any (komiteer) and coalesce(sak_instans, '') ilike '%Familie- og kulturkomiteen%')
          or ('finans' = any (komiteer) and coalesce(sak_instans, '') ilike '%Finanskomiteen%')
          or ('naering' = any (komiteer) and coalesce(sak_instans, '') ilike '%Næringskomiteen%')
          or ('utdanning' = any (komiteer) and coalesce(sak_instans, '') ilike '%Utdannings- og forskningskomiteen%')
        )
      )
    )
  ), false);
$$;

comment on function public.sak_treffer_abonnement(text, text, text, text, text, text[], text[], text, text, text[], text[]) is
  'Om en sak treffer fag og kilder. Tomt fag er alle fag. Sted, organ og komité er eller-valg. Tom liste på en kilde avgrenser ikke. fylkeskommune matcher bare fylkesnivå. Kulturpolitikk følger kulturpolitikk_valgbart(). Sender ingen e-post.';

revoke all on function public.sak_treffer_abonnement(text, text, text, text, text, text[], text[], text, text, text[], text[]) from public;
revoke all on function public.sak_treffer_abonnement(text, text, text, text, text, text[], text[], text, text, text[], text[]) from anon, authenticated;
grant execute on function public.sak_treffer_abonnement(text, text, text, text, text, text[], text[], text, text, text[], text[]) to service_role;

create function public.mottakere_for_sak(p_sak_id uuid)
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
        v.kategori, v.niva, v.fylkesnr, v.kommunenr, v.sted, p.fagfelt, p.geografisk,
        v.instans, v.kilde, p.organ, p.komiteer
      )

    union all

    select
      p.id,
      coalesce(nullif(btrim(p.epost), ''), u.email),
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
  'Mottakere for en sak: fulgte saker, aktive abonnement og lagrede søk. Frekvens returneres, filtreres ikke. Sender ingen e-post.';

revoke all on function public.mottakere_for_sak(uuid) from public;
revoke all on function public.mottakere_for_sak(uuid) from anon, authenticated;
grant execute on function public.mottakere_for_sak(uuid) to service_role;
