import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx", "utf8");

function funksjon(navn: string): string {
  const start = app.indexOf(`function ${navn}`);
  assert.ok(start > 0, navn);
  const neste = app.indexOf("\nasync function ", start + 1);
  const slutt = app.indexOf("\nfunction ", start + 1);
  const grense = [neste, slutt].filter((n) => n > start).sort((a, b) => a - b)[0] ?? start + 800;
  return app.slice(start, grense);
}

test("profilskriving er update uten id, plan eller stripe_customer_id", () => {
  const felt = funksjon("profilfelt");
  const lagre = funksjon("lagreProfil");
  const upsert = funksjon("upsertProfil");
  assert.match(felt, /delete felt\.id/);
  assert.match(felt, /delete felt\.plan/);
  assert.match(felt, /delete felt\.stripe_customer_id/);
  assert.match(lagre, /\.update\(/);
  assert.match(lagre, /\.eq\("id", userId\)/);
  assert.match(lagre, /profilfelt\(oppdateringer\)/);
  assert.doesNotMatch(lagre, /\.upsert\(/);
  assert.match(upsert, /return lagreProfil\(userId, data\)/);
  assert.doesNotMatch(upsert, /\.upsert\(/);

  const registrer = app.slice(app.indexOf("async function registrer"), app.indexOf("async function nullstillPassord"));
  assert.match(registrer, /upsertProfil\(data\.user\.id, \{ navn, onboarding_done: false \}\)/);
  assert.doesNotMatch(registrer, /stripe_customer_id/);

  const fullfor = app.slice(app.indexOf("async function fullfør"), app.indexOf("return (", app.indexOf("async function fullfør")));
  assert.match(fullfor, /upsertProfil\(user\.id,/);
  assert.match(fullfor, /personvern_akseptert_at: naa/);
  assert.match(fullfor, /personvern_versjon: PERSONVERN_VERSJON/);
  assert.doesNotMatch(fullfor, /\bplan\b/);
  assert.doesNotMatch(fullfor, /stripe_customer_id/);
  assert.doesNotMatch(fullfor, /\bid:/);
});
