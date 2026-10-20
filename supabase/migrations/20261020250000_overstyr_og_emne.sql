-- Additivt. Ingen UPDATE av eksisterende varsler.
-- 1) Nyhet/tale om samme sak kan peke på hovedsaken uten å publiseres.
-- 2) manuelt_redigert forkaster ikke lenger feltendringer i stillhet.
--    Vanlig UPDATE som rører tittel, sammendrag, kategori, frist, møtedato
--    eller status feiler tydelig, også når feltet var tomt.
--    overstyr_varsel setter en transaksjonslokal variabel triggeren godtar,
--    og skriver hvem/hva/når i varsel_endringslogg. Bare service_role og postgres.
--    Andre kolonner, som kilde_id, kan fortsatt fylles.

alter table public.varsler
  add column if not exists hovedsak_id uuid references public.varsler(id) on delete set null;

comment on column public.varsler.hovedsak_id is
  'Nyhet eller tale som gjelder samme sak som en høring eller hovedpressemelding. Raden skal ikke publiseres.';

create table if not exists public.varsel_endringslogg (
  id uuid primary key default gen_random_uuid(),
  varsel_id uuid not null references public.varsler(id) on delete cascade,
  felt text not null,
  fra_verdi text,
  til_verdi text,
  hvem text not null,
  endret timestamptz not null default now()
);

comment on table public.varsel_endringslogg is
  'Tekstendringer som er sluppet gjennom manuelt_redigert via overstyr_varsel. Hvem, felt og tidspunkt.';

alter table public.varsel_endringslogg enable row level security;

revoke all on table public.varsel_endringslogg from public;
revoke all on table public.varsel_endringslogg from anon;
revoke all on table public.varsel_endringslogg from authenticated;
grant select, insert on table public.varsel_endringslogg to service_role;

revoke update, delete, truncate on public.varsel_endringslogg from service_role, anon, authenticated;

create or replace function public.vern_manuelt_redigerte_felt()
returns trigger
language plpgsql
set search_path = pg_catalog
as $fn$
declare
  hvem text;
begin
  if new.manuelt_redigert and not coalesce(old.manuelt_redigert, false) then
    if new.manuelt_redigert_at is null then
      new.manuelt_redigert_at := now();
    end if;
  end if;

  if old.manuelt_redigert
     and (
       new.tittel is distinct from old.tittel
       or new.sammendrag is distinct from old.sammendrag
       or new.kategori is distinct from old.kategori
       or new.frist is distinct from old.frist
       or new.motedato is distinct from old.motedato
       or new.status is distinct from old.status
     )
  then
    if coalesce(pg_catalog.current_setting('app.varsel_overstyr', true), '') = '1' then
      hvem := coalesce(nullif(pg_catalog.current_setting('app.varsel_hvem', true), ''), 'ukjent');
      if new.tittel is distinct from old.tittel then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'tittel', old.tittel, new.tittel, hvem);
      end if;
      if new.sammendrag is distinct from old.sammendrag then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'sammendrag', old.sammendrag, new.sammendrag, hvem);
      end if;
      if new.kategori is distinct from old.kategori then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'kategori', old.kategori, new.kategori, hvem);
      end if;
      if new.frist is distinct from old.frist then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'frist', old.frist::text, new.frist::text, hvem);
      end if;
      if new.motedato is distinct from old.motedato then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'motedato', old.motedato::text, new.motedato::text, hvem);
      end if;
      if new.status is distinct from old.status then
        insert into public.varsel_endringslogg (varsel_id, felt, fra_verdi, til_verdi, hvem)
        values (old.id, 'status', old.status, new.status, hvem);
      end if;
    else
      raise exception 'Kan ikke endre tittel, sammendrag, kategori, frist, møtedato eller status fordi saken er manuelt redigert. Bruk overstyr_varsel.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end
$fn$;

comment on function public.vern_manuelt_redigerte_felt() is
  'BEFORE UPDATE: feiler tydelig hvis tittel, sammendrag, kategori, frist, møtedato eller status endres på en manuelt redigert sak, også når feltet var tomt. Slipper endringen gjennom bare når overstyr_varsel har satt app.varsel_overstyr i transaksjonen, og logger da feltet.';

revoke all on function public.vern_manuelt_redigerte_felt() from public;
revoke all on function public.vern_manuelt_redigerte_felt() from anon;
revoke all on function public.vern_manuelt_redigerte_felt() from authenticated;
grant execute on function public.vern_manuelt_redigerte_felt() to authenticated, service_role;

create or replace function public.overstyr_varsel(
  p_id uuid,
  p_tittel text,
  p_sammendrag text,
  p_kategori text,
  p_hvem text,
  p_frist date default null,
  p_motedato date default null,
  p_status text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  rolle text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json->>'role',
    nullif(current_setting('request.jwt.claim.role', true), ''),
    session_user
  );
begin
  if rolle not in ('service_role', 'postgres') then
    raise exception 'overstyr_varsel kan bare kalles av service_role eller postgres'
      using errcode = '42501';
  end if;
  if p_hvem is null or length(btrim(p_hvem)) = 0 then
    raise exception 'overstyr_varsel krever hvem som gjør endringen'
      using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('kritisk', 'viktig', 'normal', 'passert') then
    raise exception 'overstyr_varsel godtar bare status kritisk, viktig, normal eller passert'
      using errcode = '23514';
  end if;

  perform set_config('app.varsel_overstyr', '1', true);
  perform set_config('app.varsel_hvem', left(btrim(p_hvem), 200), true);

  update public.varsler
  set
    tittel = coalesce(p_tittel, tittel),
    sammendrag = coalesce(p_sammendrag, sammendrag),
    kategori = coalesce(p_kategori, kategori),
    frist = coalesce(p_frist, frist),
    motedato = coalesce(p_motedato, motedato),
    status = coalesce(p_status, status)
  where id = p_id;

  if not found then
    raise exception 'Fant ikke saken som skulle overstyres'
      using errcode = 'P0002';
  end if;
end
$fn$;

comment on function public.overstyr_varsel(uuid, text, text, text, text, date, date, text) is
  'Eneste vei til å endre låst tittel, sammendrag, kategori, frist, møtedato eller status. Null-argument lar feltet stå. Setter app.varsel_overstyr for transaksjonen og logger via triggeren. SECURITY DEFINER, bare service_role og postgres.';

revoke all on function public.overstyr_varsel(uuid, text, text, text, text, date, date, text) from public;
revoke all on function public.overstyr_varsel(uuid, text, text, text, text, date, date, text) from anon;
revoke all on function public.overstyr_varsel(uuid, text, text, text, text, date, date, text) from authenticated;
grant execute on function public.overstyr_varsel(uuid, text, text, text, text, date, date, text) to service_role;
