import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("forsiden har én inngang til statsbudsjettsiden", () => {
  const avis = readFileSync("src/avis.tsx", "utf8");
  assert.equal((avis.match(/<StatsbudsjettInngang/g) ?? []).length, 1);
  assert.doesNotMatch(avis, /BudsjettInngang/);
  assert.equal(existsSync("src/statsbudsjett.tsx"), true);
  assert.equal(existsSync("src/innhold/statsbudsjett2027.md"), true);
});

test("komponentoversikten ligger på /design", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const design = readFileSync("src/design.tsx", "utf8");
  const vercel = readFileSync("vercel.json", "utf8");
  assert.match(app, /\/design/);
  assert.doesNotMatch(app, /href="\/design"/);
  assert.match(vercel, /"src": "\/design"/);
  assert.match(vercel, /\/404\.html/);
  assert.equal(existsSync("public/404.html"), true);
  assert.doesNotMatch(readFileSync("public/404.html", "utf8"), /varslingssystem/);
  for (const tekst of ["Inaktiv", "Hover", "Fokus", "Aktiv", "Laster", "Faner og filtre", "Merker", "Skjema"]) {
    assert.match(design, new RegExp(tekst));
  }
});
