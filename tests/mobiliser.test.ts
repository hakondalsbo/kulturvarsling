import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { finnUdokumenterteTall, kildegrunnlag } from "../supabase/functions/_shared/kildekontroll.ts";
import { byggSignaturBrev } from "../supabase/functions/_shared/mobilisering.ts";
import {
  PERSONVERN_EPOST,
  SAMTYKKE_MAL,
  SAMTYKKE_VERSJON,
  anvendSletting,
  bekreftSignatur,
  byggPanel,
  eksportTilMottaker,
  foreslaaInnspill,
  lagUtkast,
  panelVises,
  signaturMottakAktiv,
  signaturVises,
  slettefrister,
  synligeStotte,
  tellerMed,
  trekkSignatur,
  utkastErMerke,
  validerSignering,
  vurderCaptcha,
} from "../supabase/functions/_shared/mobilisering-kjerne.ts";
import { PERSONVERN_FELLES_AVSNITT, personvernTilleggHtml } from "../src/innhold/personvern-felles-innspill.ts";
import { DEMO_HORING, DEMO_INNSPILL, DEMO_ORIENTERING, DEMO_SIGNATURER } from "../src/mobiliser/demo.ts";
import { hoppOverOppsettForAnker, visInnloggingsport } from "../src/minside/demo.ts";
import { erMobiliserSti } from "../src/mobiliser/miljo.ts";
import { stotteFraSvar } from "../src/mobiliser/stotte.ts";

const migrasjon = readFileSync("supabase/migrations/20261024210000_mobilisering_fase_og_felles_innspill.sql", "utf8");
const personvern = readFileSync("public/personvern.html", "utf8");
const config = readFileSync("supabase/config.toml", "utf8");

test("samtykkemalen i databasen er den samme teksten som i koden", () => {
  const treff = migrasjon.match(/\$samtykke\$(.*?)\$samtykke\$/s);
  assert.ok(treff);
  assert.equal(treff[1], SAMTYKKE_MAL);
  assert.equal(SAMTYKKE_VERSJON, "felles-innspill-2026-10-24");
  assert.doesNotMatch(SAMTYKKE_MAL, /post@kulturvarsling\.no/);
  assert.doesNotMatch(SAMTYKKE_MAL, /\[KONTAKT-E-POST\]/);
});

test("avkrysning som ikke er satt, avvises", () => {
  const uten = validerSignering(
    { navn: "Ada Berg", epost: "ada@example.test", samtykke_tekst_versjon: SAMTYKKE_VERSJON },
    { mottaker: "Departementet", dato: "10. november 2026" },
  );
  assert.equal(uten.ok, false);
  const av = validerSignering(
    { navn: "Ada Berg", epost: "ada@example.test", samtykke: false, samtykke_tekst_versjon: SAMTYKKE_VERSJON },
    { mottaker: "Departementet", dato: "10. november 2026" },
  );
  assert.equal(av.ok, false);
});

test("navn og e-post kreves, organisasjon er frivillig, synlighet blir skjult", () => {
  const forLangt = validerSignering(
    { navn: "A".repeat(121), epost: "ada@example.test", samtykke: true, samtykke_tekst_versjon: SAMTYKKE_VERSJON },
    { mottaker: "Departementet", dato: "10. november 2026" },
  );
  assert.equal(forLangt.ok, false);
  const utenNavn = validerSignering(
    { navn: "A", epost: "ada@example.test", samtykke: true, samtykke_tekst_versjon: SAMTYKKE_VERSJON },
    { mottaker: "Departementet", dato: "10. november 2026" },
  );
  assert.equal(utenNavn.ok, false);
  const utenEpost = validerSignering(
    { navn: "Ada Berg", epost: "ikke-en-epost", samtykke: true, samtykke_tekst_versjon: SAMTYKKE_VERSJON },
    { mottaker: "Departementet", dato: "10. november 2026" },
  );
  assert.equal(utenEpost.ok, false);
  const gammel = validerSignering(
    { navn: "Ada Berg", epost: "ada@example.test", samtykke: true, samtykke_tekst_versjon: "gammel" },
    { mottaker: "Departementet", dato: "10. november 2026" },
  );
  assert.equal(gammel.ok, false);
  const ok = validerSignering(
    {
      navn: "Ada Berg",
      epost: "Ada@Example.test",
      samtykke: true,
      samtykke_tekst_versjon: SAMTYKKE_VERSJON,
      organisasjon: "",
      synlighet: "organisasjon",
    },
    { mottaker: "Departementet", dato: "10. november 2026" },
  );
  assert.equal(ok.ok, true);
  if (!ok.ok || ok.bot) return;
  assert.equal(ok.verdi.synlighet, "skjult");
  assert.equal(ok.verdi.organisasjonsnavn, "");
  assert.equal(ok.verdi.epost, "ada@example.test");
  assert.equal(ok.verdi.minstealderBekreftet, true);
});

