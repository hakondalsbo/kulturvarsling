import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { sakTrefferAbonnement, sokTrefferSak, mottakereForSak } from "../src/preferanser.ts";
import { KULTURPOLITIKK_VALGBART } from "../src/minside/kulturpolitikk.ts";
import { kategorierForMeny } from "../src/minside/kategorier.ts";
import { delMinSide, TOMT_VALG } from "../src/minside/filter.ts";
import { DEMO_DAG, DEMO_FULGTE, DEMO_SAKER, DEMO_SOK, DEMO_VALG, demoTillatt, tolkDemo } from "../src/minside/demo.ts";
import { boksForForside } from "../src/minside/forslag.ts";

const oslo = {
  kategori: "musikk",
  niva: "kommune",
  fylkesnr: "03",
  kommunenr: "0301",
  sted: "Oslo",
  instans: "Oslo kommune",
  kilde: "https://www.oslo.kommune.no/sak",
};

test("?demo= er av i production og på i preview", () => {
  assert.equal(demoTillatt("production"), false);
  assert.equal(demoTillatt("preview"), true);
  assert.equal(demoTillatt("development"), true);
  assert.equal(demoTillatt(""), true);
  assert.equal(demoTillatt(undefined), true);
  const sok = "?demo=forside&steg=2&endre=1";
  assert.equal(tolkDemo(sok, "production").modus, null);
  assert.equal(tolkDemo(sok, "production").endre, false);
  assert.equal(tolkDemo(sok, "preview").modus, "forside");
  assert.equal(tolkDemo(sok, "preview").steg, 2);
  assert.equal(tolkDemo(sok, "preview").endre, true);
  assert.equal(tolkDemo("?demo=oppsett", undefined).modus, "oppsett");
});

test("kulturpolitikk er valgbart, og den gamle migrasjonen er urørt", () => {
  assert.equal(KULTURPOLITIKK_VALGBART, true);
  assert.equal(kategorierForMeny().some((k) => k.id === "kulturpolitikk"), true);
  assert.equal(kategorierForMeny(false).some((k) => k.id === "kulturpolitikk"), false);
  const gammel = readFileSync("supabase/migrations/20261024200000_minside_valg.sql", "utf8");
  assert.match(gammel, /create or replace function public\.kulturpolitikk_valgbart\(\)[\s\S]*select false/);
  const ny = readFileSync("supabase/migrations/20261026100100_kulturpolitikk_valgbart.sql", "utf8");
  assert.match(ny, /select true/);
  assert.doesNotMatch(ny, /UTSENDING_AKTIV/);
  const app = readFileSync("src/App.tsx", "utf8");
  assert.match(app, /const KATEGORIER = kategorierForMeny\(\)/);
  const ui = readFileSync("src/minside/MinSide.tsx", "utf8");
  const sok = ui.indexOf("Søk etter sted");
  const nasjonalt = ui.indexOf(">Nasjonalt<");
  assert.ok(sok > 0 && nasjonalt > sok);
});

test("flagget av gjør at kulturpolitikk i fagfelt ikke avgrenser", () => {
  assert.equal(
    sakTrefferAbonnement({ kategori: "musikk" }, ["kulturpolitikk"], ["land"], { kulturpolitikkValgbart: false }),
    true,
  );
  assert.equal(
    sakTrefferAbonnement({ kategori: "kulturpolitikk" }, ["musikk"], ["land"], { kulturpolitikkValgbart: false }),
    false,
  );
  assert.equal(
    sakTrefferAbonnement({ kategori: "musikk" }, ["kulturpolitikk"], ["land"], { kulturpolitikkValgbart: true }),
    false,
  );
  assert.equal(
    sakTrefferAbonnement({ kategori: "kulturpolitikk" }, ["kulturpolitikk"], ["land"], { kulturpolitikkValgbart: true }),
    true,
  );
});

test("fylkeskommune matcher ikke kommunesaker, fylke-tokenet gjør det", () => {
  const bergen = { ...oslo, niva: "kommune", fylkesnr: "46", kommunenr: "4601", sted: "Bergen", instans: "Bergen kommune" };
  const vestland = { ...oslo, niva: "fylke", fylkesnr: "46", kommunenr: null, sted: "Vestland", instans: "Vestland fylkeskommune" };
  assert.equal(sakTrefferAbonnement(bergen, [], ["fylkeskommune:46"]), false);
  assert.equal(sakTrefferAbonnement(vestland, [], ["fylkeskommune:46"]), true);
  assert.equal(sakTrefferAbonnement(bergen, [], ["fylke:46"]), true);
  assert.equal(sakTrefferAbonnement(oslo, ["musikk"], ["kommune:0301", "sted:oslo"]), true);
  assert.equal(sakTrefferAbonnement(bergen, ["musikk"], ["kommune:0301", "sted:oslo"]), false);
});

