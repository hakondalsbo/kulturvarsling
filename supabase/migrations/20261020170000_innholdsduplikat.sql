-- Additivt. Rydder innholdsdubletter: samme instans, normalisert tittel og
-- frist, men ulik kilde-URL. Eldste rad beholdes. Referanser flyttes.
--
-- Møte-URL (eInnsyn, Bergen) er ikke en sak-id. Stortinget p=, regjeringsdokument
-- /idN og fragment på Kulturdirektoratet eller ventede saker er det, så like
-- titler der blir stående.
--
-- normaliser_innhold_tekst og innhold_dedup_nokkel må holde seg lik
-- normaliserInnholdTekst / innholdDedupNokkel i
-- supabase/functions/hent-saker/logikk.ts.
--
-- manuelt_redigert kommer fra Regjeringen-sporet og finnes ikke nødvendigvis
-- ennå. Finnes kolonnen, slettes aldri rader der den er true. Denne
-- migrasjonen skriver ikke tittel, sammendrag eller kategori.
--
-- Dry-run 2026-10-20 (read-only, 426 rader, kolonnen fantes ikke) ville slettet
-- 18 rader og beholdt eldste i hver gruppe. Ingen av dem hadde rader i
-- aktivitet, epost_varsler, fulgte_saker, horingssvar, kampanjer eller
-- klartekst_cache. Stortinget p=200242/200243, p=200128/200129 og
-- p=200387/200464 grupperes ikke, fordi sak-id inngår i nøkkelen.
--
-- Slettes:
--   Bydel Ullern, «Årshjul Ullern kultur- og oppvekstkomite 2026»
--     behold 1335be2a-7123-46af-9d2f-88e777494085
--     ff5391a4-a990-4e46-bc4f-eb9eec3fcfda
--     8cc5e06a-6ffd-462f-9f1b-327d88d461a7
--     76b5ecb1-7079-4e40-a117-65edf72a8bfb
--     8d53e309-9768-4f36-8390-5be00fd60567
--     930c62a5-af63-40c1-836d-95a6b297dccd
--   Arendal kommune, «Kommunedelplan for kunst, kultur, friluft og idrett 2026-2035»
--     behold 8e19ee5d-c3ec-48f2-b498-020b718da4d8
--     789d814f-d401-4ddd-8153-777663a36b91
--     9a4b49ea-28d0-4746-bbad-5b8818db108d
--     4fbf0e20-7748-4315-8b8f-a91bcc95709f
--     1b17452c-470c-4dbf-99e3-34bfef8114b3
--   Bystyrets sekretariat, «Kultur- og utdanningsutvalget - Studiereise 2026»
--     behold c2c6efe0-b428-42f4-9293-99b277cfaf63
--     67a01032-16e4-4245-b66f-d3e63af98756
--     8e4f8b75-5053-4801-b83b-45188248ada4
--   Østfold fylkeskommune, «Tilskuddsordninger kultur og idrett - orientering om tildelinger 2026»
--     behold 8af5a642-cd34-42b6-bbf5-2303cfc8f1c2
--     cc15a2d9-cbbb-4622-a7c7-5320a379e98d
--     390382e2-e405-4717-9d8d-3645e5138e13
--   Tvedestrand kommune, «Kultur- og idrettsplan 2026-2030»
--     behold 0928cac5-385f-426e-b03e-c921c20b73fe
--     40ae062c-eda2-4b34-9251-641406a0508d
--     9c033557-6037-4b97-b613-8d52f5334dce
--   Vestland fylkeskommune, «Opne søknadar kultur og folkehelse»
--     behold e4698af2-1355-442b-be1d-3e965799d5a2
--     a2c11fc5-187f-401d-8d90-9da2dd195568
--   Bystyrets sekretariat, «Byrådets årsberetning for 2025 - Kultur- og utdanningsutvalgets område»
--     behold 774d8e46-8a9a-4595-a632-b0fc46a6bd1f
--     8ecddd83-d989-4d73-bdcf-b207abb11a1d
--   Bergen bystyre, «Overføring av landbruksoppgaver til myndighetsnivå 1 …»
--     behold 5fab318f-423d-4e9e-8fbe-c877e4fde835
--     b2fce9f0-5b02-4234-8f61-aef4a2f47ab3

create or replace function public.normaliser_innhold_tekst(raw text)
returns text
language sql
immutable
set search_path = pg_catalog
as $fn$
  select nullif(
    btrim(regexp_replace(
      translate(lower(raw), 'ÆØÅ', 'æøå'),
      '[^0-9a-zæøå]+',
      ' ',
      'g'
    )),
    ''
  );
$fn$;

comment on function public.normaliser_innhold_tekst(text) is
  'Sammenligningstekst for innholdsduplikater. Samme regler som normaliserInnholdTekst. Ikke security definer.';

