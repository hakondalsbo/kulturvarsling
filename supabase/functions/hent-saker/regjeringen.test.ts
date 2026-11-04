// Regjeringen.no: kall skal treffe robots.txt (hentet 2026-11-04).
// Reglene er Disallow-linjene for User-agent: *. Det finnes ingen Allow.
// Matching følger RFC 9309 / Google: stien inkluderer query, * er vilkårlig
// tekst, $ er slutt, og sammenligningen skiller store og små bokstaver.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { backfillFeeds } from "./backfill.ts";
import { ekstraFristside, type RssItem } from "./logikk.ts";
import { parseOgBerik, REGJERINGEN_FEEDS } from "./regjeringen.ts";

const DISALLOW = [
  "/*/?documenttype",
  "/*/?topic",
  "/*/?ownerid",
  "/*/?from",
  "/*/?to",
  "/*/?government",
  "/*/?utid",
  "/*/?sesjon",
  "/*/?type",
  "/*/?law",
  "/*/?county",
  "/*/?term",
  "/*/?sortby",
  "/*/?sort",
  "/*/?expand",
  "/*/?querystring",
  "/*/?isfilteropen",
  "/*/?pageRef",
  "/*/?reg_oss",
  "/*/?tema",
  "/*/?q",
  "/*/?bq",
  "/*/?uid",
  "/*/?docid",
  "/*/?personid",
  "/*/?eventId",
  "/*.xhtml$",
  "/contentassets/*.xml$",
  "/globalassets/upload/*.xml$",
  "/globalassets/departementene/*.xml$",
  "/*/?cedit",
  "/*&cedit",
  "/Utilities/RSSEngine/*",
  "/*/?consterm",
  "/api/*",
  "/no/api/*",
  "/nb/api/*",
  "/nn/api/*",
  "/se/api/*",
  "/en/api/*",
  "/no/dokumentarkiv/*",
  "/en/historical-archive/*",
  "/se/dokumeantavuorka/*",
];

