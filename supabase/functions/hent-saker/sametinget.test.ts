// Tester for Sametinget-adapteren (RSS-mapping med tildelingsdeteksjon).
//   npm test   (= node --test supabase/functions/hent-saker/*.test.ts)

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRssItems } from "./logikk.ts";
import { mapSametingetItem } from "./sametinget.ts";

// Utsnitt av den verifiserte feeden (juli 2026) — titler/lenker uten CDATA
const FEED = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
  <title>Aktuelt</title>
  <item>
    <title>Innvilgede saker  06.07.26-12.07.26</title>
    <link>https://sametinget.no/aktuelt/innvilgede-saker-06-07-26-12-07-26.52208.aspx</link>
    <description>Tilskuddsbevilgninger i perioden 06.07.26-12.07.26, vedtatt av sametingsrådet.</description>
    <guid isPermaLink="false">aid6865</guid>
    <pubDate>Mon, 13 Jul 2026 12:38:14 GMT</pubDate>
  </item>
  <item>
    <title>Mottatt og behandlet BDOs rapport</title>
    <link>https://sametinget.no/aktuelt/mottatt-og-behandlet-bdos-rapport.52192.aspx</link>
    <description>BDO-rapporten finner ikke brudd på regelverk i varslingssak.</description>
    <pubDate>Wed, 08 Jul 2026 07:00:22 GMT</pubDate>
  </item>
</channel></rss>`;

const items = parseRssItems(FEED, "Sametinget").map(mapSametingetItem);

test("ukentlig tildelingsliste får sakstype tildeling", () => {
  assert.equal(items[0].sakstype, "tildeling");
  assert.equal(items[0].instans, "Sametinget");
  assert.equal(
    items[0].kilde,
    "https://sametinget.no/aktuelt/innvilgede-saker-06-07-26-12-07-26.52208.aspx",
  );
  assert.equal(items[0].kilde_id, `sametinget-${items[0].kilde}`);
  assert.equal(items[0].publisert_dato, "2026-07-13");
});

test("øvrige nyheter får ikke sakstype, men går til Claude-vurdering", () => {
  assert.equal(items[1].sakstype, null);
  // Forhåndsgodkjent = hopper over nøkkelordfilteret (tildelingslistene mangler
  // kulturord i tittelen) — Claude avviser i stedet det som ikke er kultur.
  assert.equal(items[0].forhåndsgodkjent, true);
  assert.equal(items[1].forhåndsgodkjent, true);
});

test("tildeling gjenkjennes også fra beskrivelsen alene", () => {
  const [item] = parseRssItems(
    `<rss><channel><item>
      <title>Over 1,2 millioner til samisk kunst</title>
      <link>https://sametinget.no/aktuelt/x.aspx</link>
      <description>Sametinget har tildelt midler til kunstprosjekter.</description>
    </item></channel></rss>`,
    "Sametinget",
  ).map(mapSametingetItem);
  assert.equal(item.sakstype, "tildeling");
});
