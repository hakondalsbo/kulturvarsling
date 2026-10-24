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

test("følg komité er av og spør ikke databasen", async () => {
  assert.equal(folgKomiteAktiv(), false);
  let kalt = false;
  const ok = await lagreFulgteKomite({
    from: () => {
      kalt = true;
      return {};
    },
  }, "bruker", "FAMKULT", true);
  assert.equal(ok, false);
  assert.equal(kalt, false);
  const ui = readFileSync(new URL("../src/horing.tsx", import.meta.url), "utf8");
  const tekst = readFileSync(new URL("../src/horing.ts", import.meta.url), "utf8");
  assert.equal(ui.includes("påmeldingsfrist"), false);
  assert.equal(tekst.includes("påmeldingsfrist"), false);
  assert.equal(ui.includes("på vanlig norsk"), false);
  assert.match(ui, /Søk om å delta \/ send innspill på stortinget\.no/);
  assert.match(ui, /Hovedregelen er at kun landsomfattende organisasjoner inviteres\./);
  assert.match(ui, /Det er høring i denne saken\./);
  assert.match(ui, /Følg komiteen/);
  assert.equal(ui.includes("siden forrige besøk"), false);
});