function robotMonster(monster: string): RegExp {
  const slutt = monster.endsWith("$");
  const rå = slutt ? monster.slice(0, -1) : monster;
  const deler = rå.split("*").map((d) => d.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp("^" + deler.join(".*") + (slutt ? "$" : ""));
}

export function regjeringenRobotsStengt(url: string): string | null {
  const u = new URL(url);
  const sti = u.pathname + u.search;
  for (const monster of DISALLOW) {
    if (robotMonster(monster).test(sti)) return monster;
  }
  return null;
}

const TILLATT_PARAM = new Set(["documentType", "owner", "from", "to"]);

function konfigurerteUrler(): string[] {
  return [
    ...REGJERINGEN_FEEDS.map((f) => f.url),
    ...backfillFeeds().map((f) => f.url),
    ekstraFristside(
      "Retningslinjer - Tilskudd fra Kultur- og likestillingsdepartementet til nasjonale kulturbygg for 2028",
    )!,
  ];
}

test("robots.txt stenger listesiden og topic-feeden, og slipper documentType", () => {
  assert.equal(
    regjeringenRobotsStengt(
      "https://www.regjeringen.no/no/dokument/id2000006/?documenttype=dokumenter/h%C3%B8ringer&ownerid=545&sortby=1&page=1",
    ),
    "/*/?documenttype",
  );
  assert.equal(
    regjeringenRobotsStengt(
      "https://www.regjeringen.no/no/dokument/id2000006/?documenttype=dokumenter/h%C3%B8ringer&page=2",
    ),
    "/*/?documenttype",
  );
  assert.equal(
    regjeringenRobotsStengt("https://www.regjeringen.no/no/rss/Rss/2581966/?topic=931/1437&owner=545"),
    "/*/?topic",
  );
  assert.equal(
    regjeringenRobotsStengt("https://www.regjeringen.no/no/rss/Rss/2581966/?from=29.09.2026"),
    "/*/?from",
  );
  assert.equal(
    regjeringenRobotsStengt("https://www.regjeringen.no/no/rss/Rss/2581966/?documenttype=dokumenter/horinger"),
    "/*/?documenttype",
  );
  assert.equal(
    regjeringenRobotsStengt(
      "https://www.regjeringen.no/no/rss/Rss/2581966/?documentType=dokumenter/h%C3%B8ringer",
    ),
    null,
  );
  assert.equal(
    regjeringenRobotsStengt("https://www.regjeringen.no/no/dokumenter/horing-nrk/id3157800/"),
    null,
  );
});

test("konfigurerte regjeringen-URL-er er tillatt, og topic-feeden er borte", () => {
  const urls = konfigurerteUrler();
  assert.equal(urls.some((u) => /[?&]topic=/.test(u)), false);
  assert.equal(urls.some((u) => u.includes("documenttype=")), false);
  assert.equal(urls.some((u) => u.includes("id2000006")), false);
  for (const url of urls) {
    assert.equal(regjeringenRobotsStengt(url), null, url);
    const params = new URL(url).searchParams;
    for (const key of params.keys()) {
      assert.equal(TILLATT_PARAM.has(key), true, `${key} i ${url}`);
    }
    if (url.includes("/rss/Rss/")) assert.equal(params.get("documentType") != null, true);
  }
  const backfill = backfillFeeds().map((f) => f.url);
  assert.equal(backfill.length, 3);
  for (const url of backfill) {
    assert.match(url, /&from=/);
    assert.match(url, /&to=/);
    assert.doesNotMatch(url, /\?from=/);
    assert.doesNotMatch(url, /\?to=/);
  }
});

function item(over: Partial<RssItem> & Pick<RssItem, "tittel" | "kilde">): RssItem {
  return {
    instans: "Regjeringen – høring",
    frist: null,
    sammendrag_raa: "Kultur",
    kilde_id: "regjeringen-rss",
    publisert_dato: "2026-10-01",
    ...over,
  };
}

test("høringsfrist hentes fra detaljsiden, uten query og uten dokumentlisten", async () => {
  const kalt: string[] = [];
  const [ut] = await parseOgBerik([
    item({
      tittel: "Høring om kulturloven",
      kilde: "https://www.regjeringen.no/no/dokumenter/horing-kulturloven/id123/?utm_source=rss",
    }),
    item({
      tittel: "Høring som allerede har frist",
      kilde: "https://www.regjeringen.no/no/dokumenter/horing-annen/id456/",
      frist: "2026-12-01",
    }),
  ], async (url) => {
    kalt.push(url);
    return `<div class="horing-meta"><p>Høringsfrist: 12.11.2026</p></div>`;
  });
  assert.deepEqual(kalt, [
    "https://www.regjeringen.no/no/dokumenter/horing-kulturloven/id123/",
  ]);
  assert.equal(ut.frist, "2026-11-12");
  for (const url of kalt) assert.equal(regjeringenRobotsStengt(url), null, url);
});

test("kulturbygg uten frist i dokumentet hentes fra tilskuddssiden", async () => {
  const kalt: string[] = [];
  const [ut] = await parseOgBerik([
    item({
      tittel: "Retningslinjer - Tilskudd fra Kultur- og likestillingsdepartementet til nasjonale kulturbygg for 2028",
      kilde: "https://www.regjeringen.no/no/dokumenter/retningslinjer/id99/?utm_source=rss",
      instans: "KUD – tilskudd",
    }),
  ], async (url) => {
    kalt.push(url);
    if (url.includes("/dep/kud/tilskudd/")) {
      return "Frist for søknad om investeringstilskudd over statsbudsjettet for 2027 er 1. januar 2026. Merk at søknadsfristen for søknader til statsbudsjettet for 2028 er flyttet fram en måned, slik at fristen er 1. desember 2026.";
    }
    return "<p>PDF uten merket frist.</p>";
  });
  assert.deepEqual(kalt, [
    "https://www.regjeringen.no/no/dokumenter/retningslinjer/id99/",
    "https://www.regjeringen.no/no/dep/kud/tilskudd/tilskudd-til-nasjonale-kulturbygg-og-tus/id86015/",
  ]);
  assert.equal(ut.frist, "2026-12-01");
  for (const url of kalt) assert.equal(regjeringenRobotsStengt(url), null, url);
});

function produksjonsfiler(rot: string): string[] {
  const ut: string[] = [];
  for (const navn of readdirSync(rot)) {
    const sti = join(rot, navn);
    if (statSync(sti).isDirectory()) ut.push(...produksjonsfiler(sti));
    else if (sti.endsWith(".ts") && !sti.endsWith(".test.ts")) ut.push(sti);
  }
  return ut;
}

test("edge functions kaller ikke forbudte regjeringen-URL-er", () => {
  const rot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const funnet: string[] = [];
  const monster = /documenttype|id2000006|[?&]topic=|ownerid/;
  for (const fil of produksjonsfiler(rot)) {
    const kilde = readFileSync(fil, "utf8");
    if (monster.test(kilde)) funnet.push(fil);
  }
  assert.deepEqual(funnet, []);
});
