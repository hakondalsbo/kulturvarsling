-- antall_nye skal bare telle saker hent-saker faktisk lagret og publiserte.
-- Saker som avvises automatisk (datofilter, relevansfilter, sperre)
-- telles i antall_avvist. Eksisterende rader får 0.
-- Ingen endring av varsler. Ingen kjøring mot prod i denne filen.

alter table public.kilde_kjoringer
  add column if not exists antall_avvist integer not null default 0;

comment on column public.kilde_kjoringer.antall_avvist is
  'Saker avvist automatisk av datofilter, relevansfilter eller sperre (tall uten kilde). Telles ikke i antall_nye. 0 når ingen ble avvist.';

comment on column public.kilde_kjoringer.antall_nye is
  'Nye varsler som hent-saker faktisk lagret og publiserte. Avviste saker ligger i antall_avvist. Alltid 0 for jobb oppdater-frister. Summer bare der jobb = hent-saker.';