test("Oslo eller Stortinget, og fag avgrenser begge", () => {
  const storting = {
    kategori: "musikk",
    niva: "nasjonalt",
    instans: "Familie- og kulturkomiteen, Stortinget",
    kilde: "https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=1",
  };
  const dans = { ...storting, kategori: "dans" };
  const ekstra = { organ: ["stortinget"], komiteer: ["famkult"] };
  assert.equal(sakTrefferAbonnement(oslo, ["musikk"], ["kommune:0301"], ekstra), true);
  assert.equal(sakTrefferAbonnement(storting, ["musikk"], ["kommune:0301"], ekstra), true);
  assert.equal(sakTrefferAbonnement(dans, ["musikk"], ["kommune:0301"], ekstra), false);
  assert.equal(sakTrefferAbonnement(
    { kategori: "musikk", niva: "nasjonalt", instans: "KUD – høring", kilde: "https://www.regjeringen.no/no/dokumenter/x" },
    ["musikk"],
    [],
    { organ: ["regjeringen"] },
  ), true);
});

test("lagret søk og fulgt sak slås sammen, uten å sende e-post", () => {
  const sak = { id: "1", tittel: "Kulturskole i Trondheim", kategori: "kulturarv", niva: "kommune", kommunenr: "5001" };
  assert.equal(sokTrefferSak(sak, "kulturskole"), true);
  assert.equal(sokTrefferSak(sak, "  "), false);
  const mottakere = mottakereForSak(
    sak,
    [{ id: "a", epost: "a@example.com", varsel_frekvens: "daglig", varsler_aktive: false, fagfelt: ["musikk"], geografisk: ["kommune:0301"] }],
    [],
    [{ brukerId: "a", sporretekst: "kulturskole" }],
  );
  assert.deepEqual(mottakere.map((m) => [m.brukerId, m.grunn]), [["a", "sok"]]);
});

test("demo-feeden viser mobiliser, handling, frist, strøm og fulgt sak", () => {
  const deler = delMinSide(DEMO_SAKER, DEMO_VALG, DEMO_FULGTE, DEMO_SOK, DEMO_DAG);
  assert.deepEqual(deler.mobiliser.map((s) => s.id), ["oslo-musikk", "famkult-horing", "vestland-scene"]);
  assert.deepEqual(deler.handling.map((s) => s.id), ["regjeringen-frist"]);
  assert.deepEqual(deler.frister.map((s) => s.id), ["kulturskole-trd"]);
  assert.deepEqual(deler.strom.map((s) => s.id), ["oslo-referat", "fulgt-bodo"]);
  assert.deepEqual(deler.fulgte.map((s) => s.id), ["fulgt-bodo"]);
  assert.equal(deler.alle.some((s) => s.id === "bergen-dans"), false);
  const tom = delMinSide(DEMO_SAKER, TOMT_VALG, [], [], DEMO_DAG);
  assert.equal(tom.alle.length, 0);
});

test("forsideboksen er kort og hopper over avisens hovedsak", () => {
  const linjer = boksForForside(DEMO_VALG, DEMO_SAKER, DEMO_FULGTE, DEMO_SOK, DEMO_DAG);
  assert.ok(linjer.length >= 3 && linjer.length <= 4);
  assert.equal(linjer.some((s) => s.id === "oslo-musikk"), false);
  assert.equal(linjer.some((s) => String(s.id).includes("bergen")), false);
  assert.ok(linjer.some((s) => s.id === "famkult-horing"));
  assert.equal(linjer[0].rolle, "handling");
  const tom = boksForForside(TOMT_VALG, DEMO_SAKER, [], [], DEMO_DAG);
  assert.equal(tom.length, 0);
  const tekst = readFileSync("src/minside/Personlig.tsx", "utf8") + readFileSync("src/avis.tsx", "utf8");
  assert.doesNotMatch(tekst, /premium|stripe|på vanlig norsk/i);
  assert.equal(tekst.includes("foretrekk"), false);
  assert.match(tekst, /Se alt på Min side/);
});

test("migrasjonen gir kolonne-grant, RLS og ingen anon-skriving", () => {
  const filer = readdirSync("supabase/migrations").filter((f) => f.includes("minside"));
  assert.deepEqual(filer, ["20261024200000_minside_valg.sql"]);
  assert.ok(filer[0] > "20261024190000");
  const sql = readFileSync("supabase/migrations/20261024200000_minside_valg.sql", "utf8");
  assert.match(sql, /grant update \(organ, komiteer, minside_klar\) on table public\.profiler to authenticated/);
  assert.match(sql, /revoke update \(organ, komiteer, minside_klar\) on table public\.profiler from anon/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /\(select auth\.uid\(\)\) = bruker_id/);
  assert.match(sql, /revoke all on table public\.lagrede_sok from anon/);
  assert.doesNotMatch(sql, /grant [^;]*to anon/);
  assert.doesNotMatch(sql, /UTSENDING_AKTIV/);
  assert.doesNotMatch(sql, /stripe/i);
  assert.match(sql, /fylkeskommune/);
});
