-- Kulturpolitikk er et valgbart fagområde. Håkon godkjente 26. oktober 2026.
-- Erstatter returverdien fra 20261024200000. Den filen endres ikke.
-- Samme verdi som KULTURPOLITIKK_VALGBART i src/minside/kulturpolitikk.ts.
-- sak_treffer_abonnement leser funksjonen. Ingen e-post.

create or replace function public.kulturpolitikk_valgbart()
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select true
$$;

comment on function public.kulturpolitikk_valgbart() is
  'Samme verdi som KULTURPOLITIKK_VALGBART. true: kulturpolitikk er et vanlig fag i profiler.fagfelt og i sak_treffer_abonnement. Saker merket kulturpolitikk treffer bare tomt fagfelt eller et fagfelt som inneholder verdien.';

revoke all on function public.kulturpolitikk_valgbart() from public;
revoke all on function public.kulturpolitikk_valgbart() from anon, authenticated;
grant execute on function public.kulturpolitikk_valgbart() to service_role;
