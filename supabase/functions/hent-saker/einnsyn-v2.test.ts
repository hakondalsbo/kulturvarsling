import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EINNSYN_V1_MAKS_GEO, EINNSYN_V1_SOK, hentEInnsynKultursaker } from "./einnsyn.ts";
import { EINNSYN_USER_AGENT } from "./einnsyn.ts";
import {
  EINNSYN_SPEC_FIL,
  EINNSYN_SPEC_KJENT_SHA,
  EINNSYN_V2_BOLKER,
  EINNSYN_V2_LIMIT,
  EINNSYN_V2_MAKS_FORSOK,
  EINNSYN_V2_MAKS_KALL,
  EINNSYN_V2_SOKEORD,
  avbruddsKjoringRad,
  einnsynSokUrl,
  einnsynValg,
  einnsynV2Aktiv,
  erEinnsynV2Organ,
  erKulturutvalg,
  forventetEinnsynV2BolkKall,
  forventetEinnsynV2Kall,
  hentEInnsynV2,
  lesBolk,
  lesKildeutvalg,
  moetedatoFra,
  organerIBolk,
  specShaAvviker,
  tryggEinnsynUrl,
  validerEinnsynListe,
  v2ForhandsGodkjent,
  ventetidMs,
} from "./einnsyn-v2.ts";
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
  assert.equal(bolk.bolker, 4);
  assert.equal(bolk.enheter, 11);
  assert.deepEqual(
    { oppdagelse: bolk.oppdagelse, sok: bolk.sok, geo: bolk.geo, einnsyn: bolk.einnsyn },
    { oppdagelse: 5, sok: 110, geo: 11, einnsyn: 126 },
  );
  assert.equal(bolk.brreg, 22);
  assert.equal(bolk.claude, 3);
  assert.equal(bolk.klartekst, 1);
  assert.equal(bolk.einnsyn < EINNSYN_V2_MAKS_KALL, true);
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
  assert.equal(lesBolk(5).feil, "Ukjent bolk");
  assert.equal(lesBolk("1").feil, "Ukjent bolk");
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

test("backoff respekterer Retry-After og jitter, og spec-sha er pinnet", () => {
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
  assert.equal(specShaAvviker(EINNSYN_SPEC_KJENT_SHA), false);
  assert.equal(specShaAvviker("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), true);
  assert.equal(specShaAvviker(""), false);
  assert.equal(validerEinnsynListe({ items: [] }, "sok").ok, true);
  assert.equal(validerEinnsynListe({ items: [{ hei: 1 }] }, "sok").ok, false);
});

test("ny spec-fil-commit blir en feil uten å skjule treff", async () => {
  let specUrl = "";
  const utfall = await hentEInnsynV2({
    pauseMs: 0,
    sjekkSpec: true,
    nå: Date.parse("2026-10-26T01:00:00Z"),
    hent: async (url) => {
      const s = String(url);
      if (s.includes("api.github.com")) {
        specUrl = s;
        return svar([{ sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }]);
      }
      if (s.includes("/enhet?query=kommune")) {
        return svar({ items: [{ id: "enh_stavanger", navn: "Stavanger kommune" }] });
      }
      if (s.includes("/enhet?query=")) return svar({ items: [] });
      if (s.includes("/enhet/enh_")) return svar({ navn: "Stavanger kommune" });
      if (s.includes("query=kultur")) {
        return svar({
          items: [{
            id: "ms_1",
            offentligTittel: "Kultursak",
            journalenhet: "enh_stavanger",
          }],
        });
      }
      if (s.includes("data.brreg.no")) return { ok: false, status: 404, async text() { return ""; } };
      return svar({ items: [] });
    },
  });
  assert.equal(utfall.items.length, 1);
  assert.equal(utfall.feil.some((f) => f.melding.includes("spec-commit")), true);
  assert.match(specUrl, new RegExp(encodeURIComponent(EINNSYN_SPEC_FIL)));

  const kjent = await hentEInnsynV2({
    pauseMs: 0,
    sjekkSpec: true,
    hent: async (url) => {
      const s = String(url);
      if (s.includes("api.github.com")) return svar([{ sha: EINNSYN_SPEC_KJENT_SHA }]);
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
    },
  });
  assert.equal(kjent.feil.some((f) => f.melding.includes("spec-commit")), false);

  const docs = await hentEInnsynV2({
    pauseMs: 0,
    sjekkSpec: true,
    hent: async (url) => {
      const s = String(url);
      if (s.includes("api.github.com")) return svar({ sha: "10f2b418fdbd7eb7cb523364a793549c37fff6fb" });
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
    },
  });
  assert.equal(docs.items.length, 1);
  assert.equal(docs.feil.some((f) => f.melding.includes("spec-commit")), false);
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
  const storrelser = [1, 2, 3, 4].map((bolk) => organerIBolk(ids, bolk).length);
  assert.deepEqual(storrelser, [11, 11, 11, 10]);
  assert.equal(EINNSYN_V2_BOLKER, 4);
  const sett = new Set([1, 2, 3, 4].flatMap((bolk) => organerIBolk(ids, bolk).map((o) => o.id)));
  assert.equal(sett.size, 43);
  assert.deepEqual(
    organerIBolk([{ id: "b" }, { id: "a" }], 1).map((o) => o.id),
    organerIBolk([{ id: "a" }, { id: "b" }], 1).map((o) => o.id),
  );
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
  ] as const) {
    assert.equal(sql.includes(`'${navn}'`) || sql.includes("'einnsyn-v2-bolk-'"), true, navn);
    assert.equal(sql.includes(`'${tid}'`), true, tid);
  }
  assert.match(sql, /'bolk', %s/);
});

function svar(data: unknown) {
  return {
    ok: true,
    status: 200,
    async text() { return JSON.stringify(data); },
    async json() { return data; },
  };
}
