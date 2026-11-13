-- Tilbakemeldinger i åpen prøvedrift.
-- Kjør ikke denne filen mot live herfra. Den brukes ved senere deploy.
--
-- public.feedback finnes allerede i produksjon. Nye kolonner er side og sak_id.
-- Vanlige brukere kan fortsatt bare INSERT. Ingen SELECT-policy.
-- status får lovlige verdier for oversikten: ny, sett, planlagt, lost, avvist.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  bruker_id uuid references public.profiler (id) on delete set null,
  type text not null,
  tekst text not null,
  sak_tittel text,
  side text,
  sak_id text,
  status text not null default 'ny',
  opprettet timestamptz not null default now(),
  constraint feedback_type_sjekk check (type in ('feil', 'mangler', 'utdatert', 'forslag', 'annet')),
  constraint feedback_status_sjekk check (status in ('ny', 'sett', 'planlagt', 'lost', 'avvist'))
);

alter table public.feedback add column if not exists side text;
alter table public.feedback add column if not exists sak_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'feedback_status_sjekk'
      and conrelid = 'public.feedback'::regclass
  ) then
    alter table public.feedback
      add constraint feedback_status_sjekk
      check (status in ('ny', 'sett', 'planlagt', 'lost', 'avvist')) not valid;
  end if;
end $$;

alter table public.feedback enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'feedback'
      and policyname = 'Send feedback'
  ) then
    create policy "Send feedback" on public.feedback
      for insert to public
      with check ((select auth.uid()) = bruker_id or bruker_id is null);
  end if;
end $$;

revoke select, update, delete, truncate on table public.feedback from public, anon, authenticated;
grant insert on table public.feedback to anon, authenticated;
grant select, insert, update, delete on table public.feedback to service_role;

create index if not exists feedback_opprettet_idx
  on public.feedback (opprettet desc);

comment on column public.feedback.side is
  'Ruten testeren sto på. Leses bare av service_role.';
comment on column public.feedback.sak_id is
  'Sakens id når tilbakemeldingen gjelder en sak. Leses bare av service_role.';
comment on table public.feedback is
  'Tilbakemeldinger. Klienter kan sette inn, ikke lese. Oversikten går via edge-funksjonen tilbakemeldinger.';
