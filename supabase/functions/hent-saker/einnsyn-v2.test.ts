import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { klassifiserKjøring, sanitertFeilmelding } from "./kildehelse.ts";
import { EINNSYN_V1_MAKS_GEO, EINNSYN_V1_SOK, hentEInnsynKultursaker } from "./einnsyn.ts";
import { EINNSYN_USER_AGENT } from "./einnsyn.ts";
import {
  EINNSYN_SPEC_FIL,
  EINNSYN_V2_BOLK_TIDSGRENSE_MS,
  EINNSYN_V2_BOLKER,
  EINNSYN_V2_LIMIT,
  EINNSYN_V2_UTEN_ENHET,
  EINNSYN_V2_UTEN_MOETESAK,
  EINNSYN_V2_MAKS_FORSOK,
  EINNSYN_V2_MAKS_KALL,
  EINNSYN_V2_SOKEORD,
  avbruddsKjoringRad,
  einnsynRotering,
  einnsynSokUrl,
  einnsynV2ErPa,
  einnsynValg,
  einnsynV2Aktiv,
  erEinnsynV2Organ,
  erKulturutvalg,
  forventetEinnsynV2BolkKall,
  forventetEinnsynV2Kall,
  hentEInnsynV2,
  lesBolk,
  lesEinnsynV2FraDb,
  lesKildeutvalg,
  moetedatoFra,
  organerIBolk,
  roteringssteg,
  tryggEinnsynUrl,
  validerEinnsynListe,
  v2ForhandsGodkjent,
  ventetidMs,
} from "./einnsyn-v2.ts";
import {
  EINNSYN_SPEC_LEST_SHA,
  EINNSYN_SPEC_UTDRAG_SHA256,
  SpecParseFeil,
  hentSpecUtdrag,
  specUtdragSha256,
} from "./einnsyn-spec.ts";
import { KULTURVARSLING_USER_AGENT } from "./einnsyn.ts";

test("flagget er av med mindre verdien er nøyaktig true", () => {
  assert.equal(einnsynV2Aktiv(() => undefined), false);
  assert.equal(einnsynV2Aktiv(() => ""), false);
  assert.equal(einnsynV2Aktiv(() => "false"), false);
  assert.equal(einnsynV2Aktiv(() => "TRUE"), false);
  assert.equal(einnsynV2Aktiv(() => "1"), false);
  assert.equal(einnsynV2Aktiv(() => " true"), false);
  assert.equal(einnsynV2Aktiv(() => "true"), true);
  assert.equal(einnsynV2Aktiv(), false);
});

test("forventet kall med flagget på er 478 eInnsyn-kall ved 43 enheter", () => {
  const tall = forventetEinnsynV2Kall();
  assert.equal(EINNSYN_V2_SOKEORD.length, 10);
  assert.deepEqual(tall, { oppdagelse: 5, sok: 430, kulturUtvalg: 0, geo: 43, brreg: 86, totalt: 478 });
  assert.equal(EINNSYN_V2_LIMIT <= 100, true);
  assert.equal(EINNSYN_V2_MAKS_KALL >= tall.totalt, true);
  assert.equal(EINNSYN_V2_MAKS_KALL, 600);
  const bolk = forventetEinnsynV2BolkKall();
  assert.equal(bolk.bolker, 8);
  assert.equal(bolk.enheter, 5);
  assert.deepEqual(
    { oppdagelse: bolk.oppdagelse, sok: bolk.sok, geo: bolk.geo, einnsyn: bolk.einnsyn },
    { oppdagelse: 5, sok: 50, geo: 5, einnsyn: 60 },
  );
  assert.equal(bolk.brreg, 10);
  assert.equal(bolk.varighetMs, 82_150);
  assert.equal(bolk.varighetMs < 90_000, true);
  assert.equal(bolk.varighetMs < EINNSYN_V2_BOLK_TIDSGRENSE_MS, true);
  assert.equal(bolk.dekket, 40);
  assert.equal(bolk.utsatt, 3);
  assert.equal(bolk.nattKall, 480);
  assert.equal(bolk.nattKall < EINNSYN_V2_MAKS_KALL, true);
  assert.equal(bolk.claude, 3);
  assert.equal(bolk.klartekst, 1);
});

