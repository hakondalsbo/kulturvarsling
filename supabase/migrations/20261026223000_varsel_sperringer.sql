-- Sporbare rader for saker som ble holdt tilbake eller flagget fordi
-- sammendraget har tall som ikke står i kilden. Én rad per sak og oppgave.
--
-- kilde_kjoringer passer ikke: den er én rad per kilde per kjøring, har
-- ingen varsel_id, og alarm er generert fra feil_* og delvis (kildefeil).
-- kilde_alarmer er et view over siste hent-saker-kjøring. En sak der
-- ville forsvinne neste morgen, og feilmelding er én offentlig tekst
-- for hele kilden.
--
-- hent-saker setter publisert = false og skriver raden her.
-- klartekst skriver cachen likevel, og skriver også raden her.
-- anon og authenticated har ingen tilgang. Morgenrutinen leser tabellen
-- som postgres eller service_role:
--   select varsel_id, arsak, oppgave, detalj, opprettet
--   from public.varsel_sperringer
--   order by opprettet desc;

create table public.varsel_sperringer (
  id bigint generated always as identity primary key,
  varsel_id uuid not null references public.varsler (id) on delete cascade,
  arsak text not null,
  oppgave text not null,
  detalj jsonb not null,
  opprettet timestamptz not null default now(),
  constraint varsel_sperringer_arsak_check check (arsak = 'tall_uten_kilde'),
  constraint varsel_sperringer_oppgave_check check (oppgave in ('hent-saker', 'klartekst')),
  constraint varsel_sperringer_sak_oppgave_unik unique (varsel_id, arsak, oppgave)
);

comment on table public.varsel_sperringer is
  'Saker flagget med tall_uten_kilde. varsel_id og arsak er sporbare. Ikke en kildealarm: kilde_kjoringer har ikke varsel-id, og kilde_alarmer viser bare siste kjøring per kilde.';

comment on column public.varsel_sperringer.arsak is
  'tall_uten_kilde. Sammendraget har årstall eller tall som ikke står i kildeteksten.';

comment on column public.varsel_sperringer.oppgave is
  'hent-saker holder varselet upublisert. klartekst skriver cachen likevel og legger bare igjen denne raden.';

comment on column public.varsel_sperringer.detalj is
  'Bare årstallene og tallene som manglet i kilden. Ikke sammendraget og ikke kilde-URL.';

create index varsel_sperringer_opprettet_idx
  on public.varsel_sperringer (opprettet desc);

alter table public.varsel_sperringer enable row level security;

revoke all on table public.varsel_sperringer from public;
revoke all on table public.varsel_sperringer from anon;
revoke all on table public.varsel_sperringer from authenticated;

grant select, insert on table public.varsel_sperringer to service_role;
grant usage, select on sequence public.varsel_sperringer_id_seq to service_role;

-- Default-privilegier gir service_role alle tabellrettigheter. Den trenger
-- bare select og insert (og sekvensen over). 
revoke update, delete, truncate, references, trigger
  on table public.varsel_sperringer from service_role;
