-- Skjul (IKKE slett) batchen som ble lagret 24.07.2026 mens Claude-filteret
-- var nede — sakene var ufiltrerte og delvis feilkategorisert (forsvarsbudsjett
-- merket «scenekunst»). Reversibelt: publisert=false gjemmer dem fra appen
-- (appen viser kun publisert=true). Radene beholdes, og dedup hindrer at de
-- AI-vurderes på nytt. Bruker ba eksplisitt om denne oppryddingen 25.07.

update varsler
set publisert = false
where opprettet >= '2026-07-24T10:00:00Z'
  and opprettet <  '2026-07-25T00:00:00Z'
  and publisert = true;