test("v1-søket og geo-taket er uendret", async () => {
  assert.equal(
    EINNSYN_V1_SOK,
    "https://api.einnsyn.no/search?query=kultur&entity=Moetesak&sortBy=publisertDato&sortOrder=desc&limit=50",
  );
  const kall: string[] = [];
  const items = Array.from({ length: 30 }, (_, i) => ({
    id: `ms_${i}`,
    offentligTittel: `Kultursak ${i}`,
    journalenhet: `enh_${i}`,
  }));
  await hentEInnsynKultursaker({
    hent: async (url) => {
      kall.push(String(url));
      if (String(url) === EINNSYN_V1_SOK) {
        return svar({ items });
      }
      return svar({ navn: "Stavanger kommune" });
    },
  });
  assert.equal(kall.filter((url) => url === EINNSYN_V1_SOK).length, 1);
  assert.equal(kall.filter((url) => url.includes("/enhet/")).length, EINNSYN_V1_MAKS_GEO);
  assert.equal(kall.some((url) => url.includes("administrativEnhet")), false);
});

test("organlisten er de 16 kommunene, fem fylkene og Oslos bydeler", () => {
  assert.equal(erEinnsynV2Organ("Stavanger kommune"), true);
  assert.equal(erEinnsynV2Organ("Bydel Gamle Oslo"), true);
  assert.equal(erEinnsynV2Organ("Bystyrets sekretariat"), true);
  assert.equal(erEinnsynV2Organ("Oslo byrådsavdeling for kultur"), true);
  assert.equal(erEinnsynV2Organ("Akershus fylkesting"), true);
  assert.equal(erEinnsynV2Organ("Agder fylkeskommune"), true);
  assert.equal(erEinnsynV2Organ("Komité for kultur, Akershus"), true);
  assert.equal(erEinnsynV2Organ("Viken fylkeskommune"), false);
  assert.equal(erEinnsynV2Organ("Bergen kommune"), false);
  assert.equal(erEinnsynV2Organ("Trondheim kommune"), false);
  assert.equal(erEinnsynV2Organ("Oslo universitetssykehus"), false);
  assert.equal(EINNSYN_V2_UTEN_MOETESAK.length, 2);
  assert.equal(EINNSYN_V2_UTEN_ENHET.length, 7);
  for (const rad of [...EINNSYN_V2_UTEN_MOETESAK, ...EINNSYN_V2_UTEN_ENHET]) {
    assert.equal(erEinnsynV2Organ(rad.navn), false, rad.navn);
  }
  assert.deepEqual(
    EINNSYN_V2_UTEN_MOETESAK.map((rad) => rad.id),
    [
      "enh_01j73r5z2efh5bzzqmvbyhrzbx",
      "enh_01m3bm2drre0pv7tbj70wpb3wc",
    ],
  );
  assert.deepEqual(
    EINNSYN_V2_UTEN_ENHET.map((rad) => rad.orgnummer),
    [
      "820852982",
      "921234554",
      "935478715",
      "820710592",
      "942110464",
      "940101808",
      "971045698",
    ],
  );
  assert.equal(EINNSYN_V2_BOLKER, 8);
  assert.equal(erKulturutvalg("Komité for kultur, Akershus"), true);
  assert.equal(erKulturutvalg("Stavanger kommune"), false);
  assert.equal(erEinnsynV2Organ("Stavanger kommune før 2016"), false);
  assert.equal(erEinnsynV2Organ("Buskerud fylkeskommune (2015-2019)"), false);
  assert.equal(erEinnsynV2Organ("Oslo kommunes klagenemnd"), false);
  assert.equal(erEinnsynV2Organ("Bydel Ullern arbeidsmiljøutvalg (AMU)"), false);
  assert.equal(erEinnsynV2Organ("Hvaler Kommune"), true);
});

test("idrett alene forhåndsgodkjennes ikke", () => {
  assert.equal(v2ForhandsGodkjent("Ny idrettshall", "Stavanger kommune"), false);
  assert.equal(v2ForhandsGodkjent("Tilskudd til bibliotek", "Stavanger kommune"), true);
  assert.equal(v2ForhandsGodkjent("Økonomiplan", "Komité for kultur, Akershus"), true);
});

test("neste side utenfor api.einnsyn.no brukes ikke", () => {
  assert.equal(tryggEinnsynUrl("https://evil.example/search?limit=50"), null);
  assert.equal(tryggEinnsynUrl("https://api.einnsyn.no/search?limit=101"), null);
  assert.equal(tryggEinnsynUrl("http://api.einnsyn.no/search?limit=50"), null);
  assert.match(tryggEinnsynUrl("https://api.einnsyn.no/search?limit=50") ?? "", /api\.einnsyn\.no\/search/);
  const url = new URL(einnsynSokUrl({ enhetId: "enh_1", fra: "2026-09-24", ord: "kultur" }));
  assert.equal(url.searchParams.get("limit"), "50");
  assert.equal(url.searchParams.get("administrativEnhet"), "enh_1");
  assert.equal(url.searchParams.get("moetedatoFrom"), "2026-09-24");
  assert.equal(moetedatoFra(Date.parse("2026-10-24T12:00:00+02:00")), "2026-09-24");
});

