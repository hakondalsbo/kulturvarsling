-- Adapterpakke 2 (VEIKART E3): Bergen, Kulturdirektoratet og Sametinget
-- registreres i kilderegisteret så kjøringsloggen (kilde_kjoringer) fanger dem.
-- Statsråd-RSS-en (spillemidler) inngår i eksisterende adapter regjeringen-rss.

insert into kilder (navn, niva, organ, adapter, kommunenr, fylkesnr, prioritet) values
  ('Bergen kommune – politiske utvalg (BK360-API, søk «kultur»)', 'kommune', 'Bergen kommune', 'bergen', '4601', '46', 1),
  ('Kulturdirektoratet – vedtaksdatabase (tildelingsrunder via CSV)', 'nasjonalt', 'Kulturdirektoratet', 'kulturdirektoratet', null, null, 1),
  ('Sametinget – Aktuelt-RSS med ukentlige tildelingslister', 'nasjonalt', 'Sametinget', 'sametinget', null, null, 1)
on conflict (adapter) do nothing;
