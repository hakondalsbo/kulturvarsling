import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  finnUdokumenterteTall,
  kildegrunnlag,
  lagreTallSperring,
  loggUdokumenterteTall,
  publiseresEtterKontroll,
  sperringForTall,
} from "./kildekontroll.ts";

test("årstall og beløp som står i kilden flagges ikke", () => {
  const kilde = "2 søknader innvilget, til sammen 360 000 kr, søknadsfrist 2026-02-20. Størst: Konsert (250 000 kr).";
  const sammendrag = "To søknader fikk til sammen 360000 kroner i runden 20. februar 2026. Den største var på 250.000 kr.";
  assert.deepEqual(finnUdokumenterteTall(sammendrag, kilde), { aar: [], tall: [] });
});

test("oppfunnet årstall og beløp flagges", () => {
  const kilde = "Ny reguleringsplan – Rogaland Teater og Stavanger museum";
  const sammendrag = "Stavanger kommune vil omregulere tomten der byens viktigste uavhengige kulturbygg ligger. Forslaget åpner for boligbygging og vil effektivt avvikle lokalet innen 2027.";
  assert.deepEqual(finnUdokumenterteTall(sammendrag, kilde), { aar: ["2027"], tall: [] });

  const medBelop = finnUdokumenterteTall(
    "Ordningen økes med 374 millioner kroner i 2027.",
    "Kulturrådet innvilget 13 søknader i 2026.",
  );
  assert.deepEqual(medBelop, { aar: ["2027"], tall: ["374"] });
});

test("desimaltall og datoer som står i kilden flagges ikke", () => {
  assert.deepEqual(
    finnUdokumenterteTall("Bevilgningen er 28,1 milliarder.", "ei løyving på 28.1 milliardar"),
    { aar: [], tall: [] },
  );
  assert.deepEqual(
    finnUdokumenterteTall("Fristen er 1. mars 2026.", "soknadsfrist 2026-03-01"),
    { aar: [], tall: [] },
  );
  assert.deepEqual(
    finnUdokumenterteTall("Møtet er 24.03.2026.", "Møtedato 24.03.2026."),
    { aar: [], tall: [] },
  );
});

test("tomt eller ikke-streng input gir ingen avvik", () => {
  assert.deepEqual(finnUdokumenterteTall("", "2026"), { aar: [], tall: [] });
  assert.deepEqual(finnUdokumenterteTall(null, undefined), { aar: [], tall: [] });
  assert.equal(kildegrunnlag(["Tittel", null, "  ", "Frist 2026-03-01"]), "Tittel\nFrist 2026-03-01");
});

test("logging flagger uten å kaste, og lar være når alt står i kilden", () => {
  const linjer: string[] = [];
  const avvik = loggUdokumenterteTall(
    "hent-saker",
    "Lokalet avvikles innen 2027.",
    "Ny reguleringsplan – Rogaland Teater og Stavanger museum",
    "https://www.stavanger.kommune.no/nytt-teater-og-museum/",
    (linje) => linjer.push(linje),
  );
  assert.deepEqual(avvik.aar, ["2027"]);
  assert.equal(linjer.length, 1);
  const payload = JSON.parse(linjer[0]);
  assert.equal(payload.hendelse, "tall_uten_kilde");
  assert.deepEqual(payload.aar, ["2027"]);
  assert.equal(payload.referanse.includes("stavanger.kommune.no"), true);
  assert.equal(linjer[0].includes("byens viktigste"), false);

  const stille: string[] = [];
  loggUdokumenterteTall("hent-saker", "Frist 2026.", "Frist 2026.", "x", (linje) => stille.push(linje));
  assert.deepEqual(stille, []);
});

test("sperret sak får varsel-id og årsak tall_uten_kilde", async () => {
  assert.equal(sperringForTall("id-1", "hent-saker", { aar: [], tall: [] }), null);
  const rad = sperringForTall("11111111-1111-4111-8111-111111111111", "hent-saker", {
    aar: ["2027"],
    tall: ["374"],
  });
  assert.deepEqual(rad, {
    varsel_id: "11111111-1111-4111-8111-111111111111",
    arsak: "tall_uten_kilde",
    oppgave: "hent-saker",
    detalj: { aar: ["2027"], tall: ["374"] },
  });
  assert.equal(JSON.stringify(rad).includes("Rogaland"), false);

  const skrevet: unknown[] = [];
  const feil = await lagreTallSperring({
    from: (tabell) => ({
      upsert: async (inn, opts) => {
        skrevet.push({ tabell, inn, opts });
        return { error: null };
      },
    }),
  }, "11111111-1111-4111-8111-111111111111", "klartekst", { aar: ["2027"], tall: [] });
  assert.equal(feil, null);
  assert.equal(skrevet.length, 1);
  const forste = skrevet[0] as { tabell: string; opts: { onConflict: string; ignoreDuplicates: boolean } };
  assert.equal(forste.tabell, "varsel_sperringer");
  assert.equal(forste.opts.onConflict, "varsel_id,arsak,oppgave");
  assert.equal(forste.opts.ignoreDuplicates, true);

  const stille = await lagreTallSperring({
    from: () => ({ upsert: async () => { throw new Error("skulle ikke kalles"); } }),
  }, "x", "hent-saker", { aar: [], tall: [] });
  assert.equal(stille, null);
});

test("varsel_sperringer er ny tabell, ikke en kolonne på kilde_kjoringer", () => {
  const sql = readFileSync("supabase/migrations/20261026223000_varsel_sperringer.sql", "utf8");
  assert.match(sql, /create table public\.varsel_sperringer/);
  assert.match(sql, /arsak = 'tall_uten_kilde'/);
  assert.match(sql, /varsel_id uuid not null references public\.varsler/);
  assert.match(sql, /unique \(varsel_id, arsak, oppgave\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.varsel_sperringer from anon/);
  assert.match(sql, /grant select, insert on table public\.varsel_sperringer to service_role/);
  assert.match(sql, /revoke update, delete, truncate, references, trigger/);
  assert.match(sql, /from service_role/);
  assert.equal(/create policy/i.test(sql), false);
  assert.equal(sql.includes("kilde_kjoringer"), true);
  assert.equal(/alter table public\.kilde_kjoringer/.test(sql), false);
});

test("tall uten kilde holdes upublisert, og rene sammendrag publiseres", () => {
  const flagget = finnUdokumenterteTall(
    "Lokalet avvikles innen 2027.",
    "Ny reguleringsplan – Rogaland Teater og Stavanger museum",
  );
  assert.equal(publiseresEtterKontroll(flagget), false);
  assert.equal(publiseresEtterKontroll({ aar: [], tall: ["374"] }), false);
  assert.equal(publiseresEtterKontroll({ aar: [], tall: [] }), true);
});
