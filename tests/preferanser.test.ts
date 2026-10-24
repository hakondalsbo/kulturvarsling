// Samme treffregler som public.mottakere_for_sak. Kjøres med npm test.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  geografiskFraNivaa,
  geoTilToken,
  leggTilUtvalg,
  mottakereForSak,
  nivaaFraGeografisk,
  sakTrefferAbonnement,
  utvalgErDekket,
} from "../src/preferanser.ts";

const sak = {
  id: "sak-1",
  kategori: "musikk",
  niva: "kommune",
  fylkesnr: "46",
  kommunenr: "4601",
  sted: "Bergen",
};

test("tomt abonnement treffer alle saker", () => {
  assert.equal(sakTrefferAbonnement(sak, [], []), true);
  assert.equal(sakTrefferAbonnement(sak, null, null), true);
});

test("fagfelt avgrenser, og tomt fagfelt gjør det ikke", () => {
  assert.equal(sakTrefferAbonnement(sak, ["musikk"], ["land"]), true);
  assert.equal(sakTrefferAbonnement(sak, ["dans"], ["land"]), false);
  assert.equal(sakTrefferAbonnement({ ...sak, kategori: null }, ["musikk"], ["land"]), false);
});

test("geografi: land, fylke, kommune, sted og nivå", () => {
  assert.equal(sakTrefferAbonnement(sak, [], ["land"]), true);
  assert.equal(sakTrefferAbonnement(sak, [], ["fylke:46"]), true);
  assert.equal(sakTrefferAbonnement(sak, [], ["fylke:03"]), false);
  assert.equal(sakTrefferAbonnement(sak, [], ["kommune:4601"]), true);
  assert.equal(sakTrefferAbonnement(sak, [], ["sted:bergen"]), true);
  assert.equal(sakTrefferAbonnement(sak, [], ["sted:oslo"]), false);
  assert.equal(sakTrefferAbonnement(sak, [], ["niva:kommune"]), true);
  assert.equal(sakTrefferAbonnement(sak, [], ["niva:nasjonalt"]), false);
  assert.equal(sakTrefferAbonnement({ ...sak, niva: "nasjonalt", fylkesnr: null, kommunenr: null, sted: "Norge" }, [], ["fylke:46"]), false);
});

test("fylke-token tar med kommunesaker i fylket", () => {
  assert.equal(sakTrefferAbonnement({ ...sak, niva: "fylke", kommunenr: null, sted: "Vestland" }, [], ["fylke:46"]), true);
});

test("mottakere: fulgt sak, abonnement, og ingen dobbelt", () => {
  const profiler = [
    { id: "a", epost: "a@example.com", varsel_frekvens: "daglig", varsler_aktive: false, fagfelt: [], geografisk: [] },
    { id: "b", epost: "  ", authEpost: "b@example.com", varsel_frekvens: "straks", varsler_aktive: true, fagfelt: ["musikk"], geografisk: ["fylke:46"] },
    { id: "c", epost: "c@example.com", varsel_frekvens: "ukentlig", varsler_aktive: true, fagfelt: ["dans"], geografisk: ["land"] },
    { id: "d", epost: null, varsel_frekvens: "daglig", varsler_aktive: false, fagfelt: ["musikk"], geografisk: ["land"] },
    { id: "e", epost: "e@example.com", varsel_frekvens: "daglig", varsler_aktive: true, fagfelt: [], geografisk: ["sted:bergen"] },
  ];
  const fulgte = [
    { brukerId: "a", sakId: "sak-1" },
    { brukerId: "b", sakId: "sak-1" },
    { brukerId: "d", sakId: "annen" },
  ];
  const mottakere = mottakereForSak(sak, profiler, fulgte);
  assert.deepEqual(
    mottakere.map((m) => [m.brukerId, m.grunn, m.epost, m.varselFrekvens]),
    [
      ["a", "sak", null, "daglig"],
      ["b", "sak", "b@example.com", "straks"],
      ["e", "abonnement", null, "daglig"],
    ],
  );
});

test("varseladresse er bekreftet auth-e-post, aldri profiler.epost", () => {
  const sakLokal = { ...sak, id: "sak-epost" };
  const mottakere = mottakereForSak(
    sakLokal,
    [
      { id: "bekreftet", epost: "gammel@example.com", authEpost: "ekte@example.com", epostBekreftet: true, varsler_aktive: false, fagfelt: [], geografisk: [] },
      { id: "ubekreftet", epost: "profil@example.com", authEpost: "venter@example.com", epostBekreftet: false, varsler_aktive: false, fagfelt: [], geografisk: [] },
      { id: "uten-auth", epost: "bare-profil@example.com", varsler_aktive: false, fagfelt: [], geografisk: [] },
    ],
    [
      { brukerId: "bekreftet", sakId: "sak-epost" },
      { brukerId: "ubekreftet", sakId: "sak-epost" },
      { brukerId: "uten-auth", sakId: "sak-epost" },
    ],
  );
  assert.deepEqual(
    mottakere.map((m) => [m.brukerId, m.epost]),
    [
      ["bekreftet", "ekte@example.com"],
      ["ubekreftet", null],
      ["uten-auth", null],
    ],
  );
});

test("utvalg og tokens", () => {
  assert.equal(geoTilToken({ type: "alle" }), "land");
  assert.equal(geoTilToken({ type: "fylke", nr: "03" }), "fylke:03");
  assert.equal(geoTilToken({ type: "kommune", sted: " Bergen " }), "sted:bergen");
  assert.deepEqual(leggTilUtvalg([], ["land"], "musikk", { type: "fylke", nr: "46" }), {
    fagfelt: ["musikk"],
    geografisk: ["fylke:46"],
  });
  assert.deepEqual(leggTilUtvalg(["musikk"], ["fylke:46"], "dans", { type: "kommune", sted: "Oslo" }), {
    fagfelt: ["musikk", "dans"],
    geografisk: ["fylke:46", "sted:oslo"],
  });
  assert.deepEqual(nivaaFraGeografisk(["fylke:46", "sted:oslo"]), ["fylke", "kommune"]);
  assert.deepEqual(geografiskFraNivaa(["fylke"], ["fylke:46", "sted:oslo"]), ["fylke:46"]);
  assert.deepEqual(geografiskFraNivaa(["nasjonalt", "fylke", "kommune"], ["fylke:46"]), ["land"]);
  assert.equal(utvalgErDekket(true, [], ["land"], "musikk", { type: "kommune", sted: "Bergen" }), true);
  assert.equal(utvalgErDekket(false, [], ["land"], "alle", { type: "alle" }), false);
  assert.equal(utvalgErDekket(true, ["dans"], ["land"], "musikk", { type: "alle" }), false);
});
