import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EINNSYN_V1_MAKS_GEO, EINNSYN_V1_SOK, hentEInnsynKultursaker } from "./einnsyn.ts";
import {
  EINNSYN_V2_LIMIT,
  EINNSYN_V2_SOKEORD,
  einnsynSokUrl,
  einnsynV2Aktiv,
  erEinnsynV2Organ,
  erKulturutvalg,
  forventetEinnsynV2Kall,
  hentEInnsynV2,
  moetedatoFra,
  tryggEinnsynUrl,
  v2ForhandsGodkjent,
} from "./einnsyn-v2.ts";

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

test("forventet kall med flagget på er 508 ved ett treffside", () => {
  const tall = forventetEinnsynV2Kall();
  assert.equal(EINNSYN_V2_SOKEORD.length, 10);
  assert.deepEqual(tall, { oppdagelse: 6, sok: 380, kulturUtvalg: 8, geo: 114, totalt: 508 });
  assert.equal(EINNSYN_V2_LIMIT <= 100, true);
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
  assert.equal(kall.filter((url) => url.includes("/search")).length, 1);
});

test("v2 følger next på api.einnsyn.no og hopper over fremmed vert", async () => {
  const kall: string[] = [];
  const utfall = await hentEInnsynV2({
    pauseMs: 0,
    nå: Date.parse("2026-10-24T12:00:00+02:00"),
    hent: async (url) => {
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
      if (s.includes("/enhet/enh_")) return svar({ navn: "Stavanger kommune" });
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
      if (s.includes("data.brreg.no")) return { ok: false, status: 404, async text() { return ""; } };
      return svar({ items: [] });
    },
  });
  assert.equal(kall.some((url) => url.includes("evil.example")), false);
  assert.equal(utfall.feil.length > 0, true);
  assert.equal(utfall.items[0]?.tittel, "Kultursak");
  assert.equal(utfall.items[0]?.forhåndsgodkjent, true);
});

test("hent-saker kaller v2 bare bak flagget", () => {
  const kilde = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(
    kilde,
    /einnsynV2Aktiv\(\) \? hentEInnsynV2\(\) : hentEInnsynKultursaker\(\)/,
  );
});

function svar(data: unknown) {
  return {
    ok: true,
    status: 200,
    async text() { return JSON.stringify(data); },
  };
}
