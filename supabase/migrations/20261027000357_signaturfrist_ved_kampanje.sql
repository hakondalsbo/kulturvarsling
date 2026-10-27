-- Vanlig update av sendt_tid eller avsluttet_tid setter fristene på
-- signaturene, på samme måte som merk_innspill_sendt og
-- merk_innspill_avsluttet. Samme verdi to ganger endrer ikke radene.

create or replace function privat.sett_signaturfrist_ved_kampanje()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_epost timestamptz;
  v_navn timestamptz;
begin
  if new.sendt_tid is not null then
    v_epost := new.sendt_tid + interval '30 days';
    v_navn := new.sendt_tid + interval '12 months';
  elsif new.avsluttet_tid is not null then
    v_epost := new.avsluttet_tid + interval '12 months';
    v_navn := new.avsluttet_tid + interval '12 months';
  else
    return new;
  end if;

  update public.kampanje_signaturer
  set
    epost_slettes_etter = v_epost,
    slettes_etter = v_navn
  where kampanje_id = new.id
    and (
      epost_slettes_etter is distinct from v_epost
      or slettes_etter is distinct from v_navn
    );

  return new;
end
$fn$;

comment on function privat.sett_signaturfrist_ved_kampanje() is
  'Etter update av sendt_tid eller avsluttet_tid: e-post 30 dager og navn 12 måneder etter sending, ellers begge 12 måneder etter avslutning. Skriver ikke om fristen alt er den samme.';

revoke all on function privat.sett_signaturfrist_ved_kampanje() from public, anon, authenticated;
grant execute on function privat.sett_signaturfrist_ved_kampanje() to service_role;

drop trigger if exists sett_signaturfrist_ved_kampanje on public.kampanjer;
create trigger sett_signaturfrist_ved_kampanje
  after update of sendt_tid, avsluttet_tid on public.kampanjer
  for each row
  when (
    old.sendt_tid is distinct from new.sendt_tid
    or old.avsluttet_tid is distinct from new.avsluttet_tid
  )
  execute function privat.sett_signaturfrist_ved_kampanje();
