import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINJE_DELTA, LINJE_INNSPILL } from "../supabase/functions/hent-saker/stortinget-horinger.ts";
import {
  DEMO_MUNTLIG,
  DEMO_SKRIFTLIG,
  FRIST_DELTA_LINJE,
  FRIST_INNSPILL_LINJE,
  erStortingetHoring,
  folgKomiteAktiv,
  horingKnappLenke,
  horingerOmSaken,
  komiteIdFraInstans,
  lagreFulgteKomite,
  lesHoringLinjer,
} from "../src/horing.ts";

test("fristlinjene er de samme i visningen og i adapteren", () => {
  assert.equal(FRIST_DELTA_LINJE, LINJE_DELTA);
  assert.equal(FRIST_INNSPILL_LINJE, LINJE_INNSPILL);
  assert.equal(FRIST_DELTA_LINJE, "Frist for å søke om å delta: ");
  assert.equal(lesHoringLinjer(DEMO_MUNTLIG.sammendrag).some((l) => l.startsWith(FRIST_DELTA_LINJE)), true);
  assert.equal(lesHoringLinjer(DEMO_SKRIFTLIG.sammendrag).some((l) => l.startsWith(FRIST_INNSPILL_LINJE)), true);
});

test("skriftlig høring går til skjemaet, muntlig og ukjent skriftlig til høringssiden", () => {
  assert.equal(
    horingKnappLenke(DEMO_SKRIFTLIG.kilde, DEMO_SKRIFTLIG.sammendrag),
    "https://www.stortinget.no/no/Hva-skjer-pa-Stortinget/Horing/skriv-skriftlig-innspill/?h=10005956",
  );
  assert.equal(
    horingKnappLenke(DEMO_MUNTLIG.kilde, DEMO_MUNTLIG.sammendrag),
    "https://www.stortinget.no/no/Hva-skjer-pa-Stortinget/Horing/horing/?h=10005961",
  );
  assert.equal(
    horingKnappLenke(DEMO_MUNTLIG.kilde, "Høring.\nFrist for skriftlig innspill: 1. november 2026 kl. 12.00."),
    "https://www.stortinget.no/no/Hva-skjer-pa-Stortinget/Horing/horing/?h=10005961",
  );
  assert.equal(erStortingetHoring(DEMO_SKRIFTLIG), true);
  assert.equal(erStortingetHoring({ sakstype: "horing", kilde: "https://www.regjeringen.no/no/dokumenter/x", tittel: "Høring: noe" }), false);
});

test("saken viser at det er høring, og komité leses av instans", () => {
  const saker = [
    { id: "sak", hovedsak_id: null, tittel: "Saken" },
    { id: "h", hovedsak_id: "sak", tittel: "Høring: Saken" },
  ];
  assert.equal(horingerOmSaken("sak", saker).length, 1);
  assert.equal(horingerOmSaken("h", saker).length, 0);
  assert.equal(komiteIdFraInstans("Familie- og kulturkomiteen, Stortinget"), "FAMKULT");
  assert.equal(komiteIdFraInstans("Næringskomiteen, Stortinget"), "NÆRING");
});

test("følg komité er på og skriver egen rad uten e-post", async () => {
  assert.equal(folgKomiteAktiv(), true);
  let tabell = "";
  const ok = await lagreFulgteKomite({
    from: (navn: string) => {
      tabell = navn;
      return { insert: () => ({ error: null }) };
    },
  }, "bruker", "FAMKULT", true);
  assert.equal(ok, true);
  assert.equal(tabell, "fulgte_komiteer");
  const ui = readFileSync(new URL("../src/horing.tsx", import.meta.url), "utf8");
  const tekst = readFileSync(new URL("../src/horing.ts", import.meta.url), "utf8");
  assert.equal(ui.includes("påmeldingsfrist"), false);
  assert.equal(tekst.includes("påmeldingsfrist"), false);
  assert.equal(ui.includes("på vanlig norsk"), false);
  assert.match(ui, /Søk om å delta \/ send innspill på stortinget\.no/);
  assert.match(ui, /Hovedregelen er at kun landsomfattende organisasjoner inviteres\./);
  assert.match(ui, /Det er høring i denne saken\./);
  assert.match(ui, /Følg komiteen/);
  assert.match(ui, /Du følger ingen komiteer/);
  assert.match(ui, /Ingen høringer er registrert for komiteen/);
  assert.match(ui, /Logg inn for å følge komiteen/);
  assert.match(ui, /Vi sender ikke e-post/);
  const personvern = readFileSync("public/personvern.html", "utf8");
  assert.match(personvern, /id="folg-komite"/);
  assert.match(personvern, /bruker-id/);
  assert.match(personvern, /post@kulturvarsling\.no/);
  assert.match(personvern, /Kulturvarsling AS, org\.nr\. 936 282 881, Middelthuns gate 11 B, 0368 Oslo/);
  assert.match(personvern, /artikkel 6 nr\. 1 bokstav b/);
  assert.doesNotMatch(personvern, /Åndsverkstedet/);
  assert.equal(personvern.toLowerCase().includes("på vanlig norsk"), false);
  const flagg = readFileSync("supabase/migrations/20261026100000_folg_komite_pa.sql", "utf8");
  assert.match(flagg, /set aktiv = true/);
  assert.match(flagg, /nokkel = 'folg_komite'/);
  assert.doesNotMatch(flagg, /UTSENDING_AKTIV/);
  const gammel = readFileSync("supabase/migrations/20261024221000_fulgte_komiteer.sql", "utf8");
  assert.match(gammel, /'folg_komite', false/);
  assert.equal(ui.includes("siden forrige besøk"), false);
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const vercel = readFileSync(new URL("../vercel.json", import.meta.url), "utf8");
  assert.doesNotMatch(app, /Knut Storberget|Marianne Lunde|Geir Pollestad|Iselin Nybø|Lorem|Liste over politikere kommer/);
  assert.match(app, /Det finnes ingen politikerliste/);
  assert.match(app, /if \(komiteFraSti\(\)\) return "komite"/);
  assert.match(vercel, /"source": "\/komite\/:id"/);
});
