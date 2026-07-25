// Tester for Bergen-adapteren. Kjøres med Node sin innebygde testkjører:
//   npm test   (= node --test supabase/functions/hent-saker/*.test.ts)

import { test } from "node:test";
import assert from "node:assert/strict";
import { mapBergenAgendapunkt } from "./bergen.ts";

// Reelt agendapunkt fra API-et (verifisert juli 2026)
const PUNKT = {
  tittel: "Temaplan for kunst og kultur — rullering",
  utvalgId: "573732",
  utvalgsNavn: "Utvalg for finans, kultur og næring",
  moteId: "9034514",
  kildeId: "267495",
  moteDato: "2026-05-06",
  saksnr: "2023/257825",
  kildesystem: "bk360",
};

test("agendapunkt mappes med klikkbar dyplenke og geografi", () => {
  const mappet = mapBergenAgendapunkt(PUNKT);
  assert.equal(mappet?.tittel, "Temaplan for kunst og kultur — rullering");
  assert.equal(
    mappet?.kilde,
    "https://www.bergen.kommune.no/politikk/politiskeutvalg/573732/mote/9034514/sak/267495",
  );
  assert.equal(mappet?.instans, "Utvalg for finans, kultur og næring, Bergen kommune");
  assert.equal(mappet?.niva, "kommune");
  assert.equal(mappet?.sted, "Bergen");
  assert.equal(mappet?.kommunenr, "4601");
  assert.equal(mappet?.fylkesnr, "46");
  assert.equal(mappet?.publisert_dato, "2026-05-06");
  assert.equal(mappet?.kilde_id, "bergen-267495-9034514");
  assert.equal(mappet?.forhåndsgodkjent, true);
});

test("møtedato og saksnr havner i sammendraget", () => {
  const mappet = mapBergenAgendapunkt(PUNKT);
  assert.match(mappet!.sammendrag_raa, /møte 2026-05-06/);
  assert.match(mappet!.sammendrag_raa, /saksnr 2023\/257825/);
});

test("rutinesaker filtreres bort før Claude-vurdering", () => {
  for (const tittel of [
    "Innkalling utvalg for finans, kultur og næring 14.01.2026",
    "Protokoll fra møte i utvalg for kultur",
    "Godkjenning av møteinnkalling og sakskart",
    "Eventuelt utvalg for finans, kultur og næring",
  ]) {
    assert.equal(mapBergenAgendapunkt({ ...PUNKT, tittel }), null, tittel);
  }
});

test("punkt uten id-er til dyplenken forkastes", () => {
  assert.equal(mapBergenAgendapunkt({ ...PUNKT, utvalgId: undefined }), null);
  assert.equal(mapBergenAgendapunkt({ ...PUNKT, moteId: undefined }), null);
  assert.equal(mapBergenAgendapunkt({ ...PUNKT, kildeId: undefined }), null);
  assert.equal(mapBergenAgendapunkt({ ...PUNKT, tittel: "" }), null);
});

test("manglende utvalgsnavn og møtedato krasjer ikke", () => {
  const mappet = mapBergenAgendapunkt({
    tittel: "Kulturbygg i Fana",
    utvalgId: "1",
    moteId: "2",
    kildeId: "3",
  });
  assert.equal(mappet?.instans, "Politisk utvalg, Bergen kommune");
  assert.equal(mappet?.publisert_dato, null);
});
