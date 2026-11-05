import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

test("robots og sitemap peker på de offentlige sidene", () => {
  assert.equal(existsSync("public/robots.txt"), true);
  assert.equal(existsSync("public/sitemap.xml"), true);
  const robots = readFileSync("public/robots.txt", "utf8");
  const sitemap = readFileSync("public/sitemap.xml", "utf8");
  const vercel = readFileSync("vercel.json", "utf8");
  assert.match(robots, /Sitemap: https:\/\/www\.kulturvarsling\.no\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/design/);
  assert.match(robots, /Disallow: \/app\/design/);
  for (const sti of [
    "https://www.kulturvarsling.no/",
    "https://www.kulturvarsling.no/statsbudsjett",
    "https://www.kulturvarsling.no/ordliste",
    "https://www.kulturvarsling.no/personvern",
  ]) {
    assert.match(sitemap, new RegExp(sti.replace(/[/.]/g, "\\$&")));
  }
  assert.doesNotMatch(sitemap, /\/design/);
  assert.doesNotMatch(sitemap, /\/vilkar/);
  assert.doesNotMatch(vercel, /\/robots\.txt/);
  assert.doesNotMatch(vercel, /\/sitemap\.xml/);
  assert.doesNotMatch(vercel, /"source": "\/api/);
});

test("utlogget flate har personvern og mailto, ikke vilkår", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const budsjett = readFileSync("src/statsbudsjett.tsx", "utf8");
  const tekster = readFileSync("src/tekster.ts", "utf8");
  const fire = readFileSync("public/404.html", "utf8");
  assert.match(tekster, /mailto:post@kulturvarsling\.no\?subject=/);
  assert.match(app, /TILBAKEMELDING_HREF/);
  assert.match(app, /Gi tilbakemelding/);
  assert.match(app, /href="\/personvern"/);
  assert.match(app, /Prøvedrift/);
  assert.match(budsjett, /TILBAKEMELDING_HREF/);
  assert.match(budsjett, /Prøvedrift/);
  assert.match(budsjett, /href="\/personvern"/);
  assert.match(fire, /href="\/personvern"/);
  for (const kilde of [app, budsjett, fire]) {
    assert.doesNotMatch(kilde, /href="\/vilkar"/);
  }
  assert.match(app, /pushSti\("\/arkiv"\)/);
  assert.match(app, /p === "\/arkiv"\) return "varsler"/);
});

test("favicon er ikke lenger den tunge 520 kB-fila", () => {
  const logo = statSync("public/logo.png").size;
  const navn = statSync("public/Kulturvarsling logo.png").size;
  const stor = statSync("public/ikon-512.png").size;
  assert.ok(logo < 80_000, `logo.png er ${logo} byte`);
  assert.ok(navn < 80_000, `navngitt logo er ${navn} byte`);
  assert.ok(stor < 400_000, `ikon-512.png er ${stor} byte`);
  assert.equal(logo, navn);
  const manifest = readFileSync("public/manifest.json", "utf8");
  assert.match(manifest, /\/ikon-512\.png/);
  assert.match(manifest, /192x192/);
  assert.match(manifest, /512x512/);
});