test("signatur teller først etter bekreftelse, og ikke etter trekk før innsending", () => {
  const venter = { samtykkeGittTid: "2026-10-24", bekreftetTid: null, trukketTid: null, trekkForespurtTid: null };
  assert.equal(tellerMed(venter), false);
  assert.deepEqual(bekreftSignatur(venter), { ok: true, allerede: false });
  const bekreftet = { ...venter, bekreftetTid: "2026-10-24" };
  assert.equal(tellerMed(bekreftet), true);
  assert.equal(trekkSignatur(bekreftet, false), "trukket");
  assert.equal(tellerMed({ ...bekreftet, trukketTid: "2026-10-25" }), false);
  assert.equal(trekkSignatur(bekreftet, true), "forespurt");
  assert.equal(tellerMed({ ...bekreftet, trekkForespurtTid: "2026-10-25" }), true);
});

test("e-post slettes etter 30 dager og navn etter 12 måneder når innspillet er sendt", () => {
  const sendt = slettefrister("2026-01-15T00:00:00.000Z", true);
  assert.equal(sendt.epostSlettesEtter, "2026-02-14T00:00:00.000Z");
  assert.equal(sendt.slettesEtter, "2027-01-15T00:00:00.000Z");
  const rad = {
    navn: "Ada",
    epost: "ada@example.test",
    rolle: "leder",
    organisasjonsnavn: "Teateret",
    kommune: "Oslo",
    tokenHash: "abc",
    epostSlettesEtter: sendt.epostSlettesEtter,
    slettesEtter: sendt.slettesEtter,
  };
  const etterEpost = anvendSletting(rad, "2026-02-14T00:00:00.000Z", true);
  assert.equal(etterEpost.behold, true);
  if (!etterEpost.behold) return;
  assert.equal(etterEpost.rad.epost, null);
  assert.equal(etterEpost.rad.navn, "Ada");
  const etterNavn = anvendSletting(rad, "2027-01-15T00:00:00.000Z", true);
  assert.equal(etterNavn.behold, true);
  if (!etterNavn.behold) return;
  assert.equal(etterNavn.rad.navn, null);
  assert.equal(etterNavn.rad.tokenHash, null);
  const aldri = slettefrister("2026-01-15T00:00:00.000Z", false);
  assert.equal(aldri.epostSlettesEtter, aldri.slettesEtter);
  const borte = anvendSletting({ ...rad, slettesEtter: aldri.slettesEtter }, aldri.slettesEtter, false);
  assert.deepEqual(borte, { behold: false });
});

test("eksporten til mottakeren har navn og aldri e-post", () => {
  const eksport = eksportTilMottaker(DEMO_SIGNATURER);
  assert.equal(eksport.totalt, 2);
  assert.deepEqual(eksport.linjer.map((linje) => linje.navn), ["Demo Berg", "Demo Lie"]);
  assert.equal(JSON.stringify(eksport).includes("@"), false);
  assert.equal(eksport.linjer[0].organisasjon, "Eksempelteateret");
});

test("utkastet er merket og merknaden har ingen tall som ikke står i saken", () => {
  const laget = lagUtkast(DEMO_HORING, "24. oktober 2026");
  assert.equal(utkastErMerke(laget.tekst), true);
  assert.match(laget.tekst, /^UTKAST – må gjennomgås og eventuelt endres av deg før innsending/);
  assert.match(laget.tekst, /Kulturvarsling sender ikke inn utkastet\./);
  const kilde = kildegrunnlag([DEMO_HORING.tittel, DEMO_HORING.sammendrag, DEMO_HORING.instans, DEMO_HORING.frist, DEMO_HORING.kilde]);
  const avvik = finnUdokumenterteTall(laget.merknad, kilde);
  assert.deepEqual(avvik, { aar: [], tall: [] });
  assert.match(laget.merknad, /«Kultur- og likestillingsdepartementet har sendt forslaget på høring\.»/);
});

