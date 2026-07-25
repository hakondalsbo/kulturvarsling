-- Engangs-opprydding: fjern batchen som ble lagret 24.07.2026 kl. 10:30 UTC
-- MENS Claude-relevansfilteret var nede (API-kreditt tom) — sakene gikk rett
-- i databasen ufiltrert og delvis feilkategorisert (bl.a. forsvarsbudsjett
-- merket «scenekunst»). Brukeren bekreftet slettingen 25.07 (kjørte selv
-- DELETE via REST, som ble stoppet av RLS for anon-rollen).
-- Sakene re-innhentes automatisk og riktig ved neste kjøring når filteret
-- er oppe igjen (dedup mot kilde-URL slår ikke inn når radene er borte).

delete from varsler
where opprettet >= '2026-07-24T10:00:00Z'
  and opprettet <  '2026-07-25T00:00:00Z';
