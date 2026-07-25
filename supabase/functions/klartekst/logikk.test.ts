// Tester for klartekst-logikken. Kjøres med Node sin innebygde testkjører:
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  byggPrompt,
  lagProfilNokkel,
  parseKlartekstSvar,
  trekkUtTekst,
} from "./logikk.ts";

// ─── lagProfilNokkel ──────────────────────────────────────────────────────────

test("samme profil gir samme nøkkel uansett rekkefølge og casing", () => {
  const a = lagProfilNokkel({ fagfelt: ["Musikk", "scenekunst"], org_type: "Friteater" });
  const b = lagProfilNokkel({ fagfelt: ["scenekunst", "musikk "], org_type: "friteater" });
  assert.equal(a, b);
});

test("tom profil gir stabil standardnøkkel", () => {
  assert.equal(lagProfilNokkel(null), "ukjent|alle|hele-landet");
  assert.equal(lagProfilNokkel({ fagfelt: [], org_type: "", fylke: "" }), "ukjent|alle|hele-landet");
});

test("fylke inngår i nøkkelen", () => {
  const uten = lagProfilNokkel({ org_type: "friteater" });
  const med = lagProfilNokkel({ org_type: "friteater", fylke: "Vestland" });
  assert.notEqual(uten, med);
  assert.ok(med.endsWith("|vestland"));
});

test("duplikate fagfelt telles én gang", () => {
  const a = lagProfilNokkel({ fagfelt: ["musikk", "Musikk", "musikk"] });
  const b = lagProfilNokkel({ fagfelt: ["musikk"] });
  assert.equal(a, b);
});

// ─── trekkUtTekst ─────────────────────────────────────────────────────────────

test("finner tekstblokk etter thinking-blokk (Claude 5)", () => {
  const content = [
    { type: "thinking", thinking: "..." },
    { type: "text", text: '{"hva_skjer":"noe"}' },
  ];
  assert.equal(trekkUtTekst(content), '{"hva_skjer":"noe"}');
});

test("tåler tomt/ugyldig innhold", () => {
  assert.equal(trekkUtTekst(undefined), "");
  assert.equal(trekkUtTekst([]), "");
  assert.equal(trekkUtTekst([{ type: "thinking", thinking: "x" }]), "");
});

// ─── parseKlartekstSvar ───────────────────────────────────────────────────────

test("parser gyldig svar og normaliserer felter", () => {
  const svar = parseKlartekstSvar(JSON.stringify({
    hva_skjer: "Kommunen kutter kulturbudsjettet.",
    hvem_pavirkes: "Frie grupper i Vestland.",
    tall_belop: null,
    frist: "Høringsfrist 1. september",
    hva_kan_du_gjore: ["Skriv høringssvar", "", "Kontakt utvalget"],
  }));
  assert.ok(svar);
  assert.equal(svar.hva_skjer, "Kommunen kutter kulturbudsjettet.");
  assert.equal(svar.tall_belop, null);
  assert.deepEqual(svar.hva_kan_du_gjore, ["Skriv høringssvar", "Kontakt utvalget"]);
});

test("fjerner markdown-gjerder rundt JSON", () => {
  const svar = parseKlartekstSvar('```json\n{"hva_skjer":"Noe skjer.","hvem_pavirkes":"Alle."}\n```');
  assert.ok(svar);
  assert.equal(svar.hva_skjer, "Noe skjer.");
});

test("avviser svar uten hva_skjer eller med ugyldig JSON", () => {
  assert.equal(parseKlartekstSvar("dette er ikke json"), null);
  assert.equal(parseKlartekstSvar('{"hvem_pavirkes":"Alle."}'), null);
  assert.equal(parseKlartekstSvar(""), null);
});

// ─── byggPrompt ───────────────────────────────────────────────────────────────

test("prompten inneholder sak og profil", () => {
  const p = byggPrompt(
    { tittel: "Kutt i Kulturfondet", sammendrag: "Regjeringen foreslår kutt.", instans: "Kulturdepartementet", frist: "2026-09-01", niva: "nasjonalt", sted: "Nasjonalt" },
    { fagfelt: ["scenekunst"], org_type: "friteater", fylke: "Vestland" },
  );
  assert.ok(p.includes("Kutt i Kulturfondet"));
  assert.ok(p.includes("scenekunst"));
  assert.ok(p.includes("friteater"));
  assert.ok(p.includes("Vestland"));
  assert.ok(p.includes("gyldig JSON"));
});

test("prompten håndterer tom profil", () => {
  const p = byggPrompt({ tittel: "En sak" }, null);
  assert.ok(p.includes("alle fagfelt"));
  assert.ok(p.includes("hele landet"));
});
