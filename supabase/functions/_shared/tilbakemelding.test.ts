import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEMO_TILBAKEMELDINGER,
  cooldownIgjen,
  erAdminEpost,
  erManglendeKolonne,
  filtrerRader,
  forsokLagre,
  lesAdminKall,
  leverTilbakemelding,
  tekstMedKontekst,
  validerTilbakemelding,
} from "./tilbakemelding.ts";

const gyldig = {
  type: "forslag",
  tekst: "Fristen bør stå ved tittelen.",
  side: "/arkiv",
  sak_tittel: "Kulturloven",
  sak_id: "famkult-horing",
};

test("kategorier og lengde valideres før lagring", () => {
  const ok = validerTilbakemelding(gyldig);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.verdi.type, "forslag");
    assert.equal(ok.verdi.side, "/arkiv");
    assert.equal(ok.verdi.sakTittel, "Kulturloven");
  }
  assert.equal(validerTilbakemelding({ ...gyldig, type: "pris" }).ok, false);
  assert.equal(validerTilbakemelding({ ...gyldig, tekst: "kort" }).ok, false);
  assert.equal(validerTilbakemelding({ ...gyldig, tekst: "x".repeat(2001) }).ok, false);
  assert.equal(validerTilbakemelding({ ...gyldig, side: "https://ond.example" }).ok, false);
  assert.equal(validerTilbakemelding({ ...gyldig, sak_id: "../hemmelig" }).ok, false);
});

test("cooldown og manglende kolonne", () => {
  assert.equal(cooldownIgjen(1_000, null), 0);
  assert.equal(cooldownIgjen(10_000, 0), 10_000);
  assert.equal(cooldownIgjen(25_000, 10_000), 5_000);
  assert.equal(cooldownIgjen(40_000, 10_000), 0);
  assert.equal(erManglendeKolonne("Could not find the 'side' column of 'feedback' in the schema cache"), true);
  assert.equal(erManglendeKolonne("permission denied"), false);
});

test("fallbacktekst beholder siden når kolonnen mangler", () => {
  const ok = validerTilbakemelding(gyldig);
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  const tekst = tekstMedKontekst(ok.verdi);
  assert.match(tekst, /^Side: \/arkiv/);
  assert.match(tekst, /Sak: Kulturloven/);
  assert.match(tekst, /Sak-id: famkult-horing/);
  assert.match(tekst, /Fristen bør stå/);
});

test("admin-epost krever bekreftet treff i listen, aldri metadata", () => {
  const liste = " Ada@Kulturvarsling.no , team@example.com ";
  assert.equal(erAdminEpost("ada@kulturvarsling.no", liste, true), true);
  assert.equal(erAdminEpost("ada@kulturvarsling.no", liste, false), false);
  assert.equal(erAdminEpost("andre@kulturvarsling.no", liste, true), false);
  assert.equal(erAdminEpost("ada@kulturvarsling.no", "", true), false);
  assert.equal(erAdminEpost("ada@kulturvarsling.no", null, true), false);
  assert.equal(erAdminEpost("ada@kulturvarsling.no.evil.test", liste, true), false);
});

test("oversikt filtrerer status og type, og avviser ugyldig kall", () => {
  assert.equal(filtrerRader(DEMO_TILBAKEMELDINGER, { status: "ny" }).length, 1);
  assert.equal(filtrerRader(DEMO_TILBAKEMELDINGER, { type: "feil" })[0].sak_tittel?.includes("kulturloven"), true);
  const liste = lesAdminKall({ handling: "list", status: "sett", type: "" });
  assert.equal("handling" in liste && liste.handling, "list");
  const endring = lesAdminKall({ handling: "status", id: "11111111-1111-4111-8111-111111111111", status: "lost" });
  assert.equal("handling" in endring && endring.handling, "status");
  assert.equal("feil" in lesAdminKall({ handling: "status", id: "ikke", status: "ny" }), true);
  assert.equal("feil" in lesAdminKall({ handling: "list", status: "ferdig" }), true);
});

test("lagring prøver gamle kolonner når side-kolonnen mangler", async () => {
  const ok = validerTilbakemelding(gyldig);
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  const forsok: Record<string, unknown>[] = [];
  const utfall = await forsokLagre({
    insert: async (rad) => {
      forsok.push(rad);
      if ("side" in rad) return { error: { message: "column side does not exist" } };
      return { error: null };
    },
  }, ok.verdi, null);
  assert.equal(utfall, "ok");
  assert.equal(forsok.length, 2);
  assert.equal("side" in forsok[1], false);
  assert.match(String(forsok[1].tekst), /Side: \/arkiv/);
});

test("klienten faller tilbake ved 404 og stopper ved 429", async () => {
  const kall: string[] = [];
  const hent = async (url: string) => {
    kall.push(url);
    if (url.includes("/functions/")) {
      return new Response(JSON.stringify({ ok: false, feil: "mangler" }), { status: 404 });
    }
    return new Response(null, { status: 201 });
  };
  const direkte = await leverTilbakemelding({
    hent,
    supabaseUrl: "https://eksempel.supabase.co",
    anonNokkel: "anon",
    token: null,
    brukerId: null,
    innlegg: gyldig,
    nå: 100_000,
    sistSendt: 0,
  });
  assert.deepEqual(direkte, { ok: true, kanal: "direkte" });
  assert.equal(kall.length, 2);
  assert.match(kall[1], /\/rest\/v1\/feedback$/);

  const stopp = await leverTilbakemelding({
    hent: async () => new Response(JSON.stringify({ feil: "vent" }), { status: 429 }),
    supabaseUrl: "https://eksempel.supabase.co",
    anonNokkel: "anon",
    token: "jwt",
    brukerId: "bruker",
    innlegg: gyldig,
    nå: 100_000,
    sistSendt: 0,
  });
  assert.equal(stopp.ok, false);
  if (!stopp.ok) assert.equal(stopp.melding, "vent");
});

test("migrasjonen gir ikke vanlige brukere lesetilgang", () => {
  const sql = readFileSync("supabase/migrations/20261113140000_tilbakemelding_kontekst.sql", "utf8");
  assert.match(sql, /revoke select, update, delete, truncate on table public\.feedback from public, anon, authenticated/);
  assert.match(sql, /grant insert on table public\.feedback to anon, authenticated/);
  assert.doesNotMatch(sql, /create policy "[^"]+" on public\.feedback\s+for select/i);
  assert.match(sql, /side text/);
  assert.match(sql, /sak_id text/);
  assert.match(sql, /'ny', 'sett', 'planlagt', 'lost', 'avvist'/);
});

test("oversiktsfunksjonen leser e-post fra auth, ikke fra klienten", () => {
  const kilde = readFileSync("supabase/functions/tilbakemeldinger/index.ts", "utf8");
  assert.match(kilde, /erAdminEpost\(bruker\.email/);
  assert.match(kilde, /ADMIN_EPOSTER/);
  assert.match(kilde, /email_confirmed_at/);
  assert.doesNotMatch(kilde, /user_metadata/);
  assert.doesNotMatch(kilde, /@kulturvarsling\.no/);
});
