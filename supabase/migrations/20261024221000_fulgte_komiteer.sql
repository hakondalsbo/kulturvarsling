-- Følg komité. Flagget er av til personvernteksten er godkjent.
-- Ingen e-post. UTSENDING_AKTIV røres ikke.
-- Skriving krever authenticated og egen rad, og at flagget er på.
-- Nye objekter arver standardrettighetene fra 20261024203000.
-- Her gis bare de rettighetene funksjonen trenger.

create table public.funksjonsflagg (
  nokkel text primary key,
  aktiv boolean not null default false
);

comment on table public.funksjonsflagg is
  'Funksjoner som er av til de slås på. folg_komite er av til personvernteksten er godkjent.';

insert into public.funksjonsflagg (nokkel, aktiv)
values ('folg_komite', false);

alter table public.funksjonsflagg enable row level security;

revoke all on table public.funksjonsflagg from public, anon, authenticated;

grant select, update on table public.funksjonsflagg to service_role;

create or replace function public.folg_komite_aktiv()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select f.aktiv from public.funksjonsflagg f where f.nokkel = 'folg_komite'),
    false
  );
$$;

comment on function public.folg_komite_aktiv() is
  'Om følg-komité er slått på. Security invoker og tom search_path. Bare service_role får kjøre den.';

revoke all on function public.folg_komite_aktiv() from public, anon, authenticated;
grant execute on function public.folg_komite_aktiv() to service_role;

create or replace function privat.folg_komite_aktiv()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select f.aktiv from public.funksjonsflagg f where f.nokkel = 'folg_komite'),
    false
  );
$$;

alter function privat.folg_komite_aktiv() owner to postgres;

comment on function privat.folg_komite_aktiv() is
  'Samme flagg som public.folg_komite_aktiv, for RLS-policyen og mottakere_for_sak. Returnerer bare et boolsk svar, ingen brukerdata. Eieren er postgres.';

revoke all on function privat.folg_komite_aktiv() from public, anon;
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

revoke all on table public.fulgte_komiteer from public, anon, authenticated;

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

-- Samme funksjon som 20261024203000, med komité mellom sak og abonnement.
-- Grenen er tom når privat.folg_komite_aktiv() er false.
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
      'komite'::text,
      1
    from public.stortinget_horinger h
    join public.fulgte_komiteer fk on fk.komite_id = h.komite_id
    join public.profiler p on p.id = fk.bruker_id
    left join auth.users u on u.id = p.id
    where h.varsel_id = p_sak_id
      and privat.folg_komite_aktiv()

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
      2
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
      3
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
  'Mottakere for en sak. SECURITY DEFINER med tom search_path. Bekreftet auth.users.email. Komité når privat.folg_komite_aktiv() er sann, ellers samme grener som 20261024203000. EXECUTE bare for service_role. Sender ingen e-post.';

alter function public.mottakere_for_sak(uuid) owner to postgres;
revoke all on function public.mottakere_for_sak(uuid) from public, anon, authenticated;
grant execute on function public.mottakere_for_sak(uuid) to service_role;
