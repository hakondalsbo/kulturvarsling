import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { sakTrefferAbonnement, sokTrefferSak, mottakereForSak } from "../src/preferanser.ts";
import { KULTURPOLITIKK_VALGBART } from "../src/minside/kulturpolitikk.ts";
import { kategorierForMeny } from "../src/minside/kategorier.ts";
import { delMinSide, TOMT_VALG } from "../src/minside/filter.ts";
import { DEMO_DAG, DEMO_FULGTE, DEMO_KAMPANJER, DEMO_SAKER, DEMO_SOK, DEMO_VALG } from "../src/minside/demo.ts";
import { forslagTilDeg } from "../src/minside/forslag.ts";

const oslo = {
  kategori: "musikk",
  niva: "kommune",
  fylkesnr: "03",
  kommunenr: "0301",
  sted: "Oslo",
  instans: "Oslo kommune",
  kilde: "https://www.oslo.kommune.no/sak",
};

test("kulturpolitikk er av, og menyen tar den ikke med", () => {
  assert.equal(KULTURPOLITIKK_VALGBART, false);
  assert.equal(kategorierForMeny().some((k) => k.id === "kulturpolitikk"), false);
  assert.equal(kategorierForMeny(true).some((k) => k.id === "kulturpolitikk"), true);
  const sql = readFileSync("supabase/migrations/20261024183000_minside_valg.sql", "utf8");
  assert.match(sql, /create or replace function public\.kulturpolitikk_valgbart\(\)[\s\S]*select false/);
});

test("flagget av gjør at kulturpolitikk i fagfelt ikke avgrenser", () => {
  assert.equal(sakTrefferAbonnement({ kategori: "musikk" }, ["kulturpolitikk"], ["land"]), true);
  assert.equal(sakTrefferAbonnement({ kategori: "kulturpolitikk" }, ["musikk"], ["land"]), false);
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

test("forslag til deg bruker sted, fag, fulgt sak og felles innspill", () => {
  const f = forslagTilDeg(DEMO_VALG, DEMO_SAKER, DEMO_FULGTE, DEMO_SOK, DEMO_KAMPANJER, DEMO_DAG, "forside");
  assert.ok(f.folger.includes("Oslo kommune"));
  assert.ok(f.folger.includes("Musikk"));
  assert.ok(f.folger.includes("Familie- og kulturkomiteen"));
  assert.ok(f.folger.some((x) => x.includes("Kulturskole")));
  assert.equal(f.folger.some((x) => /kulturpolitikk/i.test(x)), false);
  assert.deepEqual(f.saker.map((s) => s.id), ["oslo-musikk", "famkult-horing"]);
  assert.equal(f.saker[0].kampanjeTittel, DEMO_KAMPANJER[0].tittel);
  assert.equal(f.saker[1].kampanjeTittel, null);
  assert.equal(f.saker.some((s) => String(s.id).includes("bergen")), false);
  assert.deepEqual(f.snarveier.map((s) => s.id), ["forside", "minside", "varsler", "mobiliser", "innspill"]);
  const tom = forslagTilDeg(TOMT_VALG, DEMO_SAKER, [], [], [], DEMO_DAG, "minside");
  assert.equal(tom.saker.length, 0);
  assert.match(tom.setning, /Velg sted og fag/);
  const tekst = readFileSync("src/minside/Personlig.tsx", "utf8") + readFileSync("src/minside/forslag.ts", "utf8");
  assert.doesNotMatch(tekst, /premium|stripe|på vanlig norsk/i);
});

test("migrasjonen gir kolonne-grant, RLS og ingen anon-skriving", () => {
  const filer = readdirSync("supabase/migrations").filter((f) => f.includes("minside"));
  assert.deepEqual(filer, ["20261024183000_minside_valg.sql"]);
  assert.ok(filer[0] > "20261024163600");
  const sql = readFileSync("supabase/migrations/20261024183000_minside_valg.sql", "utf8");
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
