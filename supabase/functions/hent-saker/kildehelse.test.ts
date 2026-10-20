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
  lesSakerListe,
  samleRssSvar,
  sesjonIdStemmer,
  slåSammenAdapterdeler,
  stortingsesjon,
  tidligAvslag,
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
  assert.match(r.feilmelding ?? "", /HTTP 404/);
  assert.doesNotMatch(r.feilmelding ?? "", /https?:\/\//);
  assert.doesNotMatch(r.feilmelding ?? "", /kud\/rss/);
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
  assert.match(r.feilmelding ?? "", /HTTP 404/);
  assert.match(r.feilmelding ?? "", /HTTP 503/);
  assert.doesNotMatch(r.feilmelding ?? "", /https?:\/\//);
});

// ─── RSS: én død feed stopper ikke resten ─────────────────────────────────────

test("død KUD-feed er fjernet, statsråd og KUD-tillegg er med", () => {
  const urls = REGJERINGEN_FEEDS.map((f) => f.url);
  assert.equal(urls.some((u) => u.includes("/dep/kud/rss")), false);
  assert.equal(urls.filter((u) => u.includes("documentType=dokumenter/")).length, 5);
  assert.equal(urls.some((u) => u.includes("offisieltfrastatsr")), true);
  assert.equal(urls.some((u) => u.includes("aktuelt/nyheter") && u.includes("owner=545")), true);
  assert.equal(urls.some((u) => u.includes("dokumenter/h") && u.includes("owner=545")), true);
  assert.equal(urls.some((u) => u.includes("loverogregler/retningslinjer") && u.includes("owner=545")), true);
  assert.equal(urls.some((u) => u.includes("topic=931/1437") && u.includes("owner=545")), true);
  assert.equal(REGJERINGEN_FEEDS.filter((f) => f.vindu).length, 4);
  assert.equal(urls.length, 9);
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
  assert.doesNotMatch(klass.feilmelding ?? "", /https?:\/\//);
  assert.doesNotMatch(klass.feilmelding ?? "", /kud/);
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

test("feilmelding til kjøringloggen har verken URL eller rå svartekst", () => {
  const r = klassifiserKjøring({
    raattAntall: 0,
    antallNye: 0,
    feil: [
      feilFraUnntak(
        new Error("connect ECONNREFUSED https://api.einnsyn.no/search?query=kultur"),
        "https://api.einnsyn.no/search?query=kultur",
      ),
      {
        type: "parse",
        httpStatus: 200,
        melding: "Unexpected token < in JSON at https://data.stortinget.no/eksport/saker",
        url: "https://data.stortinget.no/eksport/saker",
      },
    ],
    forsok: 2,
    vellykket: 0,
  });
  assert.equal(r.status, "feil_nett");
  assert.match(r.feilmelding ?? "", /Innhentingen feilet/);
  assert.match(r.feilmelding ?? "", /Uventet format/);
  assert.doesNotMatch(r.feilmelding ?? "", /https?:\/\//);
  assert.doesNotMatch(r.feilmelding ?? "", /einnsyn|stortinget/i);
});

test("to stortingssesjoner: én feil er delvis, og treff fra den andre beholdes", () => {
  const utfall = slåSammenAdapterdeler([
    { items: [{ id: 1 }], raattAntall: 100, antallEtterFilter: 4, feil: null, httpStatus: 200 },
    {
      items: [],
      raattAntall: 0,
      antallEtterFilter: 0,
      feil: feilFraStatus(500, "https://data.stortinget.no/eksport/saker?sesjonid=2024-2025"),
      httpStatus: 500,
    },
  ]);
  assert.equal(utfall.forsok, 2);
  assert.equal(utfall.vellykket, 1);
  assert.equal(utfall.items.length, 1);
  assert.equal(utfall.raattAntall, 100);
  const klass = klassifiserKjøring({
    raattAntall: utfall.raattAntall,
    antallNye: 1,
    feil: utfall.feil,
    forsok: utfall.forsok,
    vellykket: utfall.vellykket,
  });
  assert.equal(klass.status, "delvis");
  assert.match(klass.feilmelding ?? "", /HTTP 500/);
  assert.doesNotMatch(klass.feilmelding ?? "", /https?:\/\//);
});

test("x-cron-secret sjekkes før metode: mangler, feil og helsesjekk", () => {
  const mangler = tidligAvslag("GET", undefined, "hva-som-helst");
  assert.equal(mangler?.status, 503);
  assert.equal(mangler?.kind, "json");

  const feil = tidligAvslag("GET", "hemmelig", "feil");
  assert.equal(feil?.status, 401);
  if (feil?.kind === "json") assert.equal(feil.body.feil, "Uautorisert");

  const tom = tidligAvslag("POST", "", null);
  assert.equal(tom?.status, 503);

  const get = tidligAvslag("GET", "hemmelig", "hemmelig");
  assert.equal(get?.status, 200);
  if (get?.kind === "json") assert.equal(get.body.status, "ok");

  const annet = tidligAvslag("PUT", "hemmelig", "hemmelig");
  assert.equal(annet?.status, 405);
  assert.equal(annet?.kind, "tekst");

  assert.equal(tidligAvslag("POST", "hemmelig", "hemmelig"), null);
});

test("vellykket kall beholder http-status, også når ingenting er nytt", () => {
  const nye = klassifiserKjøring({
    raattAntall: 854,
    antallNye: 2,
    feil: [],
    forsok: 2,
    vellykket: 2,
    httpStatus: 200,
  });
  assert.equal(nye.status, "ok_nye");
  assert.equal(nye.httpStatus, 200);
  assert.equal(nye.feilmelding, null);

  const ingen = klassifiserKjøring({
    raattAntall: 854,
    antallNye: 0,
    feil: [],
    forsok: 2,
    vellykket: 2,
    httpStatus: 200,
  });
  assert.equal(ingen.status, "ok_ingen_nye");
  assert.equal(ingen.httpStatus, 200);
});

test("0 rå fra en kilde som normalt har treff er feil_tomt_svar, ikke ok_ingen_nye", () => {
  const r = klassifiserKjøring({
    raattAntall: 0,
    antallNye: 0,
    feil: [],
    forsok: 2,
    vellykket: 2,
    httpStatus: 200,
    forventerTreff: true,
  });
  assert.equal(r.status, "feil_tomt_svar");
  assert.notEqual(r.status, "ok_ingen_nye");
  assert.notEqual(r.status, "tom");
  assert.equal(r.httpStatus, 200);
  assert.equal(r.feilmelding, "Kilden svarte uten treff");
  assertLovligStatus(r.status);
});

test("0 rå uten forventet treff forblir tom, med http-status", () => {
  const r = klassifiserKjøring({
    raattAntall: 0,
    antallNye: 0,
    feil: [],
    forsok: 1,
    vellykket: 1,
    httpStatus: 200,
  });
  assert.equal(r.status, "tom");
  assert.equal(r.httpStatus, 200);
  assert.equal(r.feilmelding, null);
});

test("Stortinget-liste: array, omslag og feil sesjon", () => {
  const flat = lesSakerListe({ sesjon_id: "2025-2026", saker_liste: [{ id: 1 }, { id: 2 }] });
  assert.ok(!("feil" in flat));
  if (!("feil" in flat)) assert.equal(flat.saker.length, 2);

  const omslag = lesSakerListe({ saker_liste: { sak: [{ id: 9 }] } });
  assert.ok(!("feil" in omslag));
  if (!("feil" in omslag)) assert.equal(omslag.saker[0].id, 9);

  const en = lesSakerListe({ saker_liste: { sak: { id: 3 } } });
  assert.ok(!("feil" in en));
  if (!("feil" in en)) assert.equal(en.saker.length, 1);

  assert.deepEqual(lesSakerListe({ saker_liste: [] }), { saker: [] });
  assert.ok("feil" in lesSakerListe({}));
  assert.ok("feil" in lesSakerListe(null));

  assert.equal(sesjonIdStemmer({ sesjon_id: "2025-2026" }, "2025-2026"), true);
  assert.equal(sesjonIdStemmer({ sesjon_id: "2026-2027" }, "2025-2026"), false);
  assert.equal(sesjonIdStemmer({ saker_liste: [] }, "2025-2026"), true);
});

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
