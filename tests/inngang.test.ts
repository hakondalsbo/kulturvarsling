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

test("vercel.json omskriver de samme stiene uten routes", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  assert.equal(config.routes, undefined);
  assert.equal(config.redirects, undefined);
  assert.deepEqual(
    config.rewrites.map((r: { source: string; destination: string }) => [r.source, r.destination]),
    [
      ["/app", "/index.html"],
      ["/app/(.*)", "/index.html"],
      ["/personvern", "/personvern.html"],
      ["/bekreft", "/bekreft.html"],
      ["/avmelding", "/avmelding.html"],
      ["/statsbudsjett", "/index.html"],
      ["/statsbudsjett/", "/index.html"],
      ["/ordliste", "/index.html"],
      ["/app/ordliste", "/index.html"],
      ["/design", "/index.html"],
      ["/app/design", "/index.html"],
      ["/min-side", "/index.html"],
      ["/app/min-side", "/index.html"],
      ["/mobiliser", "/index.html"],
      ["/mobiliser/", "/index.html"],
      ["/komite/:id", "/index.html"],
      ["/(.*)", "/404.html"],
    ],
  );
  assert.deepEqual(config.rewrites.at(-1), {
    source: "/(.*)",
    destination: "/404.html",
    statusCode: 404,
  });
  assert.equal(config.github.silent, true);
  assert.deepEqual(
    config.headers[0].headers.map((h: { key: string }) => h.key),
    [
      "Content-Security-Policy",
      "X-Frame-Options",
      "Referrer-Policy",
      "X-Content-Type-Options",
      "Permissions-Policy",
      "Strict-Transport-Security",
    ],
  );
});

test("komponentoversikten ligger på /design", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const design = readFileSync("src/design.tsx", "utf8");
  const vercel = readFileSync("vercel.json", "utf8");
  assert.match(app, /\/design/);
  assert.doesNotMatch(app, /href="\/design"/);
  assert.doesNotMatch(vercel, /"routes"/);
  assert.match(vercel, /"source": "\/design", "destination": "\/index.html"/);
  assert.match(vercel, /\{ "source": "\/statsbudsjett", "destination": "\/index.html" \}/);
  assert.match(vercel, /\{ "source": "\/statsbudsjett\/", "destination": "\/index.html" \}/);
  assert.match(vercel, /script-src 'self' https:\/\/vercel\.live https:\/\/challenges\.cloudflare\.com/);
  assert.match(vercel, /connect-src[^;]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(vercel, /frame-src https:\/\/vercel\.live https:\/\/challenges\.cloudflare\.com/);
  assert.match(vercel, /Content-Security-Policy/);
  assert.match(vercel, /frame-ancestors 'none'/);
  assert.match(vercel, /X-Frame-Options/);
  assert.match(vercel, /strict-origin-when-cross-origin/);
  assert.match(vercel, /nosniff/);
  assert.match(vercel, /Permissions-Policy/);
  assert.match(vercel, /includeSubDomains/);
  assert.match(vercel, /zyyijlvmgoanjdzngmon/);
  assert.equal(existsSync("public/404.html"), true);
  assert.doesNotMatch(readFileSync("public/404.html", "utf8"), /varslingssystem/);
  for (const tekst of ["Inaktiv", "Hover", "Fokus", "Aktiv", "Laster", "Faner og filtre", "Merker", "Skjema"]) {
    assert.match(design, new RegExp(tekst));
  }
});