create or replace function public.innhold_dedup_nokkel(
  instans text,
  tittel text,
  frist date,
  kilde text
)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  i text := public.normaliser_innhold_tekst(instans);
  t text := public.normaliser_innhold_tekst(tittel);
  sak text := '';
  m text[];
begin
  if i is null or t is null then
    return null;
  end if;

  if kilde is not null
    and kilde ~* 'stortinget\.no'
    and kilde !~* 'ventede-saker'
  then
    m := regexp_match(kilde, '[?&]p=([0-9]+)');
    if m is not null then
      sak := 'p=' || m[1];
    end if;
  end if;

  if sak = '' and kilde is not null and kilde ~* 'regjeringen\.no' then
    m := regexp_match(kilde, '/id([0-9]+)');
    if m is not null then
      sak := 'id' || m[1];
    end if;
  end if;

  if sak = ''
    and kilde is not null
    and kilde ~* 'kulturdirektoratet\.no'
    and position('#' in kilde) > 0
  then
    sak := lower(substring(kilde from position('#' in kilde)));
  end if;

  if sak = ''
    and kilde is not null
    and kilde ~* 'stortinget\.no'
    and position('#sak-' in lower(kilde)) > 0
  then
    sak := substring(lower(kilde) from position('#sak-' in lower(kilde)));
  end if;

  return i || '|' || t || '|' || coalesce(to_char(frist, 'YYYY-MM-DD'), '') || '|' || sak;
end
$fn$;

comment on function public.innhold_dedup_nokkel(text, text, date, text) is
  'Dedup-nøkkel: instans, normalisert tittel, frist og stabil sak-id. Ikke security definer.';

-- Idempotent. Andre kjøring finner ingen ikke-manuelle dubletter igjen.
do $rydd$
declare
  har_manuell boolean;
  slettet text;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'varsler'
      and column_name = 'manuelt_redigert'
  ) into har_manuell;

  create temporary table _innhold_rad on commit drop as
  select
    v.id,
    v.opprettet,
    public.innhold_dedup_nokkel(v.instans, v.tittel, v.frist, v.kilde) as nokkel,
    false as manuell
  from public.varsler v
  where public.innhold_dedup_nokkel(v.instans, v.tittel, v.frist, v.kilde) is not null;

  if har_manuell then
    execute $q$
      update _innhold_rad r
      set manuell = coalesce(v.manuelt_redigert, false)
      from public.varsler v
      where v.id = r.id
    $q$;
  end if;

  create temporary table _innhold_duplikat on commit drop as
  with gruppert as (
    select
      id,
      nokkel,
      manuell,
      row_number() over (
        partition by nokkel
        order by opprettet asc nulls last, id asc
      ) as rn
    from _innhold_rad
  )
  select g.id as slett_id, b.id as behold_id
  from gruppert g
  join gruppert b on b.nokkel = g.nokkel and b.rn = 1
  where g.rn > 1
    and g.manuell = false;

  update public.aktivitet a
  set sak_id = d.behold_id
  from _innhold_duplikat d
  where a.sak_id = d.slett_id;

  delete from public.epost_varsler e
  using _innhold_duplikat d
  where e.sak_id = d.slett_id
    and exists (
      select 1 from public.epost_varsler e2
      where e2.bruker_id = e.bruker_id and e2.sak_id = d.behold_id
    );
  update public.epost_varsler e
  set sak_id = d.behold_id
  from _innhold_duplikat d
  where e.sak_id = d.slett_id;

  delete from public.fulgte_saker f
  using _innhold_duplikat d
  where f.sak_id = d.slett_id
    and exists (
      select 1 from public.fulgte_saker f2
      where f2.bruker_id = f.bruker_id and f2.sak_id = d.behold_id
    );
  update public.fulgte_saker f
  set sak_id = d.behold_id
  from _innhold_duplikat d
  where f.sak_id = d.slett_id;

  update public.horingssvar h
  set sak_id = d.behold_id
  from _innhold_duplikat d
  where h.sak_id = d.slett_id;

  update public.kampanjer k
  set sak_id = d.behold_id
  from _innhold_duplikat d
  where k.sak_id = d.slett_id;

  delete from public.klartekst_cache c
  using _innhold_duplikat d
  where c.varsel_id = d.slett_id
    and exists (
      select 1 from public.klartekst_cache c2
      where c2.varsel_id = d.behold_id
        and c2.profil_nokkel = c.profil_nokkel
    );
  update public.klartekst_cache c
  set varsel_id = d.behold_id
  from _innhold_duplikat d
  where c.varsel_id = d.slett_id;

  delete from public.varsler v
  using _innhold_duplikat d
  where v.id = d.slett_id;

  select string_agg(slett_id::text, ', ' order by slett_id::text)
    into slettet
  from _innhold_duplikat;

  raise notice 'innholdsdubletter slettet (%): %',
    (select count(*) from _innhold_duplikat),
    coalesce(slettet, '(ingen)');
end
$rydd$;
