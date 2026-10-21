-- Kildens egen publiseringstid, og skille mellom vanlig kjøring og backfill.
-- Ingen avpublisering og ingen sletting. Rader med manuelt_redigert skrives
-- ikke. varsler.opprettet er når Kulturvarsling satte inn raden, og kopieres
-- ikke hit: det var den forvekslingen som gjorde sakene fra 24.06 og 21.09
-- til «nye» 21.10.
--
-- Andre kilder har ikke publiseringstiden lagret. Den fylles når adapteren
-- ser saken igjen, og bare der kilde_publisert er null og manuelt_redigert
-- er usann. Bergen er unntaket: møtedato er kildedatoen adapteren allerede
-- bruker, og kan derfor settes her.

alter table public.varsler
  add column if not exists kilde_publisert timestamptz;

comment on column public.varsler.kilde_publisert is
  'Kildens egen publiseringstid. Ikke varsler.opprettet. Null når kilden ikke har en dato. Automatikk skriver ikke feltet på rader med manuelt_redigert.';

update public.varsler
set kilde_publisert = (motedato::timestamp at time zone 'Europe/Oslo')
where kilde ilike '%bergen.kommune.no%'
  and motedato is not null
  and kilde_publisert is null
  and manuelt_redigert is not true;

alter table public.kilde_kjoringer
  add column if not exists kjoeringstype text not null default 'vanlig';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kilde_kjoringer_kjoeringstype_check'
      and conrelid = 'public.kilde_kjoringer'::regclass
  ) then
    alter table public.kilde_kjoringer
      add constraint kilde_kjoringer_kjoeringstype_check
      check (kjoeringstype in ('vanlig', 'backfill'));
  end if;
end $$;

comment on column public.kilde_kjoringer.kjoeringstype is
  'vanlig = daglig innhenting med datogrense mot siste vellykkede kjøring. backfill = eksplisitt kall uten den grensen. Cron kan ikke sette backfill.';

comment on column public.kilde_kjoringer.status is
  'ok_nye | ok_ingen_nye | tom | delvis | feil_http | feil_timeout | feil_parse | feil_auth | feil_nett | feil_tomt_svar | feil_manglende_frist | http_feil. http_feil er spredte kallfeil under alarmgrensen og setter ikke alarm. feil_* og delvis gjør det.';
