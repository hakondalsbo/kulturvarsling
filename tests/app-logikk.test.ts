import assert from "node:assert/strict";
import { test } from "node:test";
import { byttPremiumVerktøy, sakerJegFølger } from "../src/app-logikk.ts";

const saker = [
  { id: "a", tittel: "Kulturloven" },
  { id: "b", tittel: "Transportplan" },
  { id: "c", tittel: "Scenekunst" },
];

test("profilen viser bare sakene brukeren følger, i liste-rekkefølge", () => {
  assert.deepEqual(
    sakerJegFølger(saker, ["c", "a"]).map((sak) => sak.id),
    ["a", "c"],
  );
});

test("tom eller manglende liste kaster ikke og gir ingen rader", () => {
  assert.deepEqual(sakerJegFølger(null, ["a"]), []);
  assert.deepEqual(sakerJegFølger(saker, null), []);
  assert.deepEqual(sakerJegFølger(undefined, undefined), []);
  assert.deepEqual(sakerJegFølger(saker, ["finnes-ikke"]), []);
});

test("bytte av premium-verktøy tømmer forrige analyse", () => {
  const neste = byttPremiumVerktøy("trend");
  assert.equal(neste.tool, "trend");
  assert.equal(neste.resultat, null);
});
