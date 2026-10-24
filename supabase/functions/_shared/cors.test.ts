import { test } from "node:test";
import assert from "node:assert/strict";
import { corsHeadere, erTillattOpprinnelse } from "./cors.ts";

function foresporsel(origin: string | null) {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return { headers };
}

test("bare kjente opprinnelser ekkoes", () => {
  assert.equal(erTillattOpprinnelse("https://www.kulturvarsling.no"), true);
  assert.equal(erTillattOpprinnelse("https://kulturvarsling.no"), true);
  assert.equal(erTillattOpprinnelse("http://localhost:5173"), true);
  assert.equal(erTillattOpprinnelse("https://ond.example"), false);
  assert.equal(erTillattOpprinnelse(null), false);

  const kjent = corsHeadere(foresporsel("http://localhost:5173"));
  assert.equal(kjent["Access-Control-Allow-Origin"], "http://localhost:5173");
  assert.equal(kjent.Vary, "Origin");

  const ukjent = corsHeadere(foresporsel("https://ond.example"));
  assert.equal(ukjent["Access-Control-Allow-Origin"], "https://www.kulturvarsling.no");
  assert.notEqual(ukjent["Access-Control-Allow-Origin"], "https://ond.example");

  const avmeld = corsHeadere(foresporsel("https://www.kulturvarsling.no"), "GET, POST, OPTIONS");
  assert.equal(avmeld["Access-Control-Allow-Methods"], "GET, POST, OPTIONS");
});
