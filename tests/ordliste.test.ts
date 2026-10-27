import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUDSJETTORD, ORDLISTE, ORDLISTE_INNLEDNING, ORDLISTE_TITTEL } from "../src/innhold/ordliste.ts";
import { delOpp, delOppDokument, finnTreff } from "../src/innhold/treff.ts";

test("ordlisten har 50 begreper og seks budsjettord", () => {
  assert.equal(ORDLISTE.length, 50);
  assert.equal(BUDSJETTORD.length, 6);
  assert.deepEqual(BUDSJETTORD.map((o) => o.begrep), [
    "Budsjettforlik",
    "Innstilling",
    "Kapittel og post",
    "Nominell og reell økning",
    "Prop. S og Prop. 1 S",
    "Ramme",
  ]);
});

test("budsjettforlik er gjengitt ordrett", () => {
  const o = ORDLISTE.find((x) => x.id === "budsjettforlik");
  assert.ok(o);
  assert.equal(
    o.forklaring,
    "Avtalen partiene inngår for å få flertall for statsbudsjettet. Det er ofte her de siste endringene blir gjort. Vil du ha en endring i budsjettet, må du derfor nå fram til partiene før de blir enige.",
  );
  assert.equal(o.eksempel, undefined);
  assert.deepEqual(o.synonymer, ["budsjettavtale"]);
});

test("intern tabell og saks-id er ikke med i datafilen", () => {
  const kilde = readFileSync("src/innhold/ordliste.ts", "utf8");
  assert.doesNotMatch(kilde, /Til internt bruk/);
  assert.doesNotMatch(kilde, /4d738de4/);
  assert.doesNotMatch(kilde, /kildesak/);
});

test("første forekomst per begrep, og post krever tall", () => {
  const tekst = "Saken gjelder posten og senere post 55. Så kommer post 12 igjen.";
  const treff = finnTreff(tekst);
  const kap = treff.find((t) => t.id === "kapittel-og-post");
  assert.ok(kap);
  assert.equal(tekst.slice(kap.start, kap.end), "post 55");
});

test("Prop. 1 S og Prop. S treffer samme begrep én gang", () => {
  const tekst = "Se Prop. S og deretter Prop. 1 S.";
  const treff = finnTreff(tekst);
  assert.equal(treff.filter((t) => t.id === "prop-s-og-prop-1-s").length, 1);
  assert.equal(tekst.slice(treff[0].start, treff[0].end), "Prop. S");
});

test("bydelsutvalg markeres ikke også som utvalg", () => {
  const tekst = "Bydelsutvalget behandlet saken. Utvalget for kultur kommer senere.";
  const treff = finnTreff(tekst);
  const ord = treff.map((t) => t.id);
  assert.ok(ord.includes("bydelsutvalg"));
  assert.ok(ord.includes("utvalg"));
  const bydel = treff.find((t) => t.id === "bydelsutvalg")!;
  assert.equal(tekst.slice(bydel.start, bydel.end).toLowerCase().startsWith("bydelsutvalg"), true);
});

test("flere felter i samme sak markerer begrepet bare én gang", () => {
  const [tittel, brod] = delOppDokument([
    "Høring om kulturmidler",
    "Høringen er åpen, og det er også en søknadsfrist.",
  ]);
  assert.equal(tittel.filter((d) => d.type === "ord").length, 1);
  assert.equal(brod.some((d) => d.type === "ord" && d.id === "horing"), false);
  assert.equal(brod.some((d) => d.type === "ord" && d.id === "soknadsfrist"), true);
});

test("delOpp bevarer teksten rundt treffet", () => {
  const deler = delOpp("En høring er ute.");
  assert.equal(deler.map((d) => d.tekst).join(""), "En høring er ute.");
});

