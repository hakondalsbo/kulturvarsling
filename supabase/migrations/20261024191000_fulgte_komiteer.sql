-- Følg komité. Flagget er av til personvernteksten er godkjent.
-- Ingen e-post. UTSENDING_AKTIV røres ikke.
-- Skriving krever authenticated og egen rad, og at flagget er på.

create table public.funksjonsflagg (
  nokkel text primary key,
  aktiv boolean not null default false
);

comment on table public.funksjonsflagg is
  'Funksjoner som er av til de slås på. folg_komite er av til personvernteksten er godkjent.';

insert into public.funksjonsflagg (nokkel, aktiv)
values ('folg_komite', false);

alter table public.funksjonsflagg enable row level security;

revoke all on table public.funksjonsflagg from public;
revoke all on table public.funksjonsflagg from anon;
revoke all on table public.funksjonsflagg from authenticated;

grant select, update on table public.funksjonsflagg to service_role;

create or replace function public.folg_komite_aktiv()
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select coalesce(
    (select f.aktiv from public.funksjonsflagg f where f.nokkel = 'folg_komite'),
    false
  );
$$;

comment on function public.folg_komite_aktiv() is
  'Om følg-komité er slått på. Security invoker. Bare service_role får kjøre den.';

revoke all on function public.folg_komite_aktiv() from public;
revoke all on function public.folg_komite_aktiv() from anon;
revoke all on function public.folg_komite_aktiv() from authenticated;
grant execute on function public.folg_komite_aktiv() to service_role;

create schema if not exists privat;

revoke all on schema privat from public;
grant usage on schema privat to anon, authenticated, service_role;

create or replace function privat.folg_komite_aktiv()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (select f.aktiv from public.funksjonsflagg f where f.nokkel = 'folg_komite'),
    false
  );
$$;

alter function privat.folg_komite_aktiv() owner to postgres;

comment on function privat.folg_komite_aktiv() is
  'Samme flagg som public.folg_komite_aktiv, for RLS-policyen. Returnerer bare et boolsk svar, ingen brukerdata. Eieren er postgres.';

revoke all on function privat.folg_komite_aktiv() from public;
revoke all on function privat.folg_komite_aktiv() from anon;
grant execute on function privat.folg_komite_aktiv() to authenticated, service_role;

create table public.fulgte_komiteer (
  bruker_id uuid not null references auth.users (id) on delete cascade,
  komite_id text not null,
  opprettet timestamptz not null default now(),
  primary key (bruker_id, komite_id),
  constraint fulgte_komiteer_komite_id_format
    check (komite_id ~ '^[A-ZÆØÅ0-9]{2,16}$')
);

comment on table public.fulgte_komiteer is
  'Komiteer en innlogget bruker følger. Ingen rader for anon. Innsetting krever at folg_komite er på.';

create index fulgte_komiteer_komite_idx
  on public.fulgte_komiteer (komite_id);

alter table public.fulgte_komiteer enable row level security;

revoke all on table public.fulgte_komiteer from public;
revoke all on table public.fulgte_komiteer from anon;
revoke all on table public.fulgte_komiteer from authenticated;

grant select, insert, delete on table public.fulgte_komiteer to authenticated;

create policy "Les egne komiteer"
  on public.fulgte_komiteer
  for select
  to authenticated
  using (auth.uid() = bruker_id);

create policy "Følg komité"
  on public.fulgte_komiteer
  for insert
  to authenticated
  with check (
    auth.uid() = bruker_id
    and privat.folg_komite_aktiv()
  );

create policy "Slutt å følge komité"
  on public.fulgte_komiteer
  for delete
  to authenticated
  using (auth.uid() = bruker_id);

-- Komité mellom fulgt sak (0) og abonnement (2). Grenen er tom når flagget er av.
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
      'komite'::text,
      1
    from public.stortinget_horinger h
    join public.fulgte_komiteer fk on fk.komite_id = h.komite_id
    join public.profiler p on p.id = fk.bruker_id
    left join auth.users u on u.id = p.id
    where h.varsel_id = p_sak_id
      and public.folg_komite_aktiv()

    union all

    select
      p.id,
      coalesce(nullif(btrim(p.epost), ''), u.email),
      p.varsel_frekvens,
      'abonnement'::text,
      2
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
  'Mottakere: fulgt sak, fulgt komité når folg_komite er på, og abonnement. Sender ingen e-post.';

revoke all on function public.mottakere_for_sak(uuid) from public;
revoke all on function public.mottakere_for_sak(uuid) from anon;
revoke all on function public.mottakere_for_sak(uuid) from authenticated;
grant execute on function public.mottakere_for_sak(uuid) to service_role;
