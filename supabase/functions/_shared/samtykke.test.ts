import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KILDE_GAMMEL_LISTE,
  PERSONVERN_VERSJON,
  SAMTYKKE_VERSJON,
  bekreftelsesutfall,
  erBlokkert,
  erGyldigEpost,
  erOneClick,
  erUuid,
  filtrerMottakere,
  hemmeligheterStemmer,
  lesToken,
  listUnsubscribeHeaders,
  opphavTillatt,
  skalSkriveAvmelding,
  svarEtterSkriving,
  utsendelsesModus,
  validerPamelding,
} from "./samtykke.ts";

const TOKEN = "11111111-1111-4111-8111-111111111111";

test("samtykke krever avkrysning, kjent versjon og ekte e-post", () => {
  assert.equal(validerPamelding({ samtykke: false, epost: "a@b.no", samtykke_tekst_versjon: SAMTYKKE_VERSJON }).ok, false);
  assert.equal(validerPamelding({ samtykke: "true", epost: "a@b.no", samtykke_tekst_versjon: SAMTYKKE_VERSJON }).ok, false);
  const utdatert = validerPamelding({ samtykke: true, epost: "a@b.no", samtykke_tekst_versjon: "gammel" });
  assert.equal(utdatert.ok, false);
  const ok = validerPamelding({
    samtykke: true,
    epost: "  Ada@Example.NO ",
    fornavn: "Ada",
    etternavn: "Lovelace",
    samtykke_tekst_versjon: SAMTYKKE_VERSJON,
  });
  assert.equal(ok.ok && !ok.bot && ok.verdi.epost, "ada@example.no");
  assert.equal(erGyldigEpost("ikke-en-epost"), false);
});

test("honeypot later som den lykkes uten å være en ekte påmelding", () => {
  const bot = validerPamelding({
    samtykke: true,
    epost: "a@b.no",
    samtykke_tekst_versjon: SAMTYKKE_VERSJON,
    kv_hp_felt: "http://spam",
  });
  assert.deepEqual(bot, { ok: true, bot: true });
});

test("rate limit og opphav", () => {
  assert.equal(erBlokkert(4, 19), false);
  assert.equal(erBlokkert(5, 0), true);
  assert.equal(erBlokkert(0, 20), true);
  assert.equal(opphavTillatt(null), true);
  assert.equal(opphavTillatt("https://kulturvarsling.no"), true);
  assert.equal(opphavTillatt("http://localhost:8080"), true);
  assert.equal(opphavTillatt("https://ond-side.example"), false);
});

test("avmelding skrives bare ved POST og krever uuid", () => {
  assert.equal(skalSkriveAvmelding("GET"), false);
  assert.equal(skalSkriveAvmelding("POST"), true);
  assert.equal(erUuid(TOKEN), true);
  assert.equal(erUuid("epost@example.no"), false);
  const url = new URL(`https://example.test/avmeld?t=${TOKEN}`);
  assert.equal(lesToken(url, "List-Unsubscribe=One-Click", "application/x-www-form-urlencoded"), TOKEN);
  assert.equal(lesToken(new URL("https://example.test/avmeld"), JSON.stringify({ token: TOKEN }), "application/json"), TOKEN);
});

test("gammel bekreftelseslenke gjør ikke om en avmelding", () => {
  assert.equal(bekreftelsesutfall({
    bekreftet_at: "2026-10-01T00:00:00.000Z",
    avmeldt_at: "2026-10-02T00:00:00.000Z",
    samtykke_gitt_at: "2026-10-01T00:00:00.000Z",
  }), "avmeldt");
  assert.equal(bekreftelsesutfall({
    bekreftet_at: null,
    avmeldt_at: "2026-10-02T00:00:00.000Z",
    samtykke_gitt_at: "2026-10-03T00:00:00.000Z",
  }), "bekreft");
  assert.equal(bekreftelsesutfall({
    bekreftet_at: "2026-10-01T00:00:00.000Z",
    avmeldt_at: null,
    samtykke_gitt_at: "2026-10-01T00:00:00.000Z",
  }), "allerede");
  assert.equal(bekreftelsesutfall({
    bekreftet_at: null,
    avmeldt_at: null,
    samtykke_gitt_at: "2026-10-01T00:00:00.000Z",
  }), "bekreft");
});

test("skrivefeil blir aldri suksess", () => {
  assert.deepEqual(svarEtterSkriving(null), { ok: true });
  assert.equal(svarEtterSkriving("permission denied").ok, false);
});

test("utsendelse krever hemmelighet og når bare kvalifiserte adresser", () => {
  assert.equal(hemmeligheterStemmer("anon-nokkel", "hemmelig"), false);
  assert.equal(hemmeligheterStemmer(null, "hemmelig"), false);
  assert.equal(hemmeligheterStemmer("hemmelig", "hemmelig"), true);
  assert.equal(utsendelsesModus({}), "avvist");
  assert.equal(utsendelsesModus({ test: true }), "test");
  assert.equal(utsendelsesModus({ til: "meg@example.no" }), "en");
  assert.equal(utsendelsesModus({ til: "ikke-epost" }), "avvist");
  assert.equal(utsendelsesModus({ bekreft: "send" }), "alle");

  const mottakere = filtrerMottakere([
    { id: 2, epost: "Ada@Example.no", avmeldings_token: TOKEN, samtykke_gitt_at: "t", bekreftet_at: "t", avmeldt_at: null },
    { id: 1, epost: " ada@example.no ", avmeldings_token: "22222222-2222-4222-8222-222222222222", samtykke_gitt_at: "t", bekreftet_at: "t", avmeldt_at: null },
    { id: 3, epost: "gammel@example.no", avmeldings_token: null, samtykke_gitt_at: null, bekreftet_at: null, avmeldt_at: null },
    { id: 4, epost: "av@example.no", avmeldings_token: TOKEN, samtykke_gitt_at: "t", bekreftet_at: "t", avmeldt_at: "t" },
    { id: 5, epost: "venter@example.no", avmeldings_token: TOKEN, samtykke_gitt_at: "t", bekreftet_at: null, avmeldt_at: null },
  ]);
  assert.deepEqual(mottakere.map((rad) => rad.epost), ["ada@example.no"]);
  assert.equal(mottakere[0].id, 1);
});

