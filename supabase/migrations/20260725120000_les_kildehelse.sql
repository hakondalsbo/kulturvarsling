-- Åpne kilderegisteret og kjøringsloggen for lesing fra appen
-- (innholdet er metadata om offentlige kilder — ikke sensitivt).
-- Trengs for kildehelse-visning og for å kunne verifisere drift.

create policy "les_kilder" on kilder for select using (true);
create policy "les_kilde_kjoringer" on kilde_kjoringer for select using (true);
