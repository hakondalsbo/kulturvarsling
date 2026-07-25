-- Registrer de aktive adapterne i kilderegisteret, så kjøringsloggen
-- (kilde_kjoringer) kan kobles til kilde og døde kilder blir synlige.

create unique index if not exists kilder_adapter_unik on kilder (adapter);

insert into kilder (navn, niva, organ, adapter, prioritet) values
  ('Stortinget – saker med høringsfrister', 'nasjonalt', 'Stortinget', 'stortinget-saker', 1),
  ('Stortinget – ventede saker (tidligvarsling)', 'nasjonalt', 'Stortinget', 'stortinget-ventede', 1),
  ('Regjeringen – RSS (høringer, NOU, meldinger, proposisjoner)', 'nasjonalt', 'Regjeringen', 'regjeringen-rss', 1),
  ('eInnsyn – kultursaker i politiske møter (nasjonalt aggregat)', 'nasjonalt', 'eInnsyn/Digdir', 'einnsyn', 1)
on conflict (adapter) do nothing;