test("v2 søker per organ og stopper ved feil uten å fortsette", async () => {
  const kall: string[] = [];
  const utfall = await hentEInnsynV2({
    pauseMs: 25,
    pause: async () => {},
    nå: Date.parse("2026-10-24T12:00:00+02:00"),
    hent: async (url) => {
      const s = String(url);
      kall.push(s);
      if (s.includes("/enhet?query=kommune")) {
        return svar({ items: [{ id: "enh_stavanger", navn: "Stavanger kommune" }] });
      }
      if (s.includes("/enhet?query=")) return svar({ items: [] });
      if (s.includes("query=kultur")) {
        return { ok: false, status: 503, async text() { return "nei"; } };
      }
      throw new Error(`skulle stoppet før ${s}`);
    },
  });
  assert.equal(utfall.items.length, 0);
  assert.equal(utfall.feil[0]?.httpStatus, 503);
  assert.equal(kall.some((url) => url.includes("query=idrett")), false);
  assert.equal(kall.some((url) => url === EINNSYN_V1_SOK), false);
  assert.equal(kall.filter((url) => url.includes("/search")).length, EINNSYN_V2_MAKS_FORSOK);
});

test("v2 følger next på api.einnsyn.no og hopper over fremmed vert", async () => {
  const kall: string[] = [];
  const utfall = await hentEInnsynV2({
    pauseMs: 0,
    nå: Date.parse("2026-10-24T12:00:00+02:00"),
    hent: async (url, init) => {
      const s = String(url);
      kall.push(s);
      if (s.includes("/enhet?query=kommune")) {
        return svar({
          items: [
            { id: "enh_stavanger", navn: "Stavanger kommune" },
            { id: "enh_kultur", navn: "Komité for kultur, Akershus fylkeskommune" },
          ],
        });
      }
      if (s.includes("/enhet?query=")) return svar({ items: [] });
      if (s.includes("/enhet/enh_")) {
        const ua = new Headers((init as RequestInit | undefined)?.headers).get("user-agent");
        assert.equal(ua, EINNSYN_USER_AGENT);
        return svar({ navn: "Stavanger kommune" });
      }
      if (s.includes("query=kultur") && s.includes("enh_stavanger") && !s.includes("side=2")) {
        return svar({
          items: Array.from({ length: 50 }, (_, i) => ({
            id: `ms_${i}`,
            offentligTittel: "Kultursak",
            journalenhet: "enh_stavanger",
          })),
          next: "https://evil.example/search?limit=50",
        });
      }
      if (s.includes("data.brreg.no")) {
        const ua = new Headers((init as RequestInit | undefined)?.headers).get("user-agent");
        assert.equal(ua, KULTURVARSLING_USER_AGENT);
        return { ok: false, status: 404, async text() { return ""; } };
      }
      return svar({ items: [] });
    },
  });
  assert.equal(kall.some((url) => url.includes("evil.example")), false);
  assert.equal(utfall.feil.length > 0, true);
  assert.equal(utfall.items[0]?.tittel, "Kultursak");
  assert.equal(utfall.items[0]?.forhåndsgodkjent, true);
});

