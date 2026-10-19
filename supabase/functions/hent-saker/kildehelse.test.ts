// Tester for kildehelse: status kan ikke forkles en feil som «tom»,
// og Stortingssesjonen skifter 1. oktober.
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KILDE_STATUSER,
  feilFraStatus,
  feilFraUnntak,
  klassifiserKjøring,
  samleRssSvar,
  stortingsesjon,
  utledKjoertAv,
  type HenteFeilType,
} from "./kildehelse.ts";
import { REGJERINGEN_FEEDS, hentFeeder } from "./regjeringen.ts";

const RSS = (tittel: string, lenke: string) => `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>${tittel}</title>
    <link>${lenke}</link>
    <description>Kulturbudsjettet og museer</description>
  </item>
</channel></rss>`;

function assertLovligStatus(status: string) {
  assert.ok(
    (KILDE_STATUSER as readonly string[]).includes(status),
    `ulovlig status ${status}`,
  );
}

// ─── klassifiserKjøring ───────────────────────────────────────────────────────

test("råtreff og nye innslag er ok_nye", () => {
  const r = klassifiserKjøring({
    raattAntall: 12,
    antallNye: 2,
    feil: [],
    forsok: 1,
    vellykket: 1,
  });
  assert.equal(r.status, "ok_nye");
  assert.equal(r.feilmelding, null);
  assert.equal(r.httpStatus, null);
});

test("Stortinget-fellen: råtreff uten nye er ok_ingen_nye, ikke tom", () => {
  const r = klassifiserKjøring({
    raattAntall: 650,
    antallNye: 0,
    feil: [],
    forsok: 1,
    vellykket: 1,
  });
  assert.equal(r.status, "ok_ingen_nye");
});

test("ekte tom er bare 0 råtreff når kilden svarte OK", () => {
  const r = klassifiserKjøring({
    raattAntall: 0,
    antallNye: 0,
    feil: [],
    forsok: 1,
    vellykket: 1,
  });
  assert.equal(r.status, "tom");
});

test("feil forkledd som tom er umulig", () => {
  const typer: HenteFeilType[] = ["http", "timeout", "parse", "auth", "nett"];
  for (const type of typer) {
    const httpStatus = type === "http" ? 500 : type === "auth" ? 403 : null;
    const r = klassifiserKjøring({
      raattAntall: 0,
      antallNye: 0,
      feil: [{ type, httpStatus, melding: "x", url: "https://kilde.example/feed" }],
      forsok: 1,
      vellykket: 0,
    });
    assert.notEqual(r.status, "tom", type);
    assert.notEqual(r.status, "ok_nye", type);
    assert.notEqual(r.status, "ok_ingen_nye", type);
    assert.equal(r.status, `feil_${type}`);
    assertLovligStatus(r.status);
    if (httpStatus != null) assert.equal(r.httpStatus, httpStatus);
  }
});

test("401 og 403 er feil_auth, andre HTTP-koder er feil_http", () => {
  assert.equal(feilFraStatus(401, "https://x").type, "auth");
  assert.equal(feilFraStatus(403, "https://x").type, "auth");
  assert.equal(feilFraStatus(404, "https://x").type, "http");
  assert.equal(feilFraStatus(500, "https://x").type, "http");
  assert.equal(feilFraStatus(404, "https://x").httpStatus, 404);
});

