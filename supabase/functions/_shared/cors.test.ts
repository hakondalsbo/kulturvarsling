import { test } from "node:test";
import assert from "node:assert/strict";
import { corsHeadere, erTillattOpprinnelse } from "./cors.ts";

function foresporsel(origin: string | null) {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return { headers };
}

function harAcao(headere: Record<string, string>): boolean {
  return Object.prototype.hasOwnProperty.call(headere, "Access-Control-Allow-Origin");
}

test("bare kjente opprinnelser ekkoes", () => {
  assert.equal(erTillattOpprinnelse("https://www.kulturvarsling.no"), true);
  assert.equal(erTillattOpprinnelse("https://kulturvarsling.no"), true);
  assert.equal(erTillattOpprinnelse("http://localhost:5173"), true);
  assert.equal(erTillattOpprinnelse("http://localhost:4173"), true);
  assert.equal(erTillattOpprinnelse("https://ond.example"), false);
  assert.equal(erTillattOpprinnelse(null), false);
  assert.equal(erTillattOpprinnelse(""), false);

  const kjent = corsHeadere(foresporsel("http://localhost:5173"));
  assert.equal(kjent["Access-Control-Allow-Origin"], "http://localhost:5173");
  assert.equal(kjent.Vary, "Origin");

  const ukjent = corsHeadere(foresporsel("https://ond.example"));
  assert.equal(harAcao(ukjent), false);
  assert.equal(ukjent["Access-Control-Allow-Headers"], "authorization, x-client-info, apikey, content-type");
  assert.equal(ukjent.Vary, "Origin");

  const uten = corsHeadere(foresporsel(null));
  assert.equal(harAcao(uten), false);

  const avmeld = corsHeadere(foresporsel("https://www.kulturvarsling.no"), "GET, POST, OPTIONS");
  assert.equal(avmeld["Access-Control-Allow-Origin"], "https://www.kulturvarsling.no");
  assert.equal(avmeld["Access-Control-Allow-Methods"], "GET, POST, OPTIONS");
});

test("vercel-preview er tillatt, fremmed opprinnelse får ingen ACAO", () => {
  const tillatt = [
    "https://kulturvarsling-git-main-hakondalsbos-projects.vercel.app",
    "https://kulturvarsling-abc123-hakondalsbos-projects.vercel.app",
    "https://kulturvarsling-cursor-sikkerhetsheadere-cors-78e1-hakondalsbos-projects.vercel.app",
  ];
  for (const origin of tillatt) {
    assert.equal(erTillattOpprinnelse(origin), true, origin);
    assert.equal(corsHeadere(foresporsel(origin))["Access-Control-Allow-Origin"], origin);
  }

  const avvist = [
    "https://ond.example",
    "https://www.kulturvarsling.no.ond.example",
    "https://kulturvarsling-hakondalsbos-projects.vercel.app",
    "https://kulturvarsling-ABC-hakondalsbos-projects.vercel.app",
    "http://kulturvarsling-abc-hakondalsbos-projects.vercel.app",
    "https://kulturvarsling-abc-hakondalsbos-projects.vercel.app.evil.com",
    "https://evil-kulturvarsling-abc-hakondalsbos-projects.vercel.app",
    "https://kulturvarsling-abc-annen-projects.vercel.app",
    "https://kulturvarsling-abc-hakondalsbos-projects.vercel.app/",
    "https://kulturvarsling-abc-hakondalsbos-projects.vercel.app:443",
    "https://notkulturvarsling-abc-hakondalsbos-projects.vercel.app",
  ];
  for (const origin of avvist) {
    assert.equal(erTillattOpprinnelse(origin), false, origin);
    const headere = corsHeadere(foresporsel(origin));
    assert.equal(harAcao(headere), false, origin);
  }
});
