import { test } from "node:test";
import assert from "node:assert/strict";
import { erStripeHendelseId, utfallForStripeInsert } from "./idempotens.ts";

test("samme event.id er et duplikat, andre databasefeil er ikke det", () => {
  assert.equal(utfallForStripeInsert(null), "ny");
  assert.equal(utfallForStripeInsert(undefined), "ny");
  assert.equal(utfallForStripeInsert({ code: "23505" }), "duplikat");
  assert.equal(utfallForStripeInsert({ code: "42P01" }), "feil");
});

test("hendelses-id er en kort tekst uten styringstegn", () => {
  assert.equal(erStripeHendelseId("evt_1"), true);
  assert.equal(erStripeHendelseId("ab"), false);
  assert.equal(erStripeHendelseId(""), false);
  assert.equal(erStripeHendelseId("evt\n1"), false);
});
