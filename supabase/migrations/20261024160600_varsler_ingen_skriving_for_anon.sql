-- Godkjent av Håkon via fullmakt 24.10 kl. 16:06.
--
-- Tar bort INSERT, UPDATE, DELETE og TRUNCATE på public.varsler
-- for anon og authenticated. SELECT, REFERENCES, TRIGGER og MAINTENANCE
-- blir stående. service_role og postgres røres ikke.
-- Ingen andre tabeller røres.
--
-- Ingen klient, Edge Function med anon-nøkkel eller bruker-JWT,
-- og ingen SECURITY INVOKER-funksjon som anon eller authenticated
-- kan kalle, skriver til tabellen. Skriving skjer med service_role.
-- overstyr_varsel er SECURITY DEFINER og kan ikke kjøres av disse rollene.

revoke insert, update, delete, truncate on public.varsler from anon, authenticated;
