-- Ventende bekreftelses-e-post. Additivt. Sender ingen e-post og
-- oppretter ingen tidsplan. Eksisterende rader får ikke et tidspunkt:
-- NULL betyr at bekreftelsen ikke er sendt.

alter table public.pamelding
  add column if not exists bekreftelse_sendt_at timestamptz;

comment on column public.pamelding.bekreftelse_sendt_at is
  'Når Resend aksepterte bekreftelses-e-posten. NULL betyr ventende bekreftelse, ikke at raden er bekreftet.';

create index if not exists pamelding_venter_bekreftelse_idx
  on public.pamelding (id)
  where bekreftelse_sendt_at is null
    and bekreftet_at is null
    and avmeldt_at is null
    and samtykke_gitt_at is not null;

-- Logg for manuell utsending. status = sendt brukes til dedup.
create table if not exists public.bekreftelse_utsendelser (
  id bigint generated always as identity primary key,
  pamelding_id bigint references public.pamelding (id) on delete cascade,
  epost_normalisert text not null,
  resend_id text,
  status text not null,
  sendt_at timestamptz not null default now(),
  constraint bekreftelse_utsendelser_status_chk
    check (status in ('sendt', 'feilet', 'ikke_konfigurert', 'duplikat'))
);

comment on table public.bekreftelse_utsendelser is
  'Logg for bekreftelses-e-post fra meld-pa og den manuelle funksjonen send-bekreftelser. Ikke en tidsplan.';

create index if not exists bekreftelse_utsendelser_pamelding_idx
  on public.bekreftelse_utsendelser (pamelding_id);

create unique index if not exists bekreftelse_utsendelser_sendt_unik
  on public.bekreftelse_utsendelser (pamelding_id)
  where status = 'sendt' and pamelding_id is not null;

alter table public.bekreftelse_utsendelser enable row level security;
revoke all on table public.bekreftelse_utsendelser from anon, authenticated;
revoke all on table public.bekreftelse_utsendelser from PUBLIC;
grant select, insert, update, delete on table public.bekreftelse_utsendelser to service_role;
grant usage, select on sequence public.bekreftelse_utsendelser_id_seq to service_role;
