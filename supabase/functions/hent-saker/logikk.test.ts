// Tester for hent-saker-logikken. Kjøres med Node sin innebygde testkjører:
//   npm test   (= node --test supabase/functions/hent-saker/logikk.test.ts)
// Kjøres også automatisk i GitHub Actions på hver push (.github/workflows/ci.yml).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  erKulturRelevant,
  statusFraFrist,
  parseRssItems,
} from "./logikk.ts";

// ─── erKulturRelevant ─────────────────────────────────────────────────────────

test("kultursak fanges opp", () => {
  assert.equal(erKulturRelevant("Endringer i kulturloven"), true);
  assert.equal(erKulturRelevant("Ny tilskuddsordning for scenekunst"), true);
});

test("ikke-kultursak avvises", () => {
  assert.equal(erKulturRelevant("Nasjonal transportplan 2026-2037"), false);
  assert.equal(erKulturRelevant("Endringer i skatteloven"), false);
});

test("negativ liste overstyrer positiv treff (komité-fellen)", () => {
  // «Familie- og kulturkomiteen» inneholder «kultur», men saken handler om beredskap
  assert.equal(
    erKulturRelevant(
      "Familie- og kulturkomiteen behandler ny beredskapsavtale for redningshelikopter",
    ),
    false,
  );
});

test("store bokstaver spiller ingen rolle", () => {
  assert.equal(erKulturRelevant("KULTURSKOLENS FRAMTID"), true);
});

test("relevans kan komme fra sammendraget, ikke bare tittelen", () => {
  assert.equal(
    erKulturRelevant(
      "Prop. 44 S",
      "Bevilgningsendringer for museer og bibliotek",
    ),
    true,
  );
});

// ─── statusFraFrist ───────────────────────────────────────────────────────────

const NÅ = new Date("2026-07-23T12:00:00Z").getTime();
const omDager = (d: number) =>
  new Date(NÅ + d * 86400000).toISOString().split("T")[0];

test("frist om ≤7 dager er kritisk", () => {
  assert.equal(statusFraFrist(omDager(3), NÅ), "kritisk");
  assert.equal(statusFraFrist(omDager(7), NÅ), "kritisk");
});

test("frist om 8-21 dager er viktig", () => {
  assert.equal(statusFraFrist(omDager(8), NÅ), "viktig");
  assert.equal(statusFraFrist(omDager(21), NÅ), "viktig");
});

test("frist langt frem er normal", () => {
  assert.equal(statusFraFrist(omDager(60), NÅ), "normal");
});

test("utløpt frist er normal (ikke kritisk)", () => {
  assert.equal(statusFraFrist(omDager(-5), NÅ), "normal");
});

test("manglende frist er normal", () => {
  assert.equal(statusFraFrist(null, NÅ), "normal");
});

test("ugyldig dato krasjer ikke, blir normal", () => {
  assert.equal(statusFraFrist("ikke-en-dato", NÅ), "normal");
});

// ─── parseRssItems ────────────────────────────────────────────────────────────

const EKSEMPEL_RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
  <title>Kulturdepartementet</title>
  <item>
    <title><![CDATA[Høring: endringer i kulturlova]]></title>
    <link>https://www.regjeringen.no/no/dokumenter/horing-kulturlova/id1/</link>
    <description><![CDATA[<p>Departementet sender med dette <b>forslag</b> på høring.</p>]]></description>
    <pubDate>Mon, 20 Jul 2026 08:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Vanlig tittel uten CDATA</title>
    <link>https://www.regjeringen.no/no/aktuelt/sak2/id2/</link>
    <description>Kort beskrivelse</description>
  </item>
  <item>
    <title>Mangler lenke og skal hoppes over</title>
    <description>Denne skal ikke med</description>
  </item>
</channel></rss>`;

test("parser CDATA- og vanlige titler, hopper over items uten lenke", () => {
  const items = parseRssItems(EKSEMPEL_RSS, "Kulturdepartementet");
  assert.equal(items.length, 2);
  assert.equal(items[0].tittel, "Høring: endringer i kulturlova");
  assert.equal(items[1].tittel, "Vanlig tittel uten CDATA");
});

test("html strippes fra beskrivelse", () => {
  const items = parseRssItems(EKSEMPEL_RSS, "Kulturdepartementet");
  assert.equal(
    items[0].sammendrag_raa,
    "Departementet sender med dette forslag på høring.",
  );
});

test("pubDate blir ISO-dato, manglende pubDate blir null", () => {
  const items = parseRssItems(EKSEMPEL_RSS, "Kulturdepartementet");
  assert.equal(items[0].publisert_dato, "2026-07-20");
  assert.equal(items[1].publisert_dato, null);
});

test("kilde_id og instans settes riktig", () => {
  const items = parseRssItems(EKSEMPEL_RSS, "Kulturdepartementet");
  assert.equal(
    items[0].kilde_id,
    "rss-https://www.regjeringen.no/no/dokumenter/horing-kulturlova/id1/",
  );
  assert.equal(items[0].instans, "Kulturdepartementet");
});

test("tomt/ugyldig RSS gir tom liste, ikke krasj", () => {
  assert.deepEqual(parseRssItems("", "X"), []);
  assert.deepEqual(parseRssItems("<html>404 not found</html>", "X"), []);
});