test("List-Unsubscribe-headerne følger RFC 8058", () => {
  const hoder = listUnsubscribeHeaders("https://example.test/functions/v1/avmeld?t=" + TOKEN);
  assert.match(hoder["List-Unsubscribe"], /<https:\/\/example\.test\/functions\/v1\/avmeld\?t=/);
  assert.match(hoder["List-Unsubscribe"], /<mailto:avmelding@kulturvarsling\.no\?subject=avmeld>/);
  assert.equal(hoder["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

test("migrasjonen er additiv og backfyller ikke listen", () => {
  const sql = readFileSync("supabase/migrations/20261019233000_samtykke_avmelding.sql", "utf8");
  assert.match(sql, /samtykke_gitt_at/);
  assert.match(sql, /avmeldings_token/);
  assert.match(sql, /nyhetsbrev_utsendelser/);
  assert.match(sql, new RegExp(KILDE_GAMMEL_LISTE));
  assert.match(sql, /drop policy if exists "Åpen påmelding"/);
  assert.match(sql, /revoke all on table public\.pamelding from anon, authenticated/);
  assert.doesNotMatch(sql, /update\s+(public\.)?pamelding/i);
  assert.match(sql, /personvern_akseptert_at/);
});

test("ventesiden har ekte samtykkeboks og ingen anon-nøkkel", () => {
  const html = readFileSync("public/vente.html", "utf8");
  const boks = html.match(/<input[^>]*id="samtykke"[^>]*>/)?.[0] ?? "";
  assert.match(boks, /type="checkbox"/);
  assert.match(boks, /required/);
  assert.doesNotMatch(boks, /\schecked\b/);
  assert.match(html, new RegExp(SAMTYKKE_VERSJON));
  assert.match(html, /href="\/personvern"/);
  assert.match(html, /functions\/v1\/meld-pa/);
  assert.doesNotMatch(html, /rest\/v1\/pamelding/);
  assert.doesNotMatch(html, /eyJ/);
  assert.match(html, /data\.ok === true/);
});

test("one-click krever akkurat List-Unsubscribe=One-Click", () => {
  assert.equal(erOneClick("List-Unsubscribe=One-Click", "application/x-www-form-urlencoded"), true);
  assert.equal(erOneClick("{}", "application/json"), false);
});

test("personvernsiden dekker pliktene og har synlige plassholdere", () => {
  const html = readFileSync("public/personvern.html", "utf8");
  const css = readFileSync("public/papir.css", "utf8");
  for (const del of ["Nyhetsbrev", "Varsler", "Konto", "Behandlingsgrunnlag", "Lagringstid", "Dine rettigheter", "Kontakt"]) {
    assert.match(html, new RegExp(del));
  }
  assert.match(html, /PLASSHOLDER – fyll inn juridisk navn/);
  assert.match(html, /PLASSHOLDER – fyll inn org\.nr\./);
  assert.match(html, new RegExp(PERSONVERN_VERSJON));
  assert.match(html, /papir\.css/);
  assert.match(css, /Newsreader/);
  assert.match(css, /Libre Franklin/);
  assert.match(css, /#FBF8F2/i);
});

test("avmelding og bekreftelse viser ikke suksess før svaret er ok", () => {
  for (const fil of ["public/avmelding.html", "public/bekreft.html"]) {
    const html = readFileSync(fil, "utf8");
    assert.match(html, /data\.ok === true/);
    assert.doesNotMatch(html, /Du er meldt av/);
    assert.match(html, /Ingenting er endret/);
  }
});

test("appen lagrer samtykket og sletter via funksjonen", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  assert.match(app, /type="checkbox"/);
  assert.match(app, /personvern_akseptert_at/);
  assert.match(app, /personvern_versjon:\s*PERSONVERN_VERSJON/);
  assert.match(app, /if\s*\(\s*!samtykke\s*\)\s*return/);
  assert.match(app, /functions\.invoke\(\s*"slett-konto"/);
  assert.match(app, /!\s*data\?\.ok/);
});

test("nyhetsbrev kan ikke trigges med anon-nøkkelen alene", () => {
  const kilde = readFileSync("supabase/functions/nyhetsbrev/index.ts", "utf8");
  const config = readFileSync("supabase/config.toml", "utf8");
  assert.match(kilde, /x-nyhetsbrev-nokkel/);
  assert.match(kilde, /filtrerMottakere/);
  assert.match(kilde, /List-Unsubscribe/);
  assert.match(kilde, /nyhetsbrev_utsendelser/);
  assert.match(kilde, /Adressen er ikke bekreftet, samtykkende og aktiv/);
  assert.doesNotMatch(kilde, /avmeldings_token:\s*data\?/);
  assert.doesNotMatch(kilde, /avmeldt:\s*true/);
  assert.match(config, /\[functions\.avmeld\]\s+verify_jwt = false/);
  assert.match(config, /\[functions\.meld-pa\]\s+verify_jwt = false/);
  assert.match(config, /\[functions\.slett-konto\]\s+verify_jwt = true/);
});
