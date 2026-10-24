import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  BEKREFTELSE_PAUSE_MS,
  FORHANDSVISNING_TOKEN,
  HISTORISK_VERSJON,
  KILDE_GAMMEL_LISTE,
  MAKS_BEKREFTELSER_PER_KALL,
  PERSONVERN_VERSJON,
  SAMTYKKE_VERSJON,
  bekreftelsesutfall,
  erBlokkert,
  erGyldigEpost,
  erOneClick,
  erUuid,
  dryRunLogg,
  feltVedBekreftelse,
  filtrerMottakere,
  fyllLanseringsmal,
  hemmeligheterStemmer,
  lagEpost,
  lesBekreftelsesOppdrag,
  lesToken,
  loggNarResendMangler,
  malErUtkast,
  parseLanseringsmal,
  MELDING_VENTENDE_BEKREFTELSE,
  listUnsubscribeHeaders,
  opphavTillatt,
  oppsummerHopp,
  planleggUtsendelse,
  skalSkriveAvmelding,
  svarAlleredeRegistrert,
  svarEtterLagretPamelding,
  svarEtterSkriving,
  velgLanseringsmottakere,
  velgVentendeBekreftelser,
  utsendingErAktiv,
  utsendelsesBeslutning,
  utsendelsesModus,
  validerPamelding,
} from "./samtykke.ts";
import { join } from "node:path";
import { PERSONVERN_URL, avsender, behandlingsansvarlig, bunntekst, lesAvsender, orgnr, poststed } from "./organisasjon.ts";
import { LANSERING_MAL } from "../send-bekreftelser/lansering.mal.ts";

const TOKEN = "11111111-1111-4111-8111-111111111111";
const LEVERT = "delivered@resend.dev";

