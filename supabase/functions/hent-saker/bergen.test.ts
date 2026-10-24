// Tester for Bergen-adapteren. Kjøres med Node sin innebygde testkjører:
//   npm test   (= node --test supabase/functions/hent-saker/*.test.ts)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BERGEN_SIDE,
  bergenSideUrl,
  hentBergenSaker,
  mapBergenAgendapunkt,
  nesteBergenStart,
} from "./bergen.ts";

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
  assert.equal(mappet?.motedato, "2026-05-06");
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

test("197 treff hentes over to sider på 150, med pause og stopp", async () => {
  const kall: string[] = [];
  const pauser: number[] = [];
  const utfall = await hentBergenSaker({
    år: 2026,
    pauseMs: 400,
    pause: async (ms) => { pauser.push(ms); },
    hent: async (url) => {
      kall.push(url);
      const start = Number(new URL(url).searchParams.get("start"));
      const rows = Number(new URL(url).searchParams.get("rows"));
      assert.equal(rows, BERGEN_SIDE);
      const antall = start === 0 ? 150 : 47;
      return {
        status: 200,
        tekst: JSON.stringify({
          numTotal: 197,
          items: Array.from({ length: antall }, (_, i) => ({
            ...PUNKT,
            tittel: `Kulturpunkt ${start + i}`,
            kildeId: String(1000 + start + i),
            moteId: String(2000 + start + i),
          })),
        }),
      };
    },
  });
  assert.deepEqual(kall.map((url) => new URL(url).searchParams.get("start")), ["0", "150"]);
  assert.deepEqual(pauser, [400]);
  assert.equal(utfall.feil.length, 0);
  assert.equal(utfall.raattAntall, 197);
  assert.equal(utfall.antallEtterFilter, 197);
  assert.equal(utfall.vellykket, 2);
});

test("neste offset stopper ved numTotal, kort side og gjentatt side", () => {
  assert.equal(nesteBergenStart({ start: 0, mottatt: 150, rows: 150, numTotal: 197, nye: 150 }), 150);
  assert.equal(nesteBergenStart({ start: 150, mottatt: 47, rows: 150, numTotal: 197, nye: 47 }), null);
  assert.equal(nesteBergenStart({ start: 0, mottatt: 150, rows: 150, numTotal: null, nye: 150 }), null);
  assert.equal(nesteBergenStart({ start: 0, mottatt: 150, rows: 150, numTotal: 300, nye: 0 }), null);
  assert.equal(bergenSideUrl(2026, 150).includes("rows=150"), true);
  assert.equal(bergenSideUrl(2026, 0, 500).includes("rows=500"), false);
});

test("feil på side to beholder side en og stopper", async () => {
  let kall = 0;
  const utfall = await hentBergenSaker({
    år: 2026,
    pauseMs: 0,
    hent: async () => {
      kall++;
      if (kall === 1) {
        return {
          status: 200,
          tekst: JSON.stringify({
            numTotal: 197,
            items: Array.from({ length: 150 }, (_, i) => ({
              ...PUNKT,
              tittel: `Kulturbygg ${i}`,
              kildeId: String(i),
              moteId: String(1000 + i),
            })),
          }),
        };
      }
      return { feil: { type: "http", httpStatus: 500, melding: "HTTP 500", url: "side-2" } };
    },
  });
  assert.equal(kall, 2);
  assert.equal(utfall.items.length, 150);
  assert.equal(utfall.feil.length, 1);
  assert.equal(utfall.feil[0]?.httpStatus, 500);
  assert.equal(utfall.vellykket, 1);
});

test("feil på første side gir ingen saker", async () => {
  const utfall = await hentBergenSaker({
    år: 2026,
    pauseMs: 0,
    hent: async () => ({ feil: { type: "timeout", httpStatus: null, melding: "Tidsavbrudd", url: null } }),
  });
  assert.equal(utfall.items.length, 0);
  assert.equal(utfall.vellykket, 0);
  assert.equal(utfall.feil[0]?.type, "timeout");
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