test("lengre begrep vinner når det korte ordet er et prefiks", () => {
  const frist = "Høringsfristen er 12. januar. En annen høring kommer senere.";
  const fristTreff = finnTreff(frist);
  const horingsfrist = fristTreff.find((t) => t.id === "horingsfrist");
  const horing = fristTreff.find((t) => t.id === "horing");
  assert.ok(horingsfrist);
  assert.equal(frist.slice(horingsfrist.start, horingsfrist.end), "Høringsfristen");
  assert.ok(horing);
  assert.equal(frist.slice(horing.start, horing.end), "høring");

  const tilskudd = "Tilskuddsordningen er åpen, og tilskuddet kommer etterpå.";
  const tilskuddTreff = finnTreff(tilskudd);
  assert.equal(tilskudd.slice(
    tilskuddTreff.find((t) => t.id === "tilskuddsordning")!.start,
    tilskuddTreff.find((t) => t.id === "tilskuddsordning")!.end,
  ), "Tilskuddsordningen");
  assert.equal(tilskudd.slice(
    tilskuddTreff.find((t) => t.id === "tilskudd")!.start,
    tilskuddTreff.find((t) => t.id === "tilskudd")!.end,
  ), "tilskuddet");

  const ramme = "Bedre rammevilkår, og Stortinget vedtar rammene først.";
  const rammeTreff = finnTreff(ramme);
  assert.equal(ramme.slice(
    rammeTreff.find((t) => t.id === "rammevilkar")!.start,
    rammeTreff.find((t) => t.id === "rammevilkar")!.end,
  ), "rammevilkår");
  assert.equal(ramme.slice(
    rammeTreff.find((t) => t.id === "ramme")!.start,
    rammeTreff.find((t) => t.id === "ramme")!.end,
  ), "rammene");
});

test("synonym som ikke står i søkemønsteret treffer", () => {
  const tekst = "Fylkesrådet behandlet kriteriene og hovedutvalget.";
  const treff = finnTreff(tekst);
  assert.ok(treff.some((t) => t.id === "byrad-og-byradssak"));
  assert.ok(treff.some((t) => t.id === "retningslinjer"));
  assert.ok(treff.some((t) => t.id === "utvalg"));
});

test("innledningen og tittelen er hele fasiten", () => {
  assert.equal(ORDLISTE_TITTEL, "Ordliste: ord du møter i sakene");
  assert.equal(
    ORDLISTE_INNLEDNING,
    "Mange av sakene våre bruker ord fra forvaltningen og politikken. Her forklarer vi de vanligste: hva ordet betyr, og hva det betyr for deg som jobber med kunst og kultur. Ordene står i alfabetisk rekkefølge. Ord i parentes er andre former eller nynorske former av samme ord.",
  );
  const stipend = ORDLISTE.find((x) => x.id === "arbeidsstipend");
  assert.match(stipend?.forklaring ?? "", /Stipendet gis for ett til fem år og utbetales månedlig/);
  const tildeling = ORDLISTE.find((x) => x.id === "tildeling");
  assert.equal(tildeling?.eksempel, undefined);
  assert.match(readFileSync("src/ord.tsx", "utf8"), /aria-label="Bokstavindeks"/);
  assert.match(readFileSync("src/ord.tsx", "utf8"), /href=\{`#\$\{o\.id\}`\}/);
  assert.doesNotMatch(readFileSync("src/statsbudsjett.tsx", "utf8"), /ORDLISTE/);
});

test("sluttbehandling har et eksempel uten dato", () => {
  const o = ORDLISTE.find((x) => x.id === "sluttbehandling");
  assert.equal(
    o?.eksempel,
    "Bergen bystyre sluttbehandler reguleringsplanen for Kulturkvartalet Verftet.",
  );
  assert.equal((o?.eksempel ?? "").includes("2026"), false);
  const ord = readFileSync("src/ord.tsx", "utf8");
  assert.match(ord, /forklaringMedLenke\(o\.forklaring, "\/ordliste"\)/);
  assert.doesNotMatch(ord, /\{o\.forklaring\}/);
});

test("siste eksempel er uten skillestrek fra utkastet", () => {
  const o = ORDLISTE.find((x) => x.id === "okonomiplan-og-arsbudsjett");
  assert.equal(
    o?.eksempel,
    "Oslo byråd har lagt fram forslag til budsjett for 2027 og økonomiplan for 2027–2030.",
  );
});
