import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kjorHoringshjelp, merkelinje, nesteTryggeUrl, tryggKildeUrl, type HoringDeps, type SakRad } from "./logikk.ts";

const SAK: SakRad = {
  id: "11111111-1111-4111-8111-111111111111",
  tittel: "Forslag til endringer i kringkastingsforskriften",
  sammendrag: "Høring om senderanleggskonsesjon.",
  instans: "Kultur- og likestillingsdepartementet",
  frist: "2026-11-12",
  kilde: "https://www.regjeringen.no/no/dokumenter/horing-forslag-til-endringer-i-kringkastingsforskriften/id3173432/",
};

const KILDE = [
  "Høring: Forslag til endringer i kringkastingsforskriften",
  "Frist 12.11.2026",
  "1 Innledning",
  "3.2.4 § 7-4 første ledd",
  "Departementet foreslår at det kan gis ny senderanleggskonsesjon i slukkeområdene «dersom en annen aktør enn innehaveren av den eksisterende senderanleggskonsesjonen er tildelt frekvenstillatelse».",
].join("\n");

const BODY = {
  varsel_id: SAK.id,
  organisasjon: "Eksempelforeningen",
  beskrivelse: "Vi er en forening for lokalradio.",
  punkter: [{ nr: "3.2.4", syn: "støtter", hvorfor: "Sendingene må kunne fortsette uten opphold." }],
  erfaringer: "",
};

function deps(over: Partial<HoringDeps> & { kallModell: HoringDeps["kallModell"] }): { deps: HoringDeps; logg: string[] } {
  const logg: string[] = [];
  return {
    logg,
    deps: {
      aktiv: true,
      getUser: async () => ({ id: "bruker-1" }),
      hentProfil: async () => ({ plan: "premium" }),
      hentSak: async () => SAK,
      hentOffisiellKilde: async () => ({ tekst: KILDE, hentet: "2026-10-24T12:00:00.000Z", grunnlag: "notat" }),
      reserverKvote: async () => "ok",
      logg: (linje) => logg.push(linje),
      nå: () => new Date("2026-10-24T12:00:00+02:00"),
      ...over,
    },
  };
}

const LINJE = merkelinje("Eksempelforeningen");

function normaltUtkast(): string {
  return [
    LINJE,
    "Til: Kultur- og likestillingsdepartementet",
    "Høring: Forslag til endringer i kringkastingsforskriften (https://www.regjeringen.no/no/dokumenter/horing-forslag-til-endringer-i-kringkastingsforskriften/id3173432/)",
    "Høringsfrist: 2026-11-12",
    "Fra: Eksempelforeningen",
    "Dato: 24. oktober 2026",
    "",
    "1. Hvem vi er",
    "Eksempelforeningen er en forening for lokalradio.",
    "",
    "2. Hva vi mener, kort fortalt",
    "- Vi støtter forslaget i punkt 3.2.4.",
    "",
    "3. Merknader til de enkelte punktene",
    "Til punkt 3.2.4 § 7-4 første ledd",
    "Departementet foreslår at det kan gis ny senderanleggskonsesjon «dersom en annen aktør enn innehaveren av den eksisterende senderanleggskonsesjonen er tildelt frekvenstillatelse». Eksempelforeningen støtter dette. Sendingene må kunne fortsette uten opphold.",
    "",
    "4. Avslutning",
    "Takk for muligheten til å svare.",
    LINJE,
    "Til dere før innsending:",
    "- Høringssvar blir normalt offentlige.",
  ].join("\n");
}

test("normalt utkast beholder sitatet og flagger ingen tall", async () => {
  let prompt = "";
  const rigget = deps({
    kallModell: async (tekst) => {
      prompt = tekst;
      return normaltUtkast();
    },
  });
  const resultat = await kjorHoringshjelp({ token: "jwt", body: BODY }, rigget.deps);
  assert.equal(resultat.status, 200);
  const utkast = String(resultat.body.utkast);
  assert.equal(utkast.startsWith(LINJE), true);
  assert.match(utkast, /Til punkt 3\.2\.4/);
  assert.match(utkast, /dersom en annen aktør enn innehaveren/);
  assert.equal(utkast.includes("[SJEKK"), false);
  const sjekk = resultat.body.sjekk as { tall: { aar: string[]; tall: string[] }; sitater_fjernet: number; merkelinje: boolean };
  assert.deepEqual(sjekk.tall, { aar: [], tall: [] });
  assert.equal(sjekk.sitater_fjernet, 0);
  assert.equal(sjekk.merkelinje, true);
  assert.equal(rigget.logg.length, 0);
  assert.match(prompt, /KILDETROSKAP:/);
  assert.match(prompt, /tildelt frekvenstillatelse/);
  assert.equal(resultat.body.kilde_grunnlag, "notat");
  assert.equal(typeof resultat.body.kilde_hash, "string");
});