test("uten fase blir panelet en orientering, og vedtak er lukket", () => {
  const uten = byggPanel(DEMO_ORIENTERING, new Date("2026-10-24T12:00:00+02:00"));
  assert.equal(uten.merkeTekst, "Til orientering –");
  assert.equal(uten.utkast, null);
  assert.match(uten.handling, /ikke satt fasen/);
  const vedtak = byggPanel({ ...DEMO_HORING, fase: "vedtak" });
  assert.equal(vedtak.lukket, true);
  assert.equal(vedtak.merkeTekst, "Til orientering –");
  assert.match(vedtak.handling, /Vinduet er lukket/);
  const horing = byggPanel(DEMO_HORING, new Date("2026-10-24T12:00:00+02:00"));
  assert.equal(horing.merkeTekst, "Du kan gjøre noe ▸");
  assert.match(horing.handling, /høringsinnspill/);
  assert.doesNotMatch(horing.handling, /Signer/);
  assert.equal(horing.hvem, "Kultur- og likestillingsdepartementet");
});

test("flagg er av som standard, og preview åpner bare visningen", () => {
  assert.equal(signaturMottakAktiv(undefined), false);
  assert.equal(signaturMottakAktiv(" true "), true);
  assert.equal(signaturMottakAktiv("ja"), false);
  assert.equal(signaturVises({}), false);
  assert.equal(panelVises({}), false);
  assert.equal(signaturVises({ vercelEnv: "preview" }), true);
  assert.equal(panelVises({ demo: "true" }), true);
  assert.equal(signaturVises({ vercelEnv: "preview", signaturEksplisitt: "false" }), false);
  assert.equal(signaturMottakAktiv("preview"), false);
});

test("bekreftelsesbrevet bruker post@ og sendes bare når begge flagg er på", () => {
  const av = byggSignaturBrev({
    bekreftLenke: "https://kulturvarsling.no/mobiliser?handling=bekreft&t=hemmelig",
    trekkLenke: "https://kulturvarsling.no/mobiliser?handling=trekk&t=hemmelig",
    mottaker: "Departementet",
    utsending: "true",
    signatur: "false",
  });
  assert.equal(av.send, false);
  assert.match(av.tekst, new RegExp(PERSONVERN_EPOST));
  assert.match(av.tekst, /E-postadressen din deles aldri/);
  const pa = byggSignaturBrev({ ...{
    bekreftLenke: av.tekst,
    trekkLenke: "https://kulturvarsling.no/x",
    mottaker: "Departementet",
    utsending: "true",
    signatur: "true",
  } });
  assert.equal(pa.send, true);
  const bareUtsending = byggSignaturBrev({
    bekreftLenke: "https://kulturvarsling.no/x",
    trekkLenke: "https://kulturvarsling.no/y",
    mottaker: "Departementet",
    utsending: "false",
    signatur: "true",
  });
  assert.equal(bareUtsending.send, false);
});

test("personvernutkastet er ikke i prodteksten og bruker post@", () => {
  assert.doesNotMatch(personvern, /Felles innspill og signaturer/);
  assert.doesNotMatch(personvern, /\[KONTAKT-E-POST\]/);
  assert.match(personvernTilleggHtml(), /post@kulturvarsling\.no/);
  assert.match(personvernTilleggHtml(), /id="felles-innspill"/);
  assert.equal(PERSONVERN_FELLES_AVSNITT.some((avsnitt) => avsnitt.includes(PERSONVERN_EPOST)), true);
  assert.equal(PERSONVERN_FELLES_AVSNITT.some((avsnitt) => avsnitt.includes("[KONTAKT-E-POST]")), false);
});

test("forslag følger sakene, og støtten vises bare for den som er innlogget", () => {
  const forslag = foreslaaInnspill(DEMO_INNSPILL, ["demo-horing"], []);
  assert.deepEqual(forslag.map((rad) => rad.id), ["demo-innspill-horing"]);
  const utenNytt = foreslaaInnspill(DEMO_INNSPILL, ["demo-horing"], ["demo-innspill-horing"]);
  assert.equal(utenNytt.length, 0);
  const stotte = [
    { innspillId: "demo-innspill-stottet", tittel: "Kort", sakId: "demo-orientering", bekreftet: true, trukket: false },
    { innspillId: "annet", tittel: "Trukket", sakId: "demo-horing", bekreftet: true, trukket: true },
  ];
  assert.equal(synligeStotte(stotte, false).length, 0);
  assert.deepEqual(synligeStotte(stotte, true).map((rad) => rad.innspillId), ["demo-innspill-stottet"]);
});

