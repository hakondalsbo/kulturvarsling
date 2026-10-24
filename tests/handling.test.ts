import { test } from "node:test";
import assert from "node:assert/strict";
import { matcherHandling, vurderSak } from "../src/handling.ts";

const nå = new Date("2026-10-24T12:00:00+02:00");

test("avleder mobiliser nå fra frist innen 21 dager når konsekvensfelt mangler", () => {
  const v = vurderSak({ tittel: "Tilskudd", frist: "2026-11-02", status: "viktig" }, nå);
  assert.equal(v.kilde, "avledet");
  assert.equal(v.handlingsrettet, true);
  assert.equal(v.mobiliserNaa, true);
  assert.equal(v.merke, "Mobiliser nå");
  assert.equal(v.konsekvens, null);
});

test("frist lenger frem er handlingsrettet uten mobiliser-merke", () => {
  const v = vurderSak({ tittel: "Budsjett", frist: "2026-12-20", status: "normal" }, nå);
  assert.equal(v.handlingsrettet, true);
  assert.equal(v.mobiliserNaa, false);
  assert.equal(v.merke, "Frist");
});

test("høring uten dato er handlingsrettet", () => {
  const v = vurderSak({ tittel: "Høring om kulturloven", status: "åpen" }, nå);
  assert.equal(v.handlingsrettet, true);
  assert.equal(v.merke, "Høring");
  assert.equal(v.mobiliserNaa, false);
});

test("passert frist er til orientering", () => {
  const v = vurderSak({ tittel: "Referat", frist: "2026-10-01", status: "passert" }, nå);
  assert.equal(v.handlingsrettet, false);
  assert.equal(v.mobiliserNaa, false);
  assert.equal(matcherHandling({ tittel: "Referat", frist: "2026-10-01", status: "passert" }, "orientering", nå), true);
});

test("synlig konsekvens til orientering uten frist blir ikke handlingsrettet", () => {
  const v = vurderSak({
    tittel: "Møteplan",
    konsekvens: "til_orientering",
    konsekvens_sikkerhet: "høy",
  }, nå);
  assert.equal(v.kilde, "konsekvens");
  assert.equal(v.handlingsrettet, false);
  assert.equal(v.merke, null);
});

test("kutt uten frist vises som orientering med konsekvensnavn", () => {
  const v = vurderSak({
    tittel: "Kutt i post 50",
    konsekvens: "kutt_innstramming",
    konsekvens_sikkerhet: "middels",
  }, nå);
  assert.equal(v.handlingsrettet, false);
  assert.equal(v.merke, "Kutt og innstramming");
});

test("lav sikkerhet skjules og fristen avledes i stedet", () => {
  const v = vurderSak({
    tittel: "Uklar sak",
    konsekvens: "kutt_innstramming",
    konsekvens_sikkerhet: "lav",
    frist: "2026-10-28",
  }, nå);
  assert.equal(v.kilde, "avledet");
  assert.equal(v.konsekvens, null);
  assert.equal(v.mobiliserNaa, true);
});

test("konsekvens med nær frist bruker mobiliser-vinduet", () => {
  const v = vurderSak({
    tittel: "Høring",
    konsekvens: "stor_endring",
    konsekvens_sikkerhet: "høy",
    mobiliser_dato: "2026-11-01",
    frist: "2026-11-01",
  }, nå);
  assert.equal(v.kilde, "konsekvens");
  assert.equal(v.handlingsrettet, true);
  assert.equal(v.mobiliserNaa, true);
  assert.equal(v.merke, "Mobiliser nå");
});

test("handling_mulig brukes når feltet er satt, også uten frist", () => {
  const v = vurderSak({ tittel: "Orientering som likevel kan påvirkes", handling: "handling_mulig" }, nå);
  assert.equal(v.kilde, "felt");
  assert.equal(v.handlingsrettet, true);
  assert.equal(v.merke, "Du kan gjøre noe");
});

test("bare_orientering slår ut nær frist", () => {
  const v = vurderSak({
    tittel: "Referat med dato",
    frist: "2026-10-28",
    status: "høring",
    handling: "bare_orientering",
  }, nå);
  assert.equal(v.kilde, "felt");
  assert.equal(v.handlingsrettet, false);
  assert.equal(v.mobiliserNaa, false);
  assert.equal(matcherHandling({ frist: "2026-10-28", handling: "bare_orientering" }, "orientering", nå), true);
  assert.equal(matcherHandling({ frist: "2026-10-28", handling: "bare_orientering" }, "handling", nå), false);
});

test("null i handling faller tilbake på frist", () => {
  const v = vurderSak({ tittel: "Høring", frist: "2026-11-02", handling: null }, nå);
  assert.equal(v.kilde, "avledet");
  assert.equal(v.handlingsrettet, true);
  assert.equal(v.mobiliserNaa, true);
});