test("samtykke krever avkrysning, kjent versjon og ekte e-post", () => {
  assert.equal(validerPamelding({ samtykke: false, epost: "a@b.no", samtykke_tekst_versjon: SAMTYKKE_VERSJON }).ok, false);
  assert.equal(validerPamelding({ samtykke: "true", epost: "a@b.no", samtykke_tekst_versjon: SAMTYKKE_VERSJON }).ok, false);
  const utdatert = validerPamelding({ samtykke: true, epost: "a@b.no", samtykke_tekst_versjon: "gammel" });
  assert.equal(utdatert.ok, false);
  const ok = validerPamelding({
    samtykke: true,
    epost: "  Delivered@Resend.DEV ",
    fornavn: "Ada",
    etternavn: "Lovelace",
    samtykke_tekst_versjon: SAMTYKKE_VERSJON,
  });
  assert.equal(ok.ok && !ok.bot && ok.verdi.epost, LEVERT);
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
  assert.equal(utsendelsesModus({ til: LEVERT }), "en");
  assert.equal(utsendelsesModus({ til: "ikke-epost" }), "avvist");
  assert.equal(utsendelsesModus({ bekreft: "send" }), "alle");

  const mottakere = filtrerMottakere([
    { id: 2, epost: "Delivered@Resend.dev", avmeldings_token: TOKEN, samtykke_gitt_at: "t", bekreftet_at: "t", avmeldt_at: null },
    { id: 1, epost: " delivered@resend.dev ", avmeldings_token: "22222222-2222-4222-8222-222222222222", samtykke_gitt_at: "t", bekreftet_at: "t", avmeldt_at: null },
    { id: 3, epost: "gammel@example.no", avmeldings_token: null, samtykke_gitt_at: null, bekreftet_at: null, avmeldt_at: null },
    { id: 4, epost: "av@example.no", avmeldings_token: TOKEN, samtykke_gitt_at: "t", bekreftet_at: "t", avmeldt_at: "t" },
    { id: 5, epost: "venter@example.no", avmeldings_token: TOKEN, samtykke_gitt_at: "t", bekreftet_at: null, avmeldt_at: null },
  ]);
  assert.deepEqual(mottakere.map((rad) => rad.epost), [LEVERT]);
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

function lesOrgKonstanter(kilde: string): Record<string, string> {
  const ut: Record<string, string> = {};
  for (const navn of ["behandlingsansvarlig", "orgnr", "poststed"]) {
    const treff = kilde.match(new RegExp(`^export const ${navn} = "([^"]*)";`, "m"));
    assert.ok(treff, navn);
    ut[navn] = treff[1];
  }
  return ut;
}

test("organisasjon er lik i funksjoner og nettleser", () => {
  const js = readFileSync("public/organisasjon.js", "utf8");
  const ts = readFileSync("supabase/functions/_shared/organisasjon.ts", "utf8");
  const html = readFileSync("public/personvern.html", "utf8");
  const meldPa = readFileSync("supabase/functions/meld-pa/index.ts", "utf8");
  const nyhetsbrev = readFileSync("supabase/functions/nyhetsbrev/index.ts", "utf8");
  assert.deepEqual(lesOrgKonstanter(js), lesOrgKonstanter(ts));
  assert.equal(lesOrgKonstanter(js).behandlingsansvarlig, behandlingsansvarlig);
  assert.equal(behandlingsansvarlig, "KULTURVARSLING AS");
  assert.equal(orgnr, "936 282 881");
  assert.equal(poststed, "Oslo");
  assert.doesNotMatch(js, /PLASSHOLDER/);
  assert.doesNotMatch(ts, /from\s+["'][^"']*public\//);
  assert.doesNotMatch(html, /PLASSHOLDER/);
  assert.match(html, /data-org="behandlingsansvarlig"/);
  assert.match(html, /data-org="poststed"/);
  assert.match(html, /src="\/organisasjon\.js"/);
  assert.doesNotMatch(html, /Åndsverkstedet AS/);
  assert.equal(
    avsender(behandlingsansvarlig),
    '"KULTURVARSLING AS" <nyhetsbrev@kulturvarsling.no>',
  );
  assert.equal(
    lesAvsender(behandlingsansvarlig, { get: () => undefined }),
    '"KULTURVARSLING AS" <nyhetsbrev@kulturvarsling.no>',
  );
  assert.equal(
    lesAvsender(behandlingsansvarlig, { get: () => "  " }),
    '"KULTURVARSLING AS" <nyhetsbrev@kulturvarsling.no>',
  );
  assert.equal(
    lesAvsender(behandlingsansvarlig, { get: () => LEVERT }),
    `"KULTURVARSLING AS" <${LEVERT}>`,
  );
  assert.equal(
    avsender("Åndsverkstedet AS", "Kulturvarsling <post@example.com>"),
    '"Åndsverkstedet AS" <post@example.com>',
  );
  assert.equal(bunntekst("Kulturvarsling AS"), "Behandlingsansvarlig: Kulturvarsling AS.");
  assert.match(meldPa, /lesAvsender\(behandlingsansvarlig, Deno\.env\)/);
  assert.match(meldPa, /bunntekst\(behandlingsansvarlig\)/);
  assert.match(nyhetsbrev, /bunntekst\(behandlingsansvarlig\)/);
  assert.match(nyhetsbrev, /lesAvsender\(behandlingsansvarlig, Deno\.env\)/);
  assert.match(loggNarResendMangler("nyhetsbrev"), /RESEND_API_KEY mangler/);
  assert.match(loggNarResendMangler("meld-pa"), /bekreftelse_sendt_at null/);
});

test("personvernsiden dekker pliktene og navngir behandlingsansvarlig", () => {
  const html = readFileSync("public/personvern.html", "utf8");
  const css = readFileSync("public/papir.css", "utf8");
  for (const del of ["Nyhetsbrev", "Varsler", "Konto", "Behandlingsgrunnlag", "Lagringstid", "Dine rettigheter", "Kontakt"]) {
    assert.match(html, new RegExp(del));
  }
  assert.equal(behandlingsansvarlig, "KULTURVARSLING AS");
  assert.equal(orgnr, "936 282 881");
  assert.match(html, new RegExp(PERSONVERN_VERSJON));
  assert.match(html, /papir\.css/);
  assert.match(css, /Newsreader/);
  assert.match(css, /Libre Franklin/);
  assert.match(css, /#FBF8F2/i);
});

test("dry-run er standard og logger uten å sende", () => {
  assert.equal(utsendingErAktiv(undefined), false);
  assert.equal(utsendingErAktiv(null), false);
  assert.equal(utsendingErAktiv(""), false);
  assert.equal(utsendingErAktiv("false"), false);
  assert.equal(utsendingErAktiv("ja"), false);
  assert.equal(utsendingErAktiv("true"), true);
  assert.equal(utsendingErAktiv(" TRUE "), true);

  const plan = planleggUtsendelse([
    { id: 2, epost: "Delivered@Resend.dev", avmeldings_token: TOKEN, samtykke_gitt_at: "t", bekreftet_at: "t", avmeldt_at: null },
    { id: 1, epost: " delivered@resend.dev ", avmeldings_token: "22222222-2222-4222-8222-222222222222", samtykke_gitt_at: "t", bekreftet_at: "t", avmeldt_at: null },
    { id: 3, epost: "gammel@example.no", avmeldings_token: null, samtykke_gitt_at: null, bekreftet_at: null, avmeldt_at: null },
    { id: 4, epost: "av@example.no", avmeldings_token: TOKEN, samtykke_gitt_at: "t", bekreftet_at: "t", avmeldt_at: "t" },
    { id: 5, epost: "venter@example.no", avmeldings_token: TOKEN, samtykke_gitt_at: "t", bekreftet_at: null, avmeldt_at: null },
  ]);
  assert.deepEqual(plan.mottakere.map((rad) => rad.epost), [LEVERT]);
  assert.equal(plan.mottakere[0].id, 1);
  const hopp = oppsummerHopp(plan.hoppetOver);
  assert.equal(hopp.duplikat, 1);
  assert.equal(hopp.avmeldt, 1);
  assert.equal(hopp.ubekreftet, 1);
  assert.equal(hopp.uten_samtykke, 1);

  const logg = dryRunLogg(plan.mottakere);
  assert.equal(logg.send, false);
  assert.equal(logg.status, "dry_run");
  assert.deepEqual(logg.rader, [{ pamelding_id: 1, status: "dry_run" }]);

  const kilde = readFileSync("supabase/functions/nyhetsbrev/index.ts", "utf8");
  const dry = kilde.indexOf('status: rad.status');
  const resend = kilde.indexOf("https://api.resend.com/emails");
  assert.ok(dry > 0 && resend > dry);
  assert.match(kilde, /UTSENDING_AKTIV/);
  assert.match(kilde, /Ingenting er sendt/);
});

const HISTORISK_TEKST = "Ved å melde deg på samtykker du til at Kulturvarsling.no kan kontakte deg med informasjon om lansering og nyheter. Vi deler ikke din e-post med tredjeparter.";

test("historisk samtykke bruker skjemateksten og beholder eldste rad", () => {
  const sql = readFileSync("supabase/migrations/20261020160000_historisk_samtykke_og_dedup.sql", "utf8");
  assert.match(sql, /venteside-2026-03-15/);
  assert.match(sql, /kilde = 'pamelding-skjema'/);
  assert.match(sql, new RegExp(HISTORISK_TEKST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(sql, /samtykke_gitt_at settes ikke/);
  assert.doesNotMatch(sql, /samtykke_gitt_at = now\(\)/);
  assert.match(sql, /min\(p\.id\)/);
  assert.match(sql, /s\.id < d\.id/);
  assert.match(sql, /pamelding_epost_unik/);
  assert.match(sql, /on conflict \(versjon\) do nothing/);
});

test("alle utgående e-poster har avmeldingslenke og List-Unsubscribe", () => {
  const side = "https://www.kulturvarsling.no/avmelding?t=" + TOKEN;
  const funksjon = "https://example.test/functions/v1/avmeld?t=" + TOKEN;
  for (const emne of ["Bekreft påmelding til Kulturvarsling", "Ukens kulturbrev", "Nytt varsel"]) {
    const brev = lagEpost({
      fra: avsender(behandlingsansvarlig),
      til: LEVERT,
      emne,
      html: "<p>Innhold</p>",
      tekst: "Innhold",
      side,
      funksjon,
    });
    assert.match(brev.html, /Meld meg av/);
    assert.match(brev.html, new RegExp(TOKEN));
    assert.match(brev.text, /Meld deg av:/);
    assert.match(brev.headers["List-Unsubscribe"], /<https:\/\/example\.test\/functions\/v1\/avmeld\?t=/);
    assert.equal(brev.to, LEVERT);
    assert.equal(brev.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  }
  assert.throws(() => lagEpost({
    fra: "a",
    til: "a@example.no",
    emne: "uten token",
    html: "<p>x</p>",
    tekst: "x",
    side: "https://www.kulturvarsling.no/avmelding",
    funksjon,
  }));

  const rot = "supabase/functions";
  const sendere: string[] = [];
  const stack = [rot];
  while (stack.length) {
    const katalog = stack.pop()!;
    for (const navn of readdirSync(katalog)) {
      const sti = join(katalog, navn);
      if (statSync(sti).isDirectory()) stack.push(sti);
      else if (navn.endsWith(".ts") && !navn.endsWith(".test.ts")) {
        const kilde = readFileSync(sti, "utf8");
        if (kilde.includes("api.resend.com/emails")) sendere.push(sti);
      }
    }
  }
  assert.deepEqual(sendere.sort(), [
    "supabase/functions/meld-pa/index.ts",
    "supabase/functions/nyhetsbrev/index.ts",
    "supabase/functions/send-bekreftelser/index.ts",
  ]);
  for (const sti of sendere) {
    const kilde = readFileSync(sti, "utf8");
    assert.match(kilde, /lagEpost\(/);
    assert.match(kilde, /headers: brev\.headers/);
  }
});

test("avmelding og bekreftelse viser ikke suksess før svaret er ok", () => {
  for (const fil of ["public/avmelding.html", "public/bekreft.html"]) {
    const html = readFileSync(fil, "utf8");
    assert.match(html, /data\.ok === true/);
    assert.doesNotMatch(html, /Du er meldt av/);
    assert.match(html, /Ingenting er endret/);
  }
});

test("funksjoner importerer ikke utenfor supabase/functions", () => {
  const stack = ["supabase/functions"];
  while (stack.length) {
    const katalog = stack.pop()!;
    for (const navn of readdirSync(katalog)) {
      const sti = join(katalog, navn);
      if (statSync(sti).isDirectory()) {
        stack.push(sti);
        continue;
      }
      if (!navn.endsWith(".ts")) continue;
      const importlinjer = readFileSync(sti, "utf8")
        .split("\n")
        .filter((linje) => /^\s*import\b/.test(linje) || /\bfrom\s+["']/.test(linje));
      const tekst = importlinjer.join("\n");
      assert.doesNotMatch(tekst, /public\/organisasjon/, sti);
      assert.doesNotMatch(tekst, /\.\.\/\.\.\//, sti);
    }
  }
});

test("lagret påmelding er suksess selv om e-posten ikke går", () => {
  const uten = svarEtterLagretPamelding(false);
  assert.equal(uten.ok, true);
  assert.equal(uten.status, 200);
  assert.equal(uten.melding, MELDING_VENTENDE_BEKREFTELSE);
  const med = svarEtterLagretPamelding(true);
  assert.equal(med.status, 200);
  assert.notEqual(med.melding, MELDING_VENTENDE_BEKREFTELSE);
  const allerede = svarAlleredeRegistrert(false);
  assert.equal(allerede.ok, true);
  assert.equal(allerede.status, 200);
  assert.doesNotMatch(allerede.melding, /utsendingen er klar/);
  assert.match(svarAlleredeRegistrert(true).melding, /allerede bekreftet/);

  const meldPa = readFileSync("supabase/functions/meld-pa/index.ts", "utf8");
  assert.match(meldPa, /svarEtterLagretPamelding\(/);
  assert.match(meldPa, /svarAlleredeRegistrert\(/);
  assert.match(meldPa, /bekreftelse_sendt_at:\s*null/);
  assert.match(meldPa, /loggNarResendMangler\("meld-pa"\)/);
  assert.doesNotMatch(meldPa, /\b502\b/);
  assert.match(meldPa, /samtykke_gitt_at: naa/);
  assert.match(meldPa, /samtykke_tekst_versjon: SAMTYKKE_VERSJON/);
  assert.match(meldPa, /kilde: KILDE_VENTESIDE/);
});

test("manuell bekreftelse tar bare ventende nye rader og er ikke en tidsplan", () => {
  const avToken = "22222222-2222-4222-8222-222222222222";
  const valgt = velgVentendeBekreftelser([
    {
      id: 2,
      epost: "Delivered@Resend.dev",
      avmeldings_token: avToken,
      bekreftelses_token: TOKEN,
      samtykke_gitt_at: "t",
      samtykke_tekst_versjon: SAMTYKKE_VERSJON,
      bekreftet_at: null,
      avmeldt_at: null,
      bekreftelse_sendt_at: null,
    },
    {
      id: 1,
      epost: ` ${LEVERT} `,
      avmeldings_token: avToken,
      bekreftelses_token: "33333333-3333-4333-8333-333333333333",
      samtykke_gitt_at: "t",
      samtykke_tekst_versjon: SAMTYKKE_VERSJON,
      bekreftet_at: null,
      avmeldt_at: null,
      bekreftelse_sendt_at: null,
    },
    {
      id: 3,
      epost: "gammel@example.no",
      avmeldings_token: null,
      bekreftelses_token: null,
      samtykke_gitt_at: null,
      samtykke_tekst_versjon: "venteside-2026-03-15",
      bekreftet_at: null,
      avmeldt_at: null,
      bekreftelse_sendt_at: null,
    },
    {
      id: 4,
      epost: "av@example.no",
      avmeldings_token: avToken,
      bekreftelses_token: TOKEN,
      samtykke_gitt_at: "t",
      samtykke_tekst_versjon: SAMTYKKE_VERSJON,
      bekreftet_at: null,
      avmeldt_at: "t",
      bekreftelse_sendt_at: null,
    },
    {
      id: 5,
      epost: "sendt@example.no",
      avmeldings_token: avToken,
      bekreftelses_token: TOKEN,
      samtykke_gitt_at: "t",
      samtykke_tekst_versjon: SAMTYKKE_VERSJON,
      bekreftet_at: null,
      avmeldt_at: null,
      bekreftelse_sendt_at: null,
    },
    {
      id: 6,
      epost: "bekreftet@example.no",
      avmeldings_token: avToken,
      bekreftelses_token: TOKEN,
      samtykke_gitt_at: "t",
      samtykke_tekst_versjon: SAMTYKKE_VERSJON,
      bekreftet_at: "t",
      avmeldt_at: null,
      bekreftelse_sendt_at: null,
    },
  ], { eposter: new Set(["Sendt@Example.no"]) });
  assert.deepEqual(valgt.map((rad) => rad.epost), [LEVERT]);
  assert.equal(valgt[0].id, 1);
  assert.deepEqual(valgt[0].ovrigeIder, [2]);
  assert.equal(velgVentendeBekreftelser([{
    id: 1,
    epost: LEVERT,
    avmeldings_token: avToken,
    bekreftelses_token: TOKEN,
    samtykke_gitt_at: "t",
    samtykke_tekst_versjon: SAMTYKKE_VERSJON,
    bekreftet_at: null,
    avmeldt_at: null,
    bekreftelse_sendt_at: null,
  }], { ids: new Set([1]) }).length, 0);

  const kilde = readFileSync("supabase/functions/send-bekreftelser/index.ts", "utf8");
  const config = readFileSync("supabase/config.toml", "utf8");
  const sql = readFileSync("supabase/migrations/20261020193000_bekreftelse_venter.sql", "utf8");
  const stopp = kilde.indexOf("Ventende rader er uendret");
  const stempel = kilde.indexOf("bekreftelse_sendt_at:");
  assert.ok(stopp > 0 && stempel > stopp);
  assert.match(kilde, /x-bekreftelse-nokkel/);
  assert.match(kilde, /hemmeligheterStemmer/);
  assert.match(kilde, /velgVentendeBekreftelser/);
  assert.match(kilde, /lagEpost\(/);
  assert.match(kilde, /bekreftelse_utsendelser/);
  assert.match(kilde, /Aldri cron/);
  assert.match(kilde, /loggNarResendMangler\("send-bekreftelser"\)/);
  assert.doesNotMatch(kilde, /cron\.schedule/);
  assert.match(config, /\[functions\.send-bekreftelser\]\s+verify_jwt = true/);
  assert.match(sql, /bekreftelse_sendt_at timestamptz/);
  assert.match(sql, /bekreftelse_utsendelser/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.bekreftelse_utsendelser from anon, authenticated/);
  assert.match(sql, /'ikke_konfigurert'/);
  assert.doesNotMatch(sql, /cron\.schedule/);
  assert.doesNotMatch(sql, /bekreftelse_sendt_at\s*=\s*now\(\)/i);
  assert.doesNotMatch(sql, /update\s+(public\.)?pamelding/i);
});

test("lanseringsmail er tørrkjør til bryteren er på, og tom liste er aldri alle", () => {
  assert.equal(lesBekreftelsesOppdrag(null).type, "avvist");
  assert.equal(lesBekreftelsesOppdrag({}).type, "avvist");
  assert.equal(lesBekreftelsesOppdrag({ bekreft: "send" }).type, "avvist");
  assert.equal(lesBekreftelsesOppdrag({ maal: "lansering", til: "" }).type, "avvist");
  assert.equal(lesBekreftelsesOppdrag({ maal: "lansering", til: [] }).type, "avvist");
  assert.equal(lesBekreftelsesOppdrag({ maal: "lansering", mottakere: [] }).type, "avvist");
  assert.equal(lesBekreftelsesOppdrag({ maal: "nye", mottakere: [LEVERT] }).type, "avvist");
  assert.equal(lesBekreftelsesOppdrag({ maal: "lansering" }).type, "torrkjor");
  assert.deepEqual(lesBekreftelsesOppdrag({ maal: "lansering", til: "  Delivered@Resend.DEV ", bekreft: "send" }), {
    type: "test",
    maal: "lansering",
    til: LEVERT,
  });
  assert.deepEqual(lesBekreftelsesOppdrag({ maal: "nye", bekreft: "send" }), { type: "alle", maal: "nye" });

  const av = utsendelsesBeslutning({
    oppdrag: { type: "alle", maal: "lansering" },
    aktiv: false,
    utkast: true,
    antall: 110,
  });
  assert.equal(av.send, false);
  assert.match(av.grunn, /UTSENDING_AKTIV er av/);
  const utkastStopp = utsendelsesBeslutning({
    oppdrag: { type: "alle", maal: "lansering" },
    aktiv: true,
    utkast: true,
    antall: 110,
  });
  assert.equal(utkastStopp.send, false);
  assert.match(utkastStopp.grunn, /UTKAST/);
  const en = utsendelsesBeslutning({
    oppdrag: { type: "test", maal: "lansering", til: LEVERT },
    aktiv: true,
    utkast: true,
    antall: 0,
  });
  assert.equal(en.send, true);
  assert.equal(en.sandkasse, true);
  const enEkte = utsendelsesBeslutning({
    oppdrag: { type: "test", maal: "lansering", til: LEVERT },
    aktiv: true,
    utkast: false,
    antall: 1,
  });
  assert.equal(enEkte.send, true);
  assert.equal(enEkte.sandkasse, false);
  assert.equal(utsendelsesBeslutning({
    oppdrag: { type: "alle", maal: "lansering" },
    aktiv: true,
    utkast: false,
    antall: MAKS_BEKREFTELSER_PER_KALL + 1,
  }).send, false);

  const avToken = "22222222-2222-4222-8222-222222222222";
  const valgt = velgLanseringsmottakere([
    {
      id: 2,
      epost: "Delivered@Resend.dev",
      avmeldings_token: null,
      bekreftelses_token: null,
      samtykke_tekst_versjon: HISTORISK_VERSJON,
      bekreftet_at: null,
      avmeldt_at: null,
      bekreftelse_sendt_at: null,
    },
    {
      id: 1,
      epost: ` ${LEVERT} `,
      avmeldings_token: avToken,
      bekreftelses_token: TOKEN,
      samtykke_tekst_versjon: HISTORISK_VERSJON,
      bekreftet_at: null,
      avmeldt_at: null,
      bekreftelse_sendt_at: null,
    },
    {
      id: 3,
      epost: "ny@example.no",
      avmeldings_token: avToken,
      bekreftelses_token: TOKEN,
      samtykke_tekst_versjon: SAMTYKKE_VERSJON,
      bekreftet_at: null,
      avmeldt_at: null,
      bekreftelse_sendt_at: null,
    },
    {
      id: 4,
      epost: "av@example.no",
      avmeldings_token: avToken,
      bekreftelses_token: null,
      samtykke_tekst_versjon: HISTORISK_VERSJON,
      bekreftet_at: null,
      avmeldt_at: "t",
      bekreftelse_sendt_at: null,
    },
    {
      id: 5,
      epost: "ferdig@example.no",
      avmeldings_token: avToken,
      bekreftelses_token: TOKEN,
      samtykke_tekst_versjon: HISTORISK_VERSJON,
      bekreftet_at: "t",
      avmeldt_at: null,
      bekreftelse_sendt_at: null,
    },
  ], { eposter: [] });
  assert.deepEqual(valgt.map((rad) => rad.epost), [LEVERT]);
  assert.equal(valgt[0].id, 1);
  assert.deepEqual(valgt[0].ovrigeIder, [2]);
  assert.equal(velgLanseringsmottakere(valgt.map((rad) => ({
    id: rad.id,
    epost: rad.epost,
    avmeldings_token: rad.avmeldings_token,
    bekreftelses_token: rad.bekreftelses_token,
    samtykke_tekst_versjon: HISTORISK_VERSJON,
    bekreftet_at: null,
    avmeldt_at: null,
    bekreftelse_sendt_at: null,
  })), { eposter: new Set([LEVERT]) }).length, 0);

  const gammel = {
    id: 8,
    epost: "gammel-liste@example.no",
    avmeldings_token: avToken,
    samtykke_gitt_at: null,
    bekreftet_at: null,
    avmeldt_at: null,
  };
  assert.equal(planleggUtsendelse([gammel]).mottakere.length, 0);
  assert.equal(planleggUtsendelse([{ ...gammel, bekreftet_at: "t" }]).mottakere.length, 0);
  assert.deepEqual(planleggUtsendelse([{
    ...gammel,
    id: 9,
    epost: LEVERT,
    samtykke_gitt_at: "t",
    bekreftet_at: "t",
  }]).mottakere.map((rad) => rad.epost), [LEVERT]);

  const naa = "2026-10-20T16:00:00.000Z";
  assert.deepEqual(feltVedBekreftelse({ samtykke_gitt_at: null }, naa), {
    bekreftet_at: naa,
    avmeldt_at: null,
    samtykke_gitt_at: naa,
  });
  assert.equal(feltVedBekreftelse({ samtykke_gitt_at: "2026-03-15T00:00:00.000Z" }, naa).samtykke_gitt_at, "2026-03-15T00:00:00.000Z");
  assert.match(readFileSync("supabase/functions/meld-pa/index.ts", "utf8"), /feltVedBekreftelse\(/);

  assert.equal(malErUtkast(LANSERING_MAL), true);
  assert.match(LANSERING_MAL, /UTKAST – fjernes først når Håkon har godkjent teksten og testmailen/);
  const mal = parseLanseringsmal(LANSERING_MAL);
  assert.equal("feil" in mal, false);
  if ("feil" in mal) return;
  assert.equal(mal.emne, "Kulturvarsling er åpnet");
  assert.equal(mal.forhandsvisning, "Du meldte deg på ventelisten vår. Nå er vi i gang.");
  for (const setning of [
    "Hei!",
    "Du får denne e-posten fordi du meldte deg på ventelisten til Kulturvarsling en gang mellom 15. mars og 19. oktober 2026. Du ba om å få beskjed når tjenesten åpnet, og nå er den i gang på kulturvarsling.no.",
    "Kulturvarsling følger med på Stortinget, regjeringen, kommunene og Sametinget og plukker ut sakene som angår kulturlivet. Det kan være høringer, budsjett, tilskudd og vedtak.",
    "Trykk på «Bekreft påmelding» hvis du vil ha et ukesbrev med de viktigste sakene og varsler når en frist nærmer seg.",
    "Hvis du ikke bekrefter, skjer det ingenting. Du får ingen flere e-poster fra oss, og adressen din blir ikke brukt til noe annet.",
    "Hilsen\nHåkon Dalsbø\nKulturvarsling",
  ]) {
    assert.equal(mal.tekst.includes(setning), true, setning.slice(0, 24));
  }
  const side = "https://www.kulturvarsling.no/avmelding?t=" + TOKEN;
  const funksjon = "https://example.test/functions/v1/avmeld?t=" + TOKEN;
  const bekreftLenke = "https://www.kulturvarsling.no/bekreft?t=" + FORHANDSVISNING_TOKEN;
  const fylt = fyllLanseringsmal(mal, {
    bekreftelseslenke: bekreftLenke,
    avmeldingslenke: side,
    behandlingsansvarlig,
    orgnr,
    personvern: PERSONVERN_URL,
    avsender: avsender(behandlingsansvarlig),
  });
  const brev = lagEpost({
    fra: avsender(behandlingsansvarlig),
    til: LEVERT,
    emne: fylt.emne,
    html: fylt.html,
    tekst: fylt.tekst,
    side,
    funksjon,
  });
  assert.equal(brev.to, LEVERT);
  assert.equal(brev.subject, "Kulturvarsling er åpnet");
  assert.match(brev.html, /Bekreft påmelding/);
  assert.match(brev.html, new RegExp(FORHANDSVISNING_TOKEN));
  assert.match(brev.html, new RegExp(TOKEN));
  assert.match(brev.html, /KULTURVARSLING AS/);
  assert.match(brev.html, /936 282 881/);
  assert.match(brev.html, /https:\/\/kulturvarsling\.no\/personvern/);
  assert.match(brev.html, /Håkon Dalsbø/);
  assert.doesNotMatch(brev.html, /fjernes først/);
  assert.doesNotMatch(brev.text, /fjernes først/);
  assert.doesNotMatch(brev.html, /Hver sak får en kort forklaring/);
  assert.doesNotMatch(brev.text, /Hver sak får en kort forklaring/);
  assert.match(brev.text, /Bekreft påmelding:/);
  assert.match(brev.text, /Meld meg av:/);
  assert.equal(brev.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(brev.headers["List-Unsubscribe"], /List-Unsubscribe=One-Click|avmeld/);
  assert.equal(utsendelsesBeslutning({
    oppdrag: { type: "alle", maal: "lansering" },
    aktiv: true,
    utkast: malErUtkast(LANSERING_MAL),
    antall: 110,
  }).send, false);
  assert.equal(malErUtkast("Emne: Bekreft\n\n{{bekreftelseslenke}}\n{{avmeldingslenke}}"), false);

  const kilde = readFileSync("supabase/functions/send-bekreftelser/index.ts", "utf8");
  const sql = readFileSync("supabase/migrations/20261020223000_lansering_dedup.sql", "utf8");
  const aktiv = kilde.indexOf("utsendingErAktiv");
  const resend = kilde.indexOf("https://api.resend.com/emails");
  assert.ok(aktiv > 0 && resend > aktiv);
  assert.match(kilde, /BEKREFTELSE_PAUSE_MS/);
  assert.equal(BEKREFTELSE_PAUSE_MS >= 500, true);
  assert.match(kilde, /velgLanseringsmottakere/);
  assert.match(kilde, /lansering_reservert/);
  assert.match(kilde, /Aldri cron/);
  assert.doesNotMatch(kilde, /cron\.schedule/);
  assert.match(sql, /lansering_sendt/);
  assert.match(sql, /bekreftelse_utsendelser_lansering_epost_unik/);
  assert.doesNotMatch(sql, /cron\.schedule/);
  assert.doesNotMatch(sql, /update\s+(public\.)?pamelding/i);
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
  assert.match(kilde, /planleggUtsendelse/);
  assert.match(kilde, /utsendingErAktiv/);
  assert.match(kilde, /List-Unsubscribe/);
  assert.match(kilde, /nyhetsbrev_utsendelser/);
  assert.match(kilde, /Adressen er ikke bekreftet, samtykkende og aktiv/);
  assert.doesNotMatch(kilde, /avmeldings_token:\s*data\?/);
  assert.doesNotMatch(kilde, /avmeldt:\s*true/);
  assert.match(config, /\[functions\.avmeld\]\s+verify_jwt = false/);
  assert.match(config, /\[functions\.meld-pa\]\s+verify_jwt = false/);
  assert.match(config, /\[functions\.slett-konto\]\s+verify_jwt = true/);
});