test("rutene og funksjonene er koblet uten at mottaket åpnes i cron", () => {
  assert.equal(erMobiliserSti("/mobiliser"), true);
  assert.equal(erMobiliserSti("/min-side"), false);
  const utenKommentar = migrasjon.replace(/--.*$/gm, "");
  assert.doesNotMatch(utenKommentar, /cron\.schedule/);
  assert.match(utenKommentar, /set search_path = public, pg_catalog/);
  assert.match(utenKommentar, /revoke all on table public\.mobiliser_forsok from anon, authenticated, public/);
  assert.match(utenKommentar, /drop policy if exists "Les signaturer"/);
  assert.doesNotMatch(utenKommentar, /drop policy if exists "Signer"/);
  assert.match(utenKommentar, /revoke insert on table public\.kampanje_signaturer from anon;/);
  assert.match(config, /\[functions\.signer-innspill\]\s+verify_jwt = false/);
  assert.match(config, /\[functions\.slett-signaturer\]\s+verify_jwt = true/);
  assert.match(config, /\[functions\.mine-innspill\]\s+verify_jwt = true/);
  const side = readFileSync("src/mobiliser/MobiliserSide.tsx", "utf8");
  const skjema = readFileSync("src/mobiliser/FellesInnspill.tsx", "utf8");
  const inngang = readFileSync("src/main.tsx", "utf8");
  const stotte = readFileSync("src/mobiliser/StottetInnspill.tsx", "utf8");
  const signer = readFileSync("supabase/functions/signer-innspill/index.ts", "utf8");
  assert.doesNotMatch(side, /signer-innspill/);
  assert.doesNotMatch(side, /kampanje_signaturer/);
  assert.doesNotMatch(inngang, /MinSide/);
  assert.doesNotMatch(skjema, /defaultChecked/);
  assert.match(stotte, /id="stottet"/);
  assert.match(stotte, /Innspill du har støttet/);
  assert.match(signer, /, 403\)/);
  assert.match(signer, /if \(brev\.send\)/);
  assert.match(signer, /MOBILISERING_CAPTCHA_AKTIV/);
  assert.match(signer, /mobiliser_forsok/);
  const vercel = readFileSync("vercel.json", "utf8");
  assert.match(vercel, /\/min-side/);
  assert.match(vercel, /\/mobiliser/);
  const minside = readFileSync("src/minside/MinSide.tsx", "utf8");
  assert.match(minside, /id="fulgte"/);
  assert.match(minside, /StottetInnspill/);
  assert.match(minside, /data-minside="port"/);
  assert.match(minside, /Opprett konto/);
  assert.match(readFileSync("src/mobiliser/FellesInnspill.tsx", "utf8"), /Felles innspill åpner snart/);
  assert.equal(visInnloggingsport(false, false), true);
  assert.equal(visInnloggingsport(true, false), false);
  assert.equal(visInnloggingsport(false, true), false);
  assert.equal(hoppOverOppsettForAnker("#fulgte"), true);
  assert.equal(hoppOverOppsettForAnker("#stottet"), true);
  assert.equal(hoppOverOppsettForAnker("#minside-fulgte"), false);
  const nyhetsbrev = readFileSync("supabase/functions/nyhetsbrev/index.ts", "utf8");
  const utsending = readFileSync("supabase/functions/send-bekreftelser/index.ts", "utf8");
  assert.doesNotMatch(nyhetsbrev, /MOBILISERING/);
  assert.doesNotMatch(utsending, /MOBILISERING/);
});

test("captcha krever verken nøkkel eller token før flagget er på", () => {
  assert.deepEqual(vurderCaptcha({ flagg: undefined, hemmelighet: undefined, token: undefined }), { krev: false });
  assert.equal(vurderCaptcha({ flagg: "true", hemmelighet: "", token: "" }).krev, true);
  const utenNokkel = vurderCaptcha({ flagg: "true", hemmelighet: "  ", token: "x" });
  assert.equal("status" in utenNokkel && utenNokkel.status, 503);
  const utenToken = vurderCaptcha({ flagg: "true", hemmelighet: "hemmelig", token: "" });
  assert.equal("status" in utenToken && utenToken.status, 400);
  const klar = vurderCaptcha({ flagg: "true", hemmelighet: "hemmelig", token: "a".repeat(20) });
  assert.deepEqual(klar, { krev: true, token: "a".repeat(20) });
});

test("støttekilden leser bare feltene Min side trenger", () => {
  const rader = stotteFraSvar({
    ok: true,
    innspill: [
      { innspillId: "a", tittel: "Høring", sakId: "s", bekreftet: true, trukket: false, epost: "skal-ikke-med@example.test" },
      { tittel: "uten id" },
    ],
  });
  assert.equal(rader.length, 1);
  assert.equal(JSON.stringify(rader).includes("@"), false);
  assert.equal(stotteFraSvar({ aapent: false, innspill: [] }).length, 0);
});