test("timeout og parse-unntak blir ikke nettverksfeil", () => {
  assert.equal(feilFraUnntak(Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" })).type, "timeout");
  assert.equal(feilFraUnntak(new SyntaxError("Unexpected token < in JSON")).type, "parse");
  assert.equal(feilFraUnntak(new TypeError("fetch failed")).type, "nett");
});

test("delvis slår ok_nye når noen feeder feilet selv om noe ble lagret", () => {
  const r = klassifiserKjøring({
    raattAntall: 400,
    antallNye: 3,
    feil: [{
      type: "http",
      httpStatus: 404,
      melding: "HTTP 404",
      url: "https://www.regjeringen.no/no/dep/kud/rss/",
    }],
    forsok: 5,
    vellykket: 4,
  });
  assert.equal(r.status, "delvis");
  assert.equal(r.httpStatus, 404);
  assert.match(r.feilmelding ?? "", /kud\/rss/);
  assert.match(r.feilmelding ?? "", /404/);
});

test("alle kall feilet er feil, ikke delvis og ikke tom", () => {
  const r = klassifiserKjøring({
    raattAntall: 0,
    antallNye: 0,
    feil: [
      { type: "http", httpStatus: 404, melding: "HTTP 404", url: "https://a" },
      { type: "http", httpStatus: 503, melding: "HTTP 503", url: "https://b" },
    ],
    forsok: 2,
    vellykket: 0,
  });
  assert.equal(r.status, "feil_http");
  assert.equal(r.httpStatus, 404);
  assert.match(r.feilmelding ?? "", /https:\/\/b/);
});

// ─── RSS: én død feed stopper ikke resten ─────────────────────────────────────

test("død KUD-feed er fjernet, statsråd-feeden er med", () => {
  const urls = REGJERINGEN_FEEDS.map((f) => f.url);
  assert.equal(urls.some((u) => u.includes("/dep/kud/rss")), false);
  assert.equal(urls.filter((u) => u.includes("documentType=dokumenter/")).length, 4);
  assert.equal(urls.some((u) => u.includes("offisieltfrastatsr")), true);
  assert.equal(urls.length, 5);
});

test("én feilende feed stopper ikke senere feeder", async () => {
  const feeds = [
    { url: "https://regjeringen.example/horinger", instans: "Høring" },
    { url: "https://www.regjeringen.no/no/dep/kud/rss/", instans: "KUD" },
    { url: "https://regjeringen.example/statsrad", instans: "Statsråd" },
  ];
  let kall = 0;
  const utfall = await hentFeeder(feeds, async (url) => {
    kall++;
    if (url.includes("/dep/kud/rss")) {
      throw new Error("socket hang up");
    }
    if (url.includes("statsrad")) {
      return { status: 404, kropp: "not found" };
    }
    return {
      status: 200,
      kropp: RSS("Høring om kulturloven", "https://regjeringen.example/sak/1"),
    };
  });
  // Alle tre ble forsøkt, også den etter unntaket.
  assert.equal(kall, 3);
  assert.equal(utfall.forsok, 3);
  assert.equal(utfall.vellykket, 1);
  assert.equal(utfall.raattAntall, 1);
  assert.equal(utfall.items[0].instans, "Høring");
  assert.equal(utfall.feil.length, 2);
  assert.equal(utfall.feil[0].type, "nett");
  assert.match(utfall.feil[0].url ?? "", /kud/);
  assert.equal(utfall.feil[1].type, "http");
  assert.equal(utfall.feil[1].httpStatus, 404);

  const klass = klassifiserKjøring({
    raattAntall: utfall.raattAntall,
    antallNye: 1,
    feil: utfall.feil,
    forsok: utfall.forsok,
    vellykket: utfall.vellykket,
  });
  assert.equal(klass.status, "delvis");
  assert.match(klass.feilmelding ?? "", /HTTP 404/);
});

test("HTTP 200 med tom kropp eller HTML er feil_parse, ikke tom", () => {
  const utfall = samleRssSvar([
    { url: "https://a", instans: "A", status: 200, kropp: "   " },
    { url: "https://b", instans: "B", status: 200, kropp: "<html><title>feil</title></html>" },
  ]);
  assert.equal(utfall.vellykket, 0);
  assert.equal(utfall.feil.every((f) => f.type === "parse"), true);
  const klass = klassifiserKjøring({
    raattAntall: utfall.raattAntall,
    antallNye: 0,
    feil: utfall.feil,
    forsok: utfall.forsok,
    vellykket: utfall.vellykket,
  });
  assert.equal(klass.status, "feil_parse");
  assert.notEqual(klass.status, "tom");
});

test("gyldig RSS uten items er tom, ikke feil", () => {
  const utfall = samleRssSvar([
    {
      url: "https://a",
      instans: "A",
      status: 200,
      kropp: `<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>`,
    },
  ]);
  assert.equal(utfall.vellykket, 1);
  assert.equal(utfall.raattAntall, 0);
  const klass = klassifiserKjøring({
    raattAntall: 0,
    antallNye: 0,
    feil: [],
    forsok: 1,
    vellykket: 1,
  });
  assert.equal(klass.status, "tom");
});

test("råttall teller før nøkkelordfilter", () => {
  const utfall = samleRssSvar([
    {
      url: "https://a",
      instans: "A",
      status: 200,
      kropp: `<?xml version="1.0"?><rss version="2.0"><channel><item>
        <title>Nasjonal transportplan</title>
        <link>https://regjeringen.example/sak/2</link>
        <description>Veier og jernbane</description>
      </item></channel></rss>`,
    },
  ]);
  assert.equal(utfall.raattAntall, 1);
  assert.equal(utfall.antallEtterFilter, 0);
  const klass = klassifiserKjøring({
    raattAntall: utfall.raattAntall,
    antallNye: 0,
    feil: [],
    forsok: 1,
    vellykket: 1,
  });
  assert.equal(klass.status, "ok_ingen_nye");
});

// ─── Stortingssesjon ──────────────────────────────────────────────────────────

test("sesjonen skifter ved midnatt UTC 1. oktober", () => {
  assert.equal(stortingsesjon(new Date(Date.UTC(2026, 8, 30, 23, 59, 59))), "2025-2026");
  assert.equal(stortingsesjon(new Date(Date.UTC(2026, 9, 1, 0, 0, 0))), "2026-2027");
  assert.equal(stortingsesjon(new Date(Date.UTC(2026, 9, 19, 12, 0, 0))), "2026-2027");
  assert.equal(stortingsesjon(new Date(Date.UTC(2027, 0, 1, 0, 0, 0))), "2026-2027");
  assert.equal(stortingsesjon(new Date(Date.UTC(2027, 8, 30, 21, 0, 0))), "2026-2027");
  assert.equal(stortingsesjon(new Date(Date.UTC(2027, 9, 1, 0, 0, 0))), "2027-2028");
  assert.equal(stortingsesjon(new Date(Date.UTC(2025, 9, 1, 0, 0, 0))), "2025-2026");
});

// ─── hvem som kjørte ──────────────────────────────────────────────────────────

test("pg_cron-body utlost_av blir supabase_cron", () => {
  assert.equal(utledKjoertAv({ utlostAv: "pg_cron" }), "supabase_cron");
  assert.equal(utledKjoertAv({ utlostAv: "supabase_cron" }), "supabase_cron");
});

test("vercel-merke og manglende merke", () => {
  assert.equal(utledKjoertAv({ utlostAv: "vercel_cron" }), "vercel_cron");
  assert.equal(utledKjoertAv({ vercelCronHeader: "1" }), "vercel_cron");
  assert.equal(utledKjoertAv({}), "manuell");
  assert.equal(utledKjoertAv({ utlostAv: "" }), "manuell");
});
