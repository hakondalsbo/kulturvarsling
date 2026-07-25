-- E1 Geografi (VEIKART): brukerens hjemkommune på profilen.
-- fylkesnr lagres denormalisert (= to første siffer i kommunenr) så
-- varsellisten kan matche fylkessaker uten utledning i klienten.
alter table profiler add column if not exists kommunenr text;
alter table profiler add column if not exists fylkesnr  text;
