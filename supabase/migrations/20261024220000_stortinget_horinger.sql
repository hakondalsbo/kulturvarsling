-- Komitéhøringer fra data.stortinget.no. Klienten leser fristene via
-- varsler, ikke via denne tabellen. Ingen policy for anon eller authenticated.
-- Gamle migrasjoner er ikke endret.

create table public.stortinget_horinger (
  horing_id integer primary key,
  varsel_id uuid references public.varsler (id) on delete set null,
  komite_id text,
  komite_navn text,
  type text,
  skriftlig boolean,
  horing_status text,
  frist_delta timestamptz,
  frist_innspill timestamptz,
  tidspunkter jsonb not null default '[]'::jsonb,
  sak_ider integer[] not null default '{}',
  sist_sett timestamptz not null default now(),
  constraint stortinget_horinger_type_check
    check (type is null or type in ('komite', 'kontroll'))
);

comment on table public.stortinget_horinger is
  'Detaljer for komitéhøringer. Ingen personnavn. anon og authenticated har ikke tilgang. Frister med klokkeslett vises via varsler.sammendrag.';

comment on column public.stortinget_horinger.frist_delta is
  'Frist for å søke om å delta, fra anmodningsfrist_dato_tid.';

comment on column public.stortinget_horinger.frist_innspill is
  'Frist for skriftlig innspill.';

comment on column public.stortinget_horinger.tidspunkter is
  'Sted og tidspunkt. Ingen navn fra høringsprogrammet.';

create index stortinget_horinger_varsel_idx
  on public.stortinget_horinger (varsel_id);

create index stortinget_horinger_komite_idx
  on public.stortinget_horinger (komite_id);

alter table public.stortinget_horinger enable row level security;

revoke all on table public.stortinget_horinger from public;
revoke all on table public.stortinget_horinger from anon;
revoke all on table public.stortinget_horinger from authenticated;

grant select, insert, update on table public.stortinget_horinger to service_role;

insert into public.kilder (navn, niva, organ, adapter, prioritet, forventer_treff)
values (
  'Stortinget – komitéhøringer',
  'nasjonalt',
  'Stortinget',
  'stortinget-horinger',
  2,
  false
)
on conflict (adapter) do nothing;

comment on column public.varsler.handling is
  'handling_mulig eller bare_orientering. Null til verdien settes. stortinget-horinger setter feltet: kontrollhøring (type 2) er bare_orientering, ellers handling_mulig når en frist er åpen. Andre automatiske jobber skriver ikke feltet. Høringsløpet lar manuelt redigerte rader stå.';

comment on column public.varsler.hovedsak_id is
  'Peker på en relatert sak. Nyhet eller tale med denne satt skal ikke publiseres. En komitéhøring kan være publisert og peke på stortingssaken.';

-- Samme regler som adapterFraKildeUrl. Hørings-URL før den generelle Stortinget-regelen.
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
    when lower(raw) like '%stortinget.no%'
      and lower(raw) like '%/horing/%'
      then 'stortinget-horinger'
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
  'Mapper varsler.kilde til kilder.adapter. Høringslenker med /horing/ er stortinget-horinger. Ikke security definer.';

update public.varsler v
set kilde_id = k.id
from public.kilder k
where k.adapter = 'stortinget-horinger'
  and k.adapter = public.adapter_fra_kilde(v.kilde)
  and v.kilde_id is distinct from k.id;

-- h= skiller to høringer i samme sak. p= er uendret.
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
    m := regexp_match(kilde, '[?&]h=([0-9]+)');
    if m is not null then
      sak := 'h=' || m[1];
    end if;
    if sak = '' then
      m := regexp_match(kilde, '[?&]p=([0-9]+)');
      if m is not null then
        sak := 'p=' || m[1];
      end if;
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
  'Dedup-nøkkel: instans, normalisert tittel, frist og stabil sak-id. h= for høringer, p= for saker. Ikke security definer.';
