-- Slår på følg-komité. Kjør etter deploy.
-- Ingen e-post. Utsending, Resend og mottakere_for_sak røres ikke.
-- RLS i 20261024221000 slipper inn innsetting bare når flagget er på,
-- og bare for egen bruker. Sletting av konto sletter radene via
-- on delete cascade mot auth.users.

update public.funksjonsflagg
set aktiv = true
where nokkel = 'folg_komite';

comment on table public.funksjonsflagg is
  'Funksjoner som kan slås av og på. folg_komite er på. Følging sender ingen e-post og vises bare i appen.';