test("hent-saker velger eInnsyn ut fra flagg og kilde-parameter", () => {
  const kilde = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(kilde, /einnsynValg\(/);
  assert.match(kilde, /beforeunload/);
  assert.match(kilde, /avbruddsKjoringRad/);
  assert.match(kilde, /hentEInnsynV2\(\{ bolk: jobb\.bolk/);
  assert.match(kilde, /lesEinnsynV2FraDb/);
  assert.match(kilde, /startetMs/);
  assert.equal(kilde.includes("bakgrunn: true"), false);
  assert.equal(kilde.includes("400 s"), false);
  assert.equal(einnsynValg({ kilder: null, v2: false }), "v1");
  assert.equal(einnsynValg({ kilder: null, v2: true }), "hopp over");
  assert.equal(einnsynValg({ kilder: ["einnsyn"], v2: true }), "v2");
  assert.equal(einnsynValg({ kilder: ["einnsyn"], v2: false }), "hopp over");
  assert.equal(einnsynValg({ kilder: ["bergen"], v2: true }), "hopp over");
  assert.equal(einnsynValg({ kilder: ["einnsyn", "bergen"], v2: true }), "v2");
  assert.deepEqual(lesKildeutvalg(["einnsyn"]), { kilder: ["einnsyn"], feil: null });
  assert.equal(lesKildeutvalg(["ukjent"]).feil, "Ukjent kilde");
  assert.equal(lesKildeutvalg(null).kilder, null);
  assert.deepEqual(lesBolk(null), { bolk: null, feil: null });
  assert.deepEqual(lesBolk(2), { bolk: 2, feil: null });
  assert.equal(lesBolk(0).feil, "Ukjent bolk");
  assert.deepEqual(lesBolk(8), { bolk: 8, feil: null });
  assert.equal(lesBolk(9).feil, "Ukjent bolk");
  assert.equal(lesBolk("1").feil, "Ukjent bolk");
  assert.equal(einnsynV2ErPa(null, false), false);
  assert.equal(einnsynV2ErPa(null, true), true);
  assert.equal(einnsynV2ErPa(false, true), false);
  assert.equal(einnsynV2ErPa(true, false), true);
});

test("User-Agent, 429 med Retry-After og 404 gir alarmgrunnlag", async () => {
  const sett = new Map<string, string>();
  let kultur = 0;
  const utfall = await hentEInnsynV2({
    pauseMs: 0,
    tilfeldig: () => 0,
    nå: Date.parse("2026-10-26T01:00:00Z"),
    hent: async (url, init) => {
      const s = String(url);
      const ua = new Headers((init as RequestInit | undefined)?.headers).get("user-agent");
      if (ua) sett.set(s, ua);
      if (s.includes("/enhet?query=kommune")) {
        return svar({ items: [{ id: "enh_stavanger", navn: "Stavanger kommune" }] });
      }
      if (s.includes("/enhet?query=")) return svar({ items: [] });
      if (s.includes("query=kultur")) {
        kultur++;
        return {
          ok: false,
          status: 429,
          headers: { get: (n: string) => (n === "retry-after" ? "120" : null) },
          async text() { return ""; },
        };
      }
      throw new Error(`skulle stoppet før ${s}`);
    },
  });
  assert.equal(kultur, 1);
  assert.equal(utfall.feil[0]?.httpStatus, 429);
  assert.equal(sett.size > 0, true);
  assert.equal([...sett.values()].every((ua) => ua === EINNSYN_USER_AGENT), true);

  const borte = await hentEInnsynV2({
    pauseMs: 0,
    hent: async () => ({ ok: false, status: 404, async text() { return ""; } }),
  });
  assert.equal(borte.feil[0]?.httpStatus, 404);
  assert.equal(borte.items.length, 0);
  assert.equal(borte.vellykket, 0);

  const form = await hentEInnsynV2({
    pauseMs: 0,
    hent: async () => svar({ items: [{ id: "enh_1" }] }),
  });
  assert.match(form.feil[0]?.melding ?? "", /id og navn/);
  assert.equal(form.items.length, 0);
});

test("backoff respekterer Retry-After og jitter", () => {
  assert.equal(ventetidMs({ forsok: 1, retryAfter: "2", tilfeldig: () => 0 }), 2000);
  assert.equal(ventetidMs({ forsok: 1, retryAfter: "120", tilfeldig: () => 0 }), "avbryt");
  assert.equal(ventetidMs({ forsok: 1, retryAfter: null, tilfeldig: () => 0 }), 250);
  assert.equal(ventetidMs({ forsok: 1, retryAfter: null, tilfeldig: () => 1 }), 500);
  assert.equal(ventetidMs({ forsok: 2, retryAfter: null, tilfeldig: () => 0 }), 500);
  const nå = Date.parse("2026-10-26T01:00:00Z");
  assert.equal(ventetidMs({
    forsok: 1,
    retryAfter: "Sun, 26 Oct 2026 01:00:05 GMT",
    nå,
    tilfeldig: () => 0,
  }), 5000);
  assert.equal(validerEinnsynListe({ items: [] }, "sok").ok, true);
  assert.equal(validerEinnsynListe({ items: [{ hei: 1 }] }, "sok").ok, false);
});

const SPEC_FIXTURE = "supabase/functions/hent-saker/fixtures/einnsyn.openapi.yml";
const NY_SPEC_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function ymlSvar(tekst: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return tekst; },
    async json() { return {}; },
  };
}

function einnsynMedSpec(spec: (url: string) => ReturnType<typeof ymlSvar> | ReturnType<typeof svar>) {
  return async (url: string) => {
    const s = String(url);
    if (s.includes("api.github.com") || s.includes("raw.githubusercontent.com")) return spec(s);
    if (s.includes("/enhet?query=kommune")) {
      return svar({ items: [{ id: "enh_stavanger", navn: "Stavanger kommune" }] });
    }
    if (s.includes("/enhet?query=")) return svar({ items: [] });
    if (s.includes("/enhet/enh_")) return svar({ navn: "Stavanger kommune" });
    if (s.includes("query=kultur")) {
      return svar({
        items: [{ id: "ms_1", offentligTittel: "Kultursak", journalenhet: "enh_stavanger" }],
      });
    }
    if (s.includes("data.brreg.no")) return { ok: false, status: 404, async text() { return ""; } };
    return svar({ items: [] });
  };
}

test("dagens spec og tillegg fra PR 68/69 gir samme utdrag", async () => {
  const yml = readFileSync(SPEC_FIXTURE, "utf8");
  assert.equal(await specUtdragSha256(yml), EINNSYN_SPEC_UTDRAG_SHA256);
  const utenMappeFilter = yml
    .replaceAll("        - $ref: '#/components/parameters/QueryParameters.FilterParameters.saksmappe'\n", "")
    .replaceAll("        - $ref: '#/components/parameters/QueryParameters.FilterParameters.moetemappe'\n", "");
  assert.notEqual(utenMappeFilter, yml);
  assert.equal(await specUtdragSha256(utenMappeFilter), EINNSYN_SPEC_UTDRAG_SHA256);
});

test("fjernet parameter, omdøpt felt eller sortBy uten publisertDato er avvik", async () => {
  const yml = readFileSync(SPEC_FIXTURE, "utf8");
  const utenDato = yml.replaceAll(
    "        - $ref: '#/components/parameters/QueryParameters.FilterParameters.moetedatoFrom'\n",
    "",
  );
  const omdopt = yml.replaceAll("offentligTittel:", "tittel:");
  const utenSort = yml.replaceAll("\n          - publisertDato\n", "\n");
  assert.notEqual(await specUtdragSha256(utenDato), EINNSYN_SPEC_UTDRAG_SHA256);
  assert.notEqual(await specUtdragSha256(omdopt), EINNSYN_SPEC_UTDRAG_SHA256);
  assert.notEqual(await specUtdragSha256(utenSort), EINNSYN_SPEC_UTDRAG_SHA256);
  assert.throws(() => hentSpecUtdrag(":\n  - ["), (e: unknown) => e instanceof SpecParseFeil);
});

test("ny spec-commit med uendret innhold er info, og søket beholdes", async () => {
  const yml = readFileSync(SPEC_FIXTURE, "utf8");
  const info: string[] = [];
  const opprinnelig = console.info;
  console.info = (...deler: unknown[]) => { info.push(deler.map(String).join(" ")); };
  let specUrl = "";
  let rawKall = 0;
  try {
    const utfall = await hentEInnsynV2({
      pauseMs: 0,
      sjekkSpec: true,
      nå: Date.parse("2026-10-26T01:00:00Z"),
      hent: einnsynMedSpec((s) => {
        if (s.includes("api.github.com")) {
          specUrl = s;
          return svar([{ sha: NY_SPEC_SHA }]);
        }
        rawKall++;
        return ymlSvar(yml);
      }),
    });
    assert.equal(utfall.items.length, 1);
    assert.equal(utfall.feil.some((f) => f.melding.includes("spec-innhold")), false);
    assert.equal(rawKall, 1);
    assert.match(specUrl, new RegExp(encodeURIComponent(EINNSYN_SPEC_FIL)));
    assert.equal(info.some((linje) => linje.includes("uendret") && linje.includes(NY_SPEC_SHA)), true);
    const klass = klassifiserKjøring({
      raattAntall: utfall.raattAntall,
      antallNye: 1,
      feil: utfall.feil,
      forsok: utfall.forsok,
      vellykket: utfall.vellykket,
      httpStatus: utfall.httpStatus,
    });
    assert.equal(klass.status, "ok_nye");
  } finally {
    console.info = opprinnelig;
  }
});

test("endret spec-innhold blir delvis uten å skjule treff", async () => {
  const yml = readFileSync(SPEC_FIXTURE, "utf8").replaceAll(
    "        - $ref: '#/components/parameters/QueryParameters.FilterParameters.moetedatoFrom'\n",
    "",
  );
  const utfall = await hentEInnsynV2({
    pauseMs: 0,
    sjekkSpec: true,
    hent: einnsynMedSpec((s) => {
      if (s.includes("api.github.com")) return svar([{ sha: NY_SPEC_SHA }]);
      return ymlSvar(yml);
    }),
  });
  assert.equal(utfall.items.length, 1);
  assert.equal(utfall.feil.some((f) => f.melding.includes("spec-innhold")), true);
  const klass = klassifiserKjøring({
    raattAntall: utfall.raattAntall,
    antallNye: 1,
    feil: utfall.feil,
    forsok: utfall.forsok,
    vellykket: utfall.vellykket,
    httpStatus: utfall.httpStatus,
  });
  assert.equal(klass.status, "delvis");
});

test("spec-fil som ikke kan hentes eller parses gir ingen alarm", async () => {
  const advarsler: string[] = [];
  const opprinnelig = console.warn;
  console.warn = (...deler: unknown[]) => { advarsler.push(deler.map(String).join(" ")); };
  try {
    const mangler = await hentEInnsynV2({
      pauseMs: 0,
      sjekkSpec: true,
      hent: einnsynMedSpec((s) => {
        if (s.includes("api.github.com")) return svar([{ sha: NY_SPEC_SHA }]);
        return ymlSvar("", 404);
      }),
    });
    assert.equal(mangler.items.length, 1);
    assert.equal(mangler.feil.some((f) => f.melding.includes("spec")), false);
    assert.equal(advarsler.some((linje) => linje.includes("kunne ikke hentes")), true);

    advarsler.length = 0;
    const ulovlig = await hentEInnsynV2({
      pauseMs: 0,
      sjekkSpec: true,
      hent: einnsynMedSpec((s) => {
        if (s.includes("api.github.com")) return svar([{ sha: NY_SPEC_SHA }]);
        return ymlSvar(":\n  - [");
      }),
    });
    assert.equal(ulovlig.items.length, 1);
    assert.equal(ulovlig.feil.some((f) => f.melding.includes("spec")), false);
    assert.equal(advarsler.some((linje) => linje.includes("kunne ikke parses")), true);

    const kjent = await hentEInnsynV2({
      pauseMs: 0,
      sjekkSpec: true,
      hent: einnsynMedSpec((s) => {
        if (s.includes("raw.githubusercontent.com")) throw new Error("skulle ikke hente spec-filen");
        return svar([{ sha: EINNSYN_SPEC_LEST_SHA }]);
      }),
    });
    assert.equal(kjent.items.length, 1);
    assert.equal(kjent.feil.some((f) => f.melding.includes("spec")), false);

    const docs = await hentEInnsynV2({
      pauseMs: 0,
      sjekkSpec: true,
      hent: einnsynMedSpec((s) => {
        if (s.includes("raw.githubusercontent.com")) throw new Error("skulle ikke hente spec-filen");
        return svar({ sha: "10f2b418fdbd7eb7cb523364a793549c37fff6fb" });
      }),
    });
    assert.equal(docs.items.length, 1);
    assert.equal(docs.feil.some((f) => f.melding.includes("spec")), false);
  } finally {
    console.warn = opprinnelig;
  }
});

test("Retry-After over 15 s logger faktisk status, også ved 5xx", async () => {
  let kultur = 0;
  const utfall = await hentEInnsynV2({
    pauseMs: 0,
    tilfeldig: () => 0,
    hent: async (url) => {
      const s = String(url);
      if (s.includes("/enhet?query=kommune")) {
        return svar({ items: [{ id: "enh_stavanger", navn: "Stavanger kommune" }] });
      }
      if (s.includes("/enhet?query=")) return svar({ items: [] });
      if (s.includes("query=kultur")) {
        kultur++;
        return {
          ok: false,
          status: 503,
          headers: { get: (n: string) => (n === "retry-after" ? "120" : null) },
          async text() { return ""; },
        };
      }
      throw new Error(`skulle stoppet før ${s}`);
    },
  });
  assert.equal(kultur, 1);
  assert.equal(utfall.feil[0]?.httpStatus, 503);
});

test("bolk søker bare sin andel, stabilt på id", async () => {
  const enheter = [
    { id: "enh_b", navn: "Stavanger kommune" },
    { id: "enh_a", navn: "Arendal kommune" },
  ];
  const sok = async (bolk: number) => {
    const treff: string[] = [];
    await hentEInnsynV2({
      pauseMs: 0,
      bolk,
      rotering: 0,
      hent: async (url) => {
        const s = String(url);
        if (s.includes("/enhet?query=kommune")) return svar({ items: enheter });
        if (s.includes("/enhet?query=")) return svar({ items: [] });
        if (s.includes("/search")) {
          treff.push(s);
          return svar({ items: [] });
        }
        return svar({ items: [] });
      },
    });
    return treff;
  };
  const forste = await sok(1);
  const andre = await sok(1);
  assert.equal(forste.length > 0, true);
  assert.equal(forste.every((url) => url.includes("administrativEnhet=enh_a")), true);
  assert.deepEqual(forste, andre);
  const bolk2 = await sok(2);
  assert.equal(bolk2.every((url) => url.includes("administrativEnhet=enh_b")), true);
  assert.equal(bolk2.some((url) => url.includes("enh_a")), false);

  const ids = Array.from({ length: 43 }, (_, i) => ({ id: String(i).padStart(2, "0") }));
  const storrelser = [1, 2, 3, 4, 5, 6, 7, 8].map((bolk) => organerIBolk(ids, bolk).length);
  assert.deepEqual(storrelser, [5, 5, 5, 5, 5, 5, 5, 5]);
  assert.equal(EINNSYN_V2_BOLKER, 8);
  assert.equal(roteringssteg(43), 3);
  const med = new Set([1, 2, 3, 4, 5, 6, 7, 8].flatMap((bolk) => organerIBolk(ids, bolk).map((o) => o.id)));
  assert.equal(med.size, 40);
  assert.equal(med.has("40"), false);
  const neste = new Set([1, 2, 3, 4, 5, 6, 7, 8].flatMap((bolk) => organerIBolk(ids, bolk, { rotering: 3 }).map((o) => o.id)));
  assert.equal(neste.has("40"), true);
  assert.equal(neste.has("41"), true);
  assert.equal(neste.has("42"), true);
  assert.equal(neste.has("00"), false);
  const sistNa = organerIBolk(ids, 1).at(-1)?.id;
  const sistNeste = organerIBolk(ids, 1, { rotering: 3 }).at(-1)?.id;
  assert.notEqual(sistNa, sistNeste);
  assert.deepEqual(
    organerIBolk([{ id: "b" }, { id: "a" }], 1).map((o) => o.id),
    organerIBolk([{ id: "a" }, { id: "b" }], 1).map((o) => o.id),
  );
  const dag = Date.parse("2026-10-27T01:00:00Z");
  assert.equal(einnsynRotering(dag, 43), einnsynRotering(dag + 60_000, 43));
  assert.notEqual(einnsynRotering(dag, 43), einnsynRotering(dag + 86_400_000, 43));
});

test("avbrudd skriver feil_timeout med bolk, og cron-migrasjonen feiler hardt", () => {
  const rad = avbruddsKjoringRad({
    kildeId: "kilde-1",
    bolk: 2,
    varighetMs: 140_000,
    kjoertAv: "supabase_cron",
    kjoeringstype: "vanlig",
  });
  assert.equal(rad.status, "feil_timeout");
  assert.equal(rad.antall_nye, 0);
  assert.equal(rad.antall_avvist, 0);
  assert.equal(rad.kilde_id, "kilde-1");
  assert.equal(rad.jobb, "hent-saker");
  assert.match(String(rad.feilmelding), /Bolk 2/);
  assert.equal(String(rad.feilmelding).includes("http"), false);

  const sql = readFileSync("supabase/migrations/20261026220000_einnsyn_v2_nattlig_cron.sql", "utf8");
  assert.match(sql, /raise exception/i);
  assert.equal(/raise warning/i.test(sql), false);
  assert.match(sql, /hent_saker_platform_jwt/);
  assert.match(sql, /hent_saker_cron_secret/);
  assert.match(sql, /\/functions\/v1\/hent-saker/);
  assert.match(sql, /jsonb_build_array\('einnsyn'\)/);
  assert.match(sql, /timeout_milliseconds := 120000/);
  assert.match(sql, /'einnsyn-v2-nattlig'/);
  for (const [navn, tid] of [
    ["einnsyn-v2-bolk-1", "0 1 * * *"],
    ["einnsyn-v2-bolk-2", "10 1 * * *"],
    ["einnsyn-v2-bolk-3", "20 1 * * *"],
    ["einnsyn-v2-bolk-4", "30 1 * * *"],
    ["einnsyn-v2-bolk-5", "40 1 * * *"],
    ["einnsyn-v2-bolk-6", "50 1 * * *"],
    ["einnsyn-v2-bolk-7", "0 2 * * *"],
    ["einnsyn-v2-bolk-8", "10 2 * * *"],
  ] as const) {
    assert.equal(sql.includes(`'${navn}'`) || sql.includes("'einnsyn-v2-bolk-'"), true, navn);
    assert.equal(sql.includes(`'${tid}'`), true, tid);
  }
  assert.match(sql, /'bolk', %s/);
  assert.match(sql, /insert into public\.funksjonsflagg/);
  assert.match(sql, /'einnsyn_v2', false/);
  assert.match(sql, /on conflict \(nokkel\) do nothing/);
});

test("bolk henter én side og stopper på tidsgrensen uten å miste treff", async () => {
  const sider: string[] = [];
  const utfall = await hentEInnsynV2({
    pauseMs: 0,
    bolk: 1,
    rotering: 0,
    nå: Date.parse("2026-10-26T01:00:00Z"),
    hent: async (url) => {
      const s = String(url);
      if (s.includes("/enhet?query=kommune")) {
        return svar({ items: [{ id: "enh_a", navn: "Arendal kommune" }] });
      }
      if (s.includes("/enhet?query=")) return svar({ items: [] });
      if (s.includes("/search")) {
        sider.push(s);
        return svar({
          items: Array.from({ length: 50 }, (_, i) => ({
            id: `ms_${i}`,
            offentligTittel: "Kultursak",
            journalenhet: "enh_a",
          })),
          next: "https://api.einnsyn.no/search?side=2&limit=50",
        });
      }
      if (s.includes("/enhet/enh_")) return svar({ navn: "Arendal kommune" });
      if (s.includes("data.brreg.no")) return { ok: false, status: 404, async text() { return ""; } };
      return svar({ items: [] });
    },
  });
  assert.equal(sider.length, EINNSYN_V2_SOKEORD.length);
  assert.equal(sider.some((url) => url.includes("side=2")), false);
  assert.equal(utfall.feil.some((f) => f.melding.includes("sidegrense")), false);
  assert.equal(utfall.items.length > 0, true);

  let klokke = 0;
  let sok = 0;
  const stoppet = await hentEInnsynV2({
    pauseMs: 0,
    bolk: 1,
    rotering: 0,
    startetMs: 0,
    tidsgrenseMs: 1_000,
    klokke: () => klokke,
    hent: async (url) => {
      const s = String(url);
      if (s.includes("/enhet?query=kommune")) {
        return svar({
          items: [
            { id: "enh_a", navn: "Arendal kommune" },
            { id: "enh_b", navn: "Stavanger kommune" },
          ],
        });
      }
      if (s.includes("/enhet?query=")) return svar({ items: [] });
      if (s.includes("/search")) {
        sok++;
        if (sok === 1) {
          return svar({
            items: [{ id: "ms_1", offentligTittel: "Kultursak", journalenhet: "enh_a" }],
          });
        }
        klokke = 5_000;
        return svar({ items: [] });
      }
      return svar({ items: [] });
    },
  });
  assert.equal(stoppet.items.length, 1);
  const grense = stoppet.feil.find((f) => f.melding.startsWith("Tidsgrense:"));
  assert.equal(grense?.melding, "Tidsgrense: 0 av 1 enheter");
  assert.equal(sanitertFeilmelding(grense!), grense?.melding);
  const klass = klassifiserKjøring({
    raattAntall: stoppet.raattAntall,
    antallNye: 1,
    feil: stoppet.feil,
    forsok: stoppet.forsok,
    vellykket: stoppet.vellykket,
    httpStatus: stoppet.httpStatus,
  });
  assert.equal(klass.status, "delvis");
  assert.match(klass.feilmelding ?? "", /Tidsgrense: 0 av 1 enheter/);
});

test("funksjonsflagg styrer v2, og hemmeligheten er reserve", async () => {
  const pa = await lesEinnsynV2FraDb({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { aktiv: true }, error: null }),
        }),
      }),
    }),
  });
  assert.equal(pa, true);
  const av = await lesEinnsynV2FraDb({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { aktiv: false }, error: null }),
        }),
      }),
    }),
  });
  assert.equal(av, false);
  const mangler = await lesEinnsynV2FraDb({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: { message: "finnes ikke" } }),
        }),
      }),
    }),
  });
  assert.equal(mangler, null);
  assert.equal(einnsynV2ErPa(mangler, true), true);
});

function svar(data: unknown) {
  return {
    ok: true,
    status: 200,
    async text() { return JSON.stringify(data); },
    async json() { return data; },
  };
}
