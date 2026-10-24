-- Additivt. Ingen UPDATE og ingen backfill av eksisterende varsler.
-- Godkjent av Håkon 24.10 15:55.
--
-- Eget felt ved siden av konsekvens-dimensjonen i PR #13
-- (kutt_innstramming, stor_endring, ny_mulighet, til_orientering).
-- konsekvens sier hva saken betyr. handling sier om leseren kan gjøre noe,
-- eller om saken bare er orientering. bare_orientering er ikke til_orientering.
--
-- Uten standardverdi, så eksisterende rader blir null.
-- RLS-policyen «Les varsler» gjelder hele raden (select der publisert = true),
-- ikke enkeltkolonner. Tabellrettigheten er arwdDxtm for anon, authenticated
-- og service_role, og kolonne-ACL er tom, så handling arver lesing og skriving
-- med de andre feltene. Derfor ingen egen grant på kolonnen.
-- Enum-typen trenger usage for de samme rollene, fordi PostgREST leser typen.
--
-- vern_manuelt_redigerte_felt sperrer bare tittel, sammendrag, kategori,
-- frist, motedato og status. handling er ikke blant dem. service_role kan
-- sette feltet med vanlig UPDATE også når manuelt_redigert er true.
-- overstyr_varsel trenger derfor ikke et nytt argument.
-- hent-saker og oppdater-frister skriver ikke kolonnen.

create type public.varsel_handling as enum (
  'handling_mulig',
  'bare_orientering'
);

comment on type public.varsel_handling is
  'Om leseren kan handle, eller om saken bare er orientering. Ved siden av konsekvens, ikke en verdi i den.';

alter table public.varsler
  add column handling public.varsel_handling;

comment on column public.varsler.handling is
  'handling_mulig eller bare_orientering. Null til redaktøren setter verdien. Automatiske jobber skriver ikke feltet. service_role kan sette det også når manuelt_redigert er true.';

grant usage on type public.varsel_handling to anon, authenticated, service_role;