test("sammendrag med tall som ikke står i kilden blir flagget", async () => {
  const rigget = deps({
    kallModell: async () => [
      LINJE,
      "Til: Kultur- og likestillingsdepartementet",
      "Høring: Forslag til endringer i kringkastingsforskriften (https://www.regjeringen.no/no/dokumenter/horing-forslag-til-endringer-i-kringkastingsforskriften/id3173432/)",
      "Høringsfrist: 2026-11-12",
      "Fra: Eksempelforeningen",
      "Dato: 24. oktober 2026",
      "",
      "1. Hvem vi er",
      "Eksempelforeningen er en forening for lokalradio.",
      "",
      "2. Hva vi mener, kort fortalt",
      "- Ordningen økes med 374 millioner kroner.",
      "",
      "3. Merknader til de enkelte punktene",
      "Til punkt 3.2.4",
      "Eksempelforeningen støtter forslaget.",
      "",
      "4. Avslutning",
      "Takk for muligheten til å svare.",
      LINJE,
    ].join("\n"),
  });
  const resultat = await kjorHoringshjelp({ token: "jwt", body: BODY }, rigget.deps);
  assert.equal(resultat.status, 200);
  const utkast = String(resultat.body.utkast);
  assert.match(utkast, /374 \[SJEKK\]/);
  const sjekk = resultat.body.sjekk as { tall: { aar: string[]; tall: string[] } };
  assert.deepEqual(sjekk.tall.tall, ["374"]);
  assert.equal(rigget.logg.length, 1);
  const payload = JSON.parse(rigget.logg[0]);
  assert.equal(payload.hendelse, "tall_uten_kilde");
  assert.equal(payload.oppgave, "horingshjelp");
  assert.deepEqual(payload.tall, ["374"]);
  assert.equal(rigget.logg[0].includes("millioner kroner"), false);
});

test("brukt kvote stopper før modellen kalles", async () => {
  let kall = 0;
  const rigget = deps({
    reserverKvote: async () => "grense",
    kallModell: async () => {
      kall += 1;
      return normaltUtkast();
    },
  });
  const resultat = await kjorHoringshjelp({ token: "jwt", body: BODY }, rigget.deps);
  assert.equal(resultat.status, 429);
  assert.match(String(resultat.body.feil), /kvote/);
  assert.equal(kall, 0);
});

test("flagget av svarer 404 uten kvote, også for Premium", async () => {
  let kvote = 0;
  let kall = 0;
  const rigget = deps({
    aktiv: false,
    hentProfil: async () => ({ plan: "premium" }),
    reserverKvote: async () => {
      kvote += 1;
      return "ok";
    },
    kallModell: async () => {
      kall += 1;
      return normaltUtkast();
    },
  });
  const resultat = await kjorHoringshjelp({ token: "jwt", body: BODY }, rigget.deps);
  assert.equal(resultat.status, 404);
  assert.equal(kvote, 0);
  assert.equal(kall, 0);
});

test("innlogget uten Premium får forslag når flagget er på", async () => {
  let kvote = 0;
  const rigget = deps({
    hentProfil: async () => ({ plan: "gratis" }),
    reserverKvote: async () => {
      kvote += 1;
      return "ok";
    },
    kallModell: async () => normaltUtkast(),
  });
  const resultat = await kjorHoringshjelp({ token: "jwt", body: BODY }, rigget.deps);
  assert.equal(resultat.status, 200);
  assert.equal(kvote, 1);
});

test("kilde-URL blokkerer private nett og utrygge omdirigeringer", () => {
  assert.equal(tryggKildeUrl("https://www.regjeringen.no/no/dokumenter/"), true);
  assert.equal(tryggKildeUrl("https://172.16.0.5/notat"), false);
  assert.equal(tryggKildeUrl("https://172.31.255.1/notat"), false);
  assert.equal(tryggKildeUrl("https://172.15.0.1/notat"), true);
  assert.equal(tryggKildeUrl("https://172.32.0.1/notat"), true);
  assert.equal(tryggKildeUrl("https://[::1]/notat"), false);
  assert.equal(tryggKildeUrl("https://[fc00::1]/notat"), false);
  assert.equal(tryggKildeUrl("https://[fd12:3456::1]/notat"), false);
  assert.equal(tryggKildeUrl("https://[fe80::1]/notat"), false);
  assert.equal(tryggKildeUrl("https://[::ffff:127.0.0.1]/notat"), false);
  assert.equal(tryggKildeUrl("https://[::ffff:192.168.1.20]/notat"), false);
  assert.equal(tryggKildeUrl("https://[2001:4860:4860::8888]/"), true);
  const fra = "https://www.regjeringen.no/no/dokumenter/horing";
  assert.equal(nesteTryggeUrl(fra, "https://172.16.0.8/intern"), null);
  assert.equal(nesteTryggeUrl(fra, "https://[fe80::2]/lokalt"), null);
  assert.match(nesteTryggeUrl(fra, "/id3173432/") ?? "", /^https:\/\/www\.regjeringen\.no\//);
});

test("funksjonen krever innlogging, lav temperatur og service_role", () => {
  const index = readFileSync("supabase/functions/horingshjelp/index.ts", "utf8");
  const toml = readFileSync("supabase/config.toml", "utf8");
  assert.match(index, /auth\.getUser/);
  assert.match(index, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(index, /temperature: HORING_TEMPERATUR/);
  assert.match(index, /reserverAiKvote\(db, brukerId, "horingshjelp"/);
  assert.match(index, /redirect:\s*"manual"/);
  assert.match(index, /HORINGSHJELP_AKTIV/);
  assert.doesNotMatch(index, /harPremium/);
  assert.doesNotMatch(index, /krever Premium/);
  assert.doesNotMatch(index, /from\("horingssvar"\)/);
  assert.doesNotMatch(index, /UTSENDING_AKTIV/);
  assert.match(toml, /\[functions\.horingshjelp\]\s+verify_jwt = true/);
});
