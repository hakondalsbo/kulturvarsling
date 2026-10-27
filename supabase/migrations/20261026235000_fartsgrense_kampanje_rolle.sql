-- privat.fartsgrense_kampanje() er SECURITY DEFINER. current_user er da
-- eieren, så den gamle sjekken slapp alle kampanjeforslag gjennom og
-- skrev ingen rader i fartsgrense.
--
-- Hvem som setter inn leses fra auth.role() (JWT-et PostgREST setter)
-- og, når det er tomt, fra current_setting('role') (SET ROLE).
-- auth.uid() teller per bruker den siste timen. anon telles per IP.
-- service_role, postgres og andre roller enn anon/authenticated slipper.
--
-- Kan kjøres flere ganger. meld_pa_forsok og mobiliser_forsok røres ikke.

create schema if not exists privat;

create or replace function privat.fartsgrense_kampanje()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  raw text;
  hoder json;
  ip text;
  bruker text := '';
  ip_nokkel text;
  bruker_nokkel text;
  antall_ip int;
  antall_bruker int;
  jwt_rolle text := '';
  sesjon_rolle text := '';
  rolle text;
  grense_ip constant int := 20;
  grense_bruker constant int := 5;
begin
  jwt_rolle := coalesce(auth.role(), '');
  sesjon_rolle := coalesce(pg_catalog.current_setting('role', true), '');
  rolle := coalesce(nullif(pg_catalog.btrim(jwt_rolle), ''), nullif(pg_catalog.btrim(sesjon_rolle), ''));

  if rolle is null or rolle not in ('anon', 'authenticated') then
    return new;
  end if;

  delete from public.fartsgrense
  where endepunkt = 'foreslaa_kampanje'
    and opprettet_at < pg_catalog.now() - interval '48 hours';

  raw := pg_catalog.current_setting('request.headers', true);
  if raw is null or pg_catalog.btrim(raw) = '' then
    hoder := '{}'::json;
  else
    begin
      hoder := raw::json;
    exception when others then
      hoder := '{}'::json;
    end;
  end if;

  ip := pg_catalog.left(pg_catalog.btrim(pg_catalog.split_part(coalesce(
    hoder->>'cf-connecting-ip',
    hoder->>'x-real-ip',
    hoder->>'x-forwarded-for',
    ''
  ), ',', 1)), 64);
  ip := pg_catalog.regexp_replace(ip, '[[:cntrl:]]', '', 'g');
  if ip = '' then
    ip := 'ukjent';
  end if;

  begin
    bruker := coalesce(auth.uid()::text, '');
  exception when others then
    bruker := '';
  end;

  ip_nokkel := 'ip:' || encode(
    extensions.digest(convert_to('foreslaa_kampanje|ip|' || ip, 'UTF8'), 'sha256'),
    'hex'
  );

  select count(*) into antall_ip
  from public.fartsgrense
  where endepunkt = 'foreslaa_kampanje'
    and nokkel = ip_nokkel
    and opprettet_at > pg_catalog.now() - interval '1 hour';

  antall_bruker := 0;
  if bruker <> '' then
    bruker_nokkel := 'bruker:' || encode(
      extensions.digest(convert_to('foreslaa_kampanje|bruker|' || bruker, 'UTF8'), 'sha256'),
      'hex'
    );
    select count(*) into antall_bruker
    from public.fartsgrense
    where endepunkt = 'foreslaa_kampanje'
      and nokkel = bruker_nokkel
      and opprettet_at > pg_catalog.now() - interval '1 hour';
  end if;

  if antall_ip >= grense_ip or antall_bruker >= grense_bruker then
    raise exception 'For mange forsøk. Prøv igjen senere.'
      using errcode = 'P0001';
  end if;

  insert into public.fartsgrense (endepunkt, nokkel)
  values ('foreslaa_kampanje', ip_nokkel);
  if bruker <> '' then
    insert into public.fartsgrense (endepunkt, nokkel)
    values ('foreslaa_kampanje', bruker_nokkel);
  end if;

  return new;
end
$fn$;

comment on function privat.fartsgrense_kampanje() is
  'BEFORE INSERT på kampanjer for anon og authenticated. Rollen er auth.role() eller current_setting(''role''), ikke eieren, fordi funksjonen er SECURITY DEFINER. Bruker telles med auth.uid() per time. service_role og postgres slipper. Ikke et API.';

revoke all on function privat.fartsgrense_kampanje() from public;
grant execute on function privat.fartsgrense_kampanje() to anon, authenticated, service_role;

drop trigger if exists fartsgrense_foreslaa_kampanje on public.kampanjer;
create trigger fartsgrense_foreslaa_kampanje
  before insert on public.kampanjer
  for each row
  execute function privat.fartsgrense_kampanje();
