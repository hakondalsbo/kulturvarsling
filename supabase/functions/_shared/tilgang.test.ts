// Låser live-kvotene. Endres tallene her, er gating endret — det skal ikke skje stille.

import { test } from "node:test";
import assert from "node:assert/strict";
import { aiKvoteGrense, harPremium, reserverAiKvote } from "./tilgang.ts";

test("harPremium leser kun profiler.plan === premium", () => {
  assert.equal(harPremium({ plan: "premium" }), true);
  assert.equal(harPremium({ plan: "gratis" }), false);
  assert.equal(harPremium({ plan: "Premium" }), false);
  assert.equal(harPremium(null), false);
  assert.equal(harPremium({ plan: "gratis", metadata: { plan: "premium" } }), false);
});

test("kvote er 10 for budsjett, 30 gratis og 120 premium for klartekst", async () => {
  const kall: Array<{ navn: string; params: Record<string, unknown> }> = [];
  const db = {
    rpc: (navn: string, params: Record<string, unknown>) => {
      kall.push({ navn, params });
      return Promise.resolve({ data: true, error: null });
    },
  };
  assert.equal(await reserverAiKvote(db, "bruker-1", "budsjett", true), "ok");
  assert.equal(await reserverAiKvote(db, "bruker-1", "klartekst", false), "ok");
  assert.equal(await reserverAiKvote(db, "bruker-1", "klartekst", true), "ok");
  assert.deepEqual(kall.map((k) => k.navn), ["reserver_ai_kvote", "reserver_ai_kvote", "reserver_ai_kvote"]);
  assert.deepEqual(kall.map((k) => k.params.p_grense), [10, 30, 120]);
  assert.deepEqual(kall.map((k) => k.params.p_oppgave), ["budsjett", "klartekst", "klartekst"]);
});

test("kvote-rpc som feiler eller ikke svarer boolsk blir feil, false blir grense", async () => {
  const feilDb = { rpc: () => Promise.resolve({ data: null, error: { message: "x" } }) };
  assert.equal(await reserverAiKvote(feilDb, "bruker-1", "klartekst", false), "feil");
  const grenseDb = { rpc: () => Promise.resolve({ data: false, error: null }) };
  assert.equal(await reserverAiKvote(grenseDb, "bruker-1", "budsjett", true), "grense");
});

test("horingshjelp har egen døgnkvote og endrer ikke klartekst eller budsjett", async () => {
  assert.equal(aiKvoteGrense("budsjett", true), 10);
  assert.equal(aiKvoteGrense("klartekst", false), 30);
  assert.equal(aiKvoteGrense("klartekst", true), 120);
  assert.equal(aiKvoteGrense("horingshjelp", true), 10);
  const kall: Array<Record<string, unknown>> = [];
  const db = {
    rpc: (_navn: string, params: Record<string, unknown>) => {
      kall.push(params);
      return Promise.resolve({ data: true, error: null });
    },
  };
  assert.equal(await reserverAiKvote(db, "bruker-1", "horingshjelp", true), "ok");
  assert.equal(kall[0].p_oppgave, "horingshjelp");
  assert.equal(kall[0].p_grense, 10);
});
