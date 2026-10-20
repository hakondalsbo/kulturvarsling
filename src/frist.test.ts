import { test } from "node:test";
import assert from "node:assert/strict";
import { dagerTilFrist, erHasterSak, fristEtikett, fristTilstand } from "./frist.ts";

const NÅ = new Date("2026-10-20T12:00:00");

test("haster er bare frist innen sju dager", () => {
  assert.equal(erHasterSak({ frist: "2026-10-27", status: "normal" }, NÅ), true);
  assert.equal(erHasterSak({ frist: "2026-10-28", status: "kritisk" }, NÅ), false);
  assert.equal(erHasterSak({ frist: null, status: "kritisk" }, NÅ), false);
  assert.equal(erHasterSak({ frist: "2026-10-19", status: "kritisk" }, NÅ), false);
  assert.equal(fristTilstand({ frist: "2026-11-23", status: "viktig" }, NÅ), "senere");
  assert.equal(fristTilstand({ frist: null, status: "passert" }, NÅ), "passert");
  assert.equal(fristTilstand({ frist: null, status: "viktig" }, NÅ), "uten");
});

test("etiketten sier passert når dagen er ute", () => {
  assert.equal(dagerTilFrist("2026-10-19", NÅ), -1);
  assert.equal(fristEtikett({ frist: "2026-10-19", status: "passert", dager: 0 }, NÅ), "Passert");
  assert.equal(fristEtikett({ frist: null, status: "kritisk" }, NÅ), "Ingen frist");
  assert.equal(fristEtikett({ frist: "2026-10-20", status: "kritisk" }, NÅ), "I dag");
});
