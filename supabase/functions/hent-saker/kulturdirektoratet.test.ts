// Tester for Kulturdirektoratet-adapteren (CSV-parsing + runde-aggregering).
//   npm test   (= node --test supabase/functions/hent-saker/*.test.ts)

import { test } from "node:test";
import assert from "node:assert/strict";
import { grupperTildelinger, parseVedtakCsv } from "./kulturdirektoratet.ts";

// ─── parseVedtakCsv ───────────────────────────────────────────────────────────

test("semikolon-CSV med BOM og header parses til objekter", () => {
  const csv = "\uFEFFa;b;c\n1;2;3\n4;5;6\n";
  assert.deepEqual(parseVedtakCsv(csv), [
    { a: "1", b: "2", c: "3" },
    { a: "4", b: "5", c: "6" },
  ]);
});

test("siterte felt kan inneholde semikolon, «\"\"»-escape og linjeskift", () => {
  const csv = 'tittel;vedtak\n"Rural Tapes - ""Plate 5""";Avslått\n"linje1\nlinje2; med semikolon";Innvilget\n';
  const rader = parseVedtakCsv(csv);
  assert.equal(rader[0].tittel, 'Rural Tapes - "Plate 5"');
  assert.equal(rader[1].tittel, "linje1\nlinje2; med semikolon");
  assert.equal(rader[1].vedtak, "Innvilget");
});

test("tom CSV og bare header gir tom liste", () => {
  assert.deepEqual(parseVedtakCsv(""), []);
  assert.deepEqual(parseVedtakCsv("a;b;c\n"), []);
});

test("CRLF-linjeskift håndteres", () => {
  assert.deepEqual(parseVedtakCsv("a;b\r\n1;2\r\n"), [{ a: "1", b: "2" }]);
});

test("beholdRad-forfilter dropper rader billig, men aldri headeren", () => {
  const csv = "tittel;vedtak\nA;Innvilget\nB;Avslått\n\"C\nmed Innvilget i sitat\";Avslått\n";
  const rader = parseVedtakCsv(csv, (l) => l.includes("Innvilget"));
  // B ryker på forfilteret; C slipper gjennom (permissivt) og har hele
  // flerlinje-feltet intakt — grupperTildelinger luker den ut på vedtak-feltet.
  assert.equal(rader.length, 2);
  assert.equal(rader[0].tittel, "A");
  assert.equal(rader[1].tittel, "C\nmed Innvilget i sitat");
  assert.equal(rader[1].vedtak, "Avslått");
});

// ─── grupperTildelinger ───────────────────────────────────────────────────────

const NÅ = new Date("2026-07-25T12:00:00Z").getTime();

const rad = (over: Record<string, string>) => ({
  ordning_kode: "FLB-AUDIO",
  soknadsfrist: "2026-02-20",
  tiltak_tittel: "Prosjekt",
  soknad_vedtak: "Innvilget",
  soker_navn: "Søker",
  hovedfinansieringskilde: "Fond for lyd og bilde",
  verdi_type: "Beløp",
  bevilgningsaar: "2026",
  verdi_innvilget: "100000",
  ...over,
});

test("innvilgede vedtak aggregeres til én varsel per runde med sum og antall", () => {
  const items = grupperTildelinger(
    [
      rad({ tiltak_tittel: "Konsertturné", verdi_innvilget: "250000" }),
      rad({ tiltak_tittel: "Plateinnspilling", verdi_innvilget: "110000" }),
      rad({ soknad_vedtak: "Avslått", verdi_innvilget: "" }),
    ],
    NÅ,
  );
  assert.equal(items.length, 1);
  const [item] = items;
  assert.match(item.tittel, /Fond for lyd og bilde — 2 søknader innvilget/);
  assert.match(item.sammendrag_raa, /til sammen 360 000 kr/);
  assert.match(item.sammendrag_raa, /Konsertturné \(250 000 kr\)/);
  assert.equal(item.kilde, "https://www.kulturdirektoratet.no/vedtak#FLB-AUDIO-2026-02-20");
  assert.equal(item.kilde_id, "kulturdirektoratet-FLB-AUDIO-2026-02-20");
  assert.equal(item.sakstype, "tildeling");
  assert.equal(item.forhåndsgodkjent, true);
  assert.equal(item.frist, null); // søknadsfristen er passert — ikke en brukerfrist
});

test("ulike runder (ordning eller frist) blir separate varsler", () => {
  const items = grupperTildelinger(
    [
      rad({}),
      rad({ ordning_kode: "NKF-ARM", hovedfinansieringskilde: "Kulturrådet" }),
      rad({ soknadsfrist: "2026-04-08" }),
    ],
    NÅ,
  );
  assert.equal(items.length, 3);
});

test("gamle runder (frist eldre enn ~6 mnd) holdes utenfor", () => {
  const items = grupperTildelinger(
    [rad({ soknadsfrist: "2025-09-03" }), rad({ soknadsfrist: "2024-10-15" })],
    NÅ,
  );
  assert.deepEqual(items, []);
});

test("rader uten gyldig frist eller ordning hopper over uten krasj", () => {
  const items = grupperTildelinger(
    [rad({ soknadsfrist: "" }), rad({ soknadsfrist: "løpende" }), rad({ ordning_kode: "" })],
    NÅ,
  );
  assert.deepEqual(items, []);
});

test("stipend uten kronebeløp telles, men gir ingen sum-tekst", () => {
  const items = grupperTildelinger(
    [rad({ verdi_type: "Måneder", verdi_innvilget: "12" })],
    NÅ,
  );
  assert.equal(items.length, 1);
  assert.match(items[0].tittel, /1 søknader innvilget/);
  assert.doesNotMatch(items[0].sammendrag_raa, /til sammen/);
});
