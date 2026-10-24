// Tester for hent-saker-logikken. Kjøres med Node sin innebygde testkjører:
//   npm test   (= node --test supabase/functions/hent-saker/logikk.test.ts)
// Kjøres også automatisk i GitHub Actions på hver push (.github/workflows/ci.yml).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adapterFraKildeUrl,
  byggVarselRad,
  dedupEtterInnhold,
  dedupEtterKilde,
  dekodXml,
  erKulturRelevant,
  erKulturSak,
  erPortefoljesak,
  byggSammendragPrompt,
  kategoriForEinnsyn,
  erRegjeringenHoring,
  erRenIdrett,
  ekstraFristside,
  leggPaHoringsfrist,
  parseHoringsliste,
  planleggEmneDedup,
  sakstypeFraSak,
  erRegjeringenRelevant,
  finnHøringsfrist,
  innholdDedupNokkel,
  kildeNokkel,
  kildeUuidForAdapter,
  normaliserKildeUrl,
  parseRegjeringenFrist,
  utenManuelleTekstfelt,
  parseStortingetDato,
  parseStortingetTidspunkt,
  kalenderdag,
  statusForSak,
  statusFraFrist,
  parseRssItems,
  stortingsSesjoner,
} from "./logikk.ts";

// ─── erKulturRelevant ─────────────────────────────────────────────────────────

test("kultursak fanges opp", () => {
  assert.equal(erKulturRelevant("Endringer i kulturloven"), true);
  assert.equal(erKulturRelevant("Ny tilskuddsordning for scenekunst"), true);
});

test("ikke-kultursak avvises", () => {
  assert.equal(erKulturRelevant("Nasjonal transportplan 2026-2037"), false);
  assert.equal(erKulturRelevant("Endringer i skatteloven"), false);
});

test("negativ liste overstyrer positiv treff (komité-fellen)", () => {
  // «Familie- og kulturkomiteen» inneholder «kultur», men saken handler om beredskap
  assert.equal(
    erKulturRelevant(
      "Familie- og kulturkomiteen behandler ny beredskapsavtale for redningshelikopter",
    ),
    false,
  );
});

test("store bokstaver spiller ingen rolle", () => {
  assert.equal(erKulturRelevant("KULTURSKOLENS FRAMTID"), true);
});

test("spillemidler fanges opp (nøkkelordet var feilstavet «spillmidler»)", () => {
  assert.equal(
    erKulturRelevant("Fordeling av spillemidler til idretts- og kulturformål"),
    true,
  );
});

test("relevans kan komme fra sammendraget, ikke bare tittelen", () => {
  assert.equal(
    erKulturRelevant(
      "Prop. 44 S",
      "Bevilgningsendringer for museer og bibliotek",
    ),
    true,
  );
});

// ─── statusFraFrist ───────────────────────────────────────────────────────────

const NÅ = new Date("2026-07-23T12:00:00Z").getTime();
const omDager = (d: number) =>
  new Date(NÅ + d * 86400000).toISOString().split("T")[0];

test("frist om ≤7 dager er kritisk", () => {
  assert.equal(statusFraFrist(omDager(3), NÅ), "kritisk");
  assert.equal(statusFraFrist(omDager(7), NÅ), "kritisk");
});

test("frist om 8-21 dager er viktig", () => {
  assert.equal(statusFraFrist(omDager(8), NÅ), "viktig");
  assert.equal(statusFraFrist(omDager(21), NÅ), "viktig");
});

test("frist langt frem er normal", () => {
  assert.equal(statusFraFrist(omDager(60), NÅ), "normal");
});

test("utløpt frist er passert, ikke kritisk", () => {
  assert.equal(statusFraFrist(omDager(-1), NÅ), "passert");
  assert.equal(statusFraFrist(omDager(-5), NÅ), "passert");
});

test("frist i dag er fortsatt kritisk", () => {
  assert.equal(statusFraFrist(kalenderdag(NÅ), NÅ), "kritisk");
});

test("manglende frist er normal", () => {
  assert.equal(statusFraFrist(null, NÅ), "normal");
});

test("status uten frist er normal, og passert møte er passert", () => {
  assert.equal(statusForSak(null, null, NÅ), "normal");
  assert.equal(statusForSak(null, "2026-06-01", NÅ), "passert");
  assert.equal(statusForSak("2026-11-23", "2026-06-01", NÅ), "normal");
  assert.equal(statusForSak(null, kalenderdag(NÅ), NÅ), "kritisk");
});

test("ugyldig dato krasjer ikke, blir normal", () => {
  assert.equal(statusFraFrist("ikke-en-dato", NÅ), "normal");
});

// ─── parseStortingetDato ──────────────────────────────────────────────────────

test("epoch-format med tidssone: midnatt norsk tid blir riktig dag", () => {
  // 1760479200000 ms = 15.10.2025 00:00 +0200 — uten offset-håndtering
  // ville UTC-konvertering gitt 14.10.2025
  assert.equal(parseStortingetDato("/Date(1760479200000+0200)/"), "2025-10-15");
});

test("norsk datoformat parses", () => {
  assert.equal(parseStortingetDato("21.10.2025 00:00:00"), "2025-10-21");
});

test("placeholder 01.01.0001 blir null", () => {
  assert.equal(parseStortingetDato("01.01.0001 00:00:00"), null);
});

test("Stortinget-epoch blir UTC-tidsstempel, placeholder blir null", () => {
  assert.equal(
    parseStortingetTidspunkt("/Date(1791842400000+0200)/"),
    "2026-10-12T22:00:00.000Z",
  );
  assert.equal(parseStortingetDato("/Date(1791842400000+0200)/"), "2026-10-13");
  assert.equal(parseStortingetTidspunkt("01.01.0001 00:00:00"), null);
  assert.equal(parseStortingetTidspunkt("21.10.2025 00:00:00"), "2025-10-21T00:00:00.000Z");
});

test("tom/ugyldig dato blir null", () => {
  assert.equal(parseStortingetDato(null), null);
  assert.equal(parseStortingetDato(""), null);
  assert.equal(parseStortingetDato("tullball"), null);
});

// ─── erKulturSak ──────────────────────────────────────────────────────────────

test("FAMKULT-komitésak er kultursak uansett tittel", () => {
  assert.equal(
    erKulturSak({ komite: { id: "FAMKULT" }, tittel: "Endringer i åndsverkloven" }),
    true,
  );
});

test("hovedemne 6 (Kultur) er kultursak", () => {
  assert.equal(
    erKulturSak({ emne_liste: [{ id: 6, navn: "Kultur" }], tittel: "Prop. 1 S" }),
    true,
  );
});

test("transportsak i annen komité er ikke kultursak", () => {
  assert.equal(
    erKulturSak({
      komite: { id: "TRANSKOM" },
      emne_liste: [{ id: 30, navn: "Samferdsel" }],
      tittel: "Utbygging av E6",
    }),
    false,
  );
});

test("nøkkelord i tittel fanger kultursak utenfor komiteen", () => {
  assert.equal(
    erKulturSak({ komite: { id: "FINANS" }, tittel: "Momsfritak for musikkfestivaler" }),
    true,
  );
});

// ─── finnHøringsfrist ─────────────────────────────────────────────────────────

const SAK_MED_FRISTER = {
  saksgang: {
    saksgang_steg_liste: [
      { saksgang_hendelse_liste: [{ id: "FREMMET", dato: "15.10.2025 00:00:00" }] },
      {
        saksgang_hendelse_liste: [
          { id: "HOERFRIST", dato: "21.10.2025 00:00:00" },
          { id: "HOERFRIST", dato: "12.11.2025 00:00:00" },
          { id: "HOER", dato: "30.10.2025 00:00:00" },
        ],
      },
    ],
  },
};

test("velger siste HOERFRIST (skriftlig innspillsfrist)", () => {
  assert.equal(finnHøringsfrist(SAK_MED_FRISTER), "2025-11-12");
});

test("sak uten HOERFRIST gir null", () => {
  assert.equal(
    finnHøringsfrist({
      saksgang: {
        saksgang_steg_liste: [
          { saksgang_hendelse_liste: [{ id: "FREMMET", dato: "15.10.2025 00:00:00" }] },
        ],
      },
    }),
    null,
  );
});

test("HOERFRIST med placeholder-dato ignoreres", () => {
  assert.equal(
    finnHøringsfrist({
      saksgang: {
        saksgang_steg_liste: [
          { saksgang_hendelse_liste: [{ id: "HOERFRIST", dato: "01.01.0001 00:00:00" }] },
        ],
      },
    }),
    null,
  );
});

test("tom saksgang krasjer ikke", () => {
  assert.equal(finnHøringsfrist({}), null);
  assert.equal(finnHøringsfrist({ saksgang: null }), null);
});

// ─── eInnsyn-adapter (mapEInnsynItem) ─────────────────────────────────────────

test("eInnsyn-møtesak mappes med kanonisk lenke, organnavn og geografi", async () => {
  const { mapEInnsynItem } = await import("./einnsyn.ts");
  const mappet = mapEInnsynItem(
    {
      id: "ms_01kpxnyfghest8sjkpe3dak0ev",
      offentligTittel: "Kultur- og miljøprisen 2025",
      publisertDato: "2026-04-23T17:24:34.443401Z",
      journalenhet: "enh_x",
      moetesaksaar: 2026,
      moetesakssekvensnummer: 13,
    },
    { navn: "Stavanger kommune", kommunenr: "1103", fylkesnr: "11", sted: "Stavanger", niva: "kommune" },
  );
  assert.equal(mappet?.tittel, "Kultur- og miljøprisen 2025");
  assert.equal(mappet?.instans, "Stavanger kommune");
  assert.equal(
    mappet?.kilde,
    "https://einnsyn.no/moetesak/ms_01kpxnyfghest8sjkpe3dak0ev",
  );
  assert.equal(mappet?.publisert_dato, "2026-04-23");
  assert.equal(mappet?.kilde_publisert, "2026-04-23T17:24:34.443401Z");
  assert.equal(mappet?.forhåndsgodkjent, true);
  assert.equal(mappet?.kommunenr, "1103");
  assert.equal(mappet?.fylkesnr, "11");
  assert.equal(mappet?.sted, "Stavanger");
  assert.equal(mappet?.niva, "kommune");
});

test("eInnsyn-item uten geo får fallback-organ og nullfelt, uten id/tittel forkastes", async () => {
  const { mapEInnsynItem } = await import("./einnsyn.ts");
  const utenGeo = mapEInnsynItem({ id: "ms_1", offentligTittel: "Sak" }, undefined);
  assert.equal(utenGeo?.instans, "Organ i eInnsyn");
  assert.equal(utenGeo?.kommunenr, null);
  assert.equal(utenGeo?.niva, null);
  assert.equal(mapEInnsynItem({ offentligTittel: "Mangler id" }), null);
  assert.equal(mapEInnsynItem({ id: "ms_2" }), null);
});

test("stortingsSesjoner følger Europe/Oslo og tar med forrige sesjon", () => {
  // 30. sept 2026 23:59 norsk tid (CEST, UTC+2)
  assert.deepEqual(
    stortingsSesjoner(Date.parse("2026-09-30T21:59:00Z")),
    ["2025-2026", "2024-2025"],
  );
  // 1. okt 2026 00:00 norsk tid
  assert.deepEqual(
    stortingsSesjoner(Date.parse("2026-09-30T22:00:00Z")),
    ["2026-2027", "2025-2026"],
  );
  // 1. jan 2027 00:30 norsk tid (CET) er fortsatt sesjonen som startet i oktober
  assert.deepEqual(
    stortingsSesjoner(Date.parse("2026-12-31T23:30:00Z")),
    ["2026-2027", "2025-2026"],
  );
});

test("Brreg-geo: bare kommuneforvaltning får kommune, fylkeskommune får ikke by", async () => {
  const { fylkesnrFraKommunenr, geografiFraBrreg } = await import("./einnsyn.ts");
  assert.equal(fylkesnrFraKommunenr("4601"), "46");
  assert.equal(fylkesnrFraKommunenr("46"), null);
  assert.equal(geografiFraBrreg(null).niva, null);

  const stat = geografiFraBrreg({
    institusjonellSektorkode: { kode: "6100" },
    forretningsadresse: { kommunenummer: "0301", kommune: "OSLO" },
  });
  assert.equal(stat.niva, "nasjonalt");
  assert.equal(stat.kommunenr, null);

  const kommune = geografiFraBrreg({
    institusjonellSektorkode: { kode: "6500" },
    organisasjonsform: { kode: "KOMM" },
    forretningsadresse: { kommunenummer: "1103", kommune: "STAVANGER" },
  }, "Stavanger kommune");
  assert.equal(kommune.niva, "kommune");
  assert.equal(kommune.kommunenr, "1103");
  assert.equal(kommune.fylkesnr, "11");
  assert.equal(kommune.sted, "Stavanger");

  const fylke = geografiFraBrreg({
    institusjonellSektorkode: { kode: "6500" },
    organisasjonsform: { kode: "FYLK" },
    forretningsadresse: { kommunenummer: "4601", kommune: "BERGEN" },
  }, "VESTLAND FYLKESKOMMUNE");
  assert.equal(fylke.niva, "fylke");
  assert.equal(fylke.kommunenr, null);
  assert.equal(fylke.fylkesnr, "46");
  assert.equal(fylke.sted, "Vestland fylkeskommune");
});

test("nivaFraEnhetstype utleder nivå fra eInnsyn-enhetstype", async () => {
  const { nivaFraEnhetstype } = await import("./einnsyn.ts");
  assert.equal(nivaFraEnhetstype("BYDEL"), "kommune");
  assert.equal(nivaFraEnhetstype("KOMMUNE"), "kommune");
  assert.equal(nivaFraEnhetstype("FYLKESKOMMUNE"), "fylke");
  assert.equal(nivaFraEnhetstype("DEPARTEMENT"), "nasjonalt");
  assert.equal(nivaFraEnhetstype("VIRKSOMHET"), null);
  assert.equal(nivaFraEnhetstype("ORGAN"), null);
  assert.equal(nivaFraEnhetstype(undefined), null);
});

test("Oslo kommune og fylkesting får nivå fra organet, ikke fra Claude", async () => {
  const { avklarEinnsynGeo, geografiFraBrreg, geografiSomLagres } = await import("./einnsyn.ts");
  const oslo = geografiFraBrreg({
    organisasjonsform: { kode: "ORGL" },
    institusjonellSektorkode: { kode: "6500" },
    forretningsadresse: { kommunenummer: "0301", kommune: "OSLO" },
  }, "Bystyrets sekretariat");
  assert.equal(oslo.niva, "kommune");
  assert.equal(oslo.sted, "Oslo");
  assert.equal(oslo.kommunenr, "0301");

  const akershus = avklarEinnsynGeo({
    enhetstype: "BYDEL",
    navn: "Akershus fylkesting",
    brreg: {
      organisasjonsform: { kode: "BEDR" },
      postadresse: { kommunenummer: "0301", kommune: "OSLO" },
      overordnetEnhet: "930580783",
    },
    overordnet: {
      navn: "AKERSHUS FYLKESKOMMUNE",
      organisasjonsform: { kode: "FYLK" },
    },
  });
  assert.equal(akershus.niva, "fylke");
  assert.equal(akershus.sted, "Akershus fylkesting");
  assert.equal(akershus.kommunenr, null);

  const lagret = geografiSomLagres(
    { niva: "kommune", sted: "Oslo", instans: "Bystyrets sekretariat" },
    "nasjonalt",
  );
  assert.equal(lagret.niva, "kommune");
  assert.equal(lagret.sted, "Oslo");

  const utenGeo = geografiSomLagres(
    { niva: null, sted: null, instans: "Bystyrets sekretariat" },
    "nasjonalt",
  );
  assert.equal(utenGeo.niva, "kommune");
  assert.equal(utenGeo.sted, "Oslo");

  const bydel = geografiSomLagres(
    { niva: "kommune", sted: null, instans: "Bydel Ullern" },
    "nasjonalt",
  );
  assert.equal(bydel.niva, "kommune");
  assert.equal(bydel.sted, "Bydel Ullern");
});

// ─── parseRssItems ────────────────────────────────────────────────────────────

const EKSEMPEL_RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
  <title>Kulturdepartementet</title>
  <item>
    <title><![CDATA[Høring: endringer i kulturlova]]></title>
    <link>https://www.regjeringen.no/no/dokumenter/horing-kulturlova/id1/</link>
    <description><![CDATA[<p>Departementet sender med dette <b>forslag</b> på høring.</p>]]></description>
    <pubDate>Mon, 20 Jul 2026 08:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Vanlig tittel uten CDATA</title>
    <link>https://www.regjeringen.no/no/aktuelt/sak2/id2/</link>
    <description>Kort beskrivelse</description>
  </item>
  <item>
    <title>Mangler lenke og skal hoppes over</title>
    <description>Denne skal ikke med</description>
  </item>
</channel></rss>`;

test("parser CDATA- og vanlige titler, hopper over items uten lenke", () => {
  const items = parseRssItems(EKSEMPEL_RSS, "Kulturdepartementet");
  assert.equal(items.length, 2);
  assert.equal(items[0].tittel, "Høring: endringer i kulturlova");
  assert.equal(items[1].tittel, "Vanlig tittel uten CDATA");
});

test("html strippes fra beskrivelse", () => {
  const items = parseRssItems(EKSEMPEL_RSS, "Kulturdepartementet");
  assert.equal(
    items[0].sammendrag_raa,
    "Departementet sender med dette forslag på høring.",
  );
});

test("pubDate blir ISO-dato, manglende pubDate blir null", () => {
  const items = parseRssItems(EKSEMPEL_RSS, "Kulturdepartementet");
  assert.equal(items[0].publisert_dato, "2026-07-20");
  assert.equal(items[0].kilde_publisert, "2026-07-20T08:00:00.000Z");
  assert.equal(items[1].publisert_dato, null);
  assert.equal(items[1].kilde_publisert, null);
});

test("kilde_id og instans settes riktig", () => {
  const items = parseRssItems(EKSEMPEL_RSS, "Kulturdepartementet");
  assert.equal(
    items[0].kilde_id,
    "rss-https://www.regjeringen.no/no/dokumenter/horing-kulturlova/id1/",
  );
  assert.equal(items[0].instans, "Kulturdepartementet");
});

test("tomt/ugyldig RSS gir tom liste, ikke krasj", () => {
  assert.deepEqual(parseRssItems("", "X"), []);
  assert.deepEqual(parseRssItems("<html>404 not found</html>", "X"), []);
});

test("normalisert kilde-URL slår sammen Stortinget-dubletter og beholder fragment", () => {
  const a = "https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=200362";
  const b = "HTTPS://WWW.STORTINGET.NO/no/Saker-og-publikasjoner/Saker/Sak/?p=200362";
  assert.equal(normaliserKildeUrl(a), normaliserKildeUrl(b));
  assert.equal(
    normaliserKildeUrl("https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=200367"),
    "https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak?p=200367",
  );
  assert.notEqual(
    normaliserKildeUrl(a),
    normaliserKildeUrl("https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=200367"),
  );
  assert.notEqual(
    normaliserKildeUrl("https://www.kulturdirektoratet.no/vedtak#FLB-AUDIO-2026-02-20"),
    normaliserKildeUrl("https://www.kulturdirektoratet.no/vedtak#FLB-CINE-2026-02-20"),
  );
  assert.equal(
    normaliserKildeUrl("https://www.stortinget.no:443/no/Saker/?b=2&a=1"),
    "https://www.stortinget.no/no/Saker?a=1&b=2",
  );
  assert.equal(normaliserKildeUrl("  "), null);
  assert.equal(normaliserKildeUrl(null), null);
});

test("dedup beholder første rad per normalisert URL og hopper over allerede lagret", () => {
  const lagret = normaliserKildeUrl(
    "https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=200362",
  );
  const ut = dedupEtterKilde(
    [
      { id: "ny", kilde: "https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=200367" },
      { id: "dublett", kilde: "HTTPS://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=200367" },
      { id: "gammel", kilde: "https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=200362" },
      { id: "runde-a", kilde: "https://www.kulturdirektoratet.no/vedtak#A" },
      { id: "runde-b", kilde: "https://www.kulturdirektoratet.no/vedtak#B" },
    ],
    lagret ? [lagret] : [],
  );
  assert.deepEqual(ut.map((r) => r.id), ["ny", "runde-a", "runde-b"]);
});

// ─── Regjeringen oktober 2026: porterfølje, frist, entiteter ─────────────────

const BUDSJETT_TITLER = [
  "Statsbudsjettet 2027: Eit rekordstort kulturbudsjett for fellesskap",
  "Statsbudsjettet 2027: Regjeringa styrker redaktørstyrte medium i ei uroleg tid",
  "Statsbudsjettet 2027: Arbeidarparti-regjeringa held fram styrkinga på dansefeltet i heile landet",
  "Statsbudsjettet 2027: Æresløn til Mari Boine",
  "Statsbudsjettet 2027: Regjeringa gir stønad til fem nye prosjekt i ordninga Nasjonale kulturbygg",
  "Statsbudsjettet 2027: Meir til kunstnarane i Statens kunstnarstipend",
  "Statsbudsjettet 2027: Arbeidarparti-regjeringa styrker filmfeltet med 75 millionar kroner",
  "Statsbudsjettet 2027: Full momskompensasjon for frivilligheit og idrett også i 2027",
];

test("KUD-porteføljen fra oktober 2026 er relevant, også uten kulturord i brødteksten", () => {
  const saker: Array<[string, string]> = [
    ...BUDSJETT_TITLER.map((t): [string, string] => [t, ""]),
    [
      "Retningslinjer - Tilskudd fra Kultur- og likestillingsdepartementet til nasjonale kulturbygg for 2028",
      "Søknadsfristen for 2027 var 1. januar 2026. For 2028 er fristen 1. desember 2026.",
    ],
    [
      "Innspill til kvotefordelingen av kunstnerstipendmidlene for 2027",
      "Frist: 20. november 2026",
    ],
    [
      "Høring - forslag til endringer i kringkastingsforskriften",
      "Forslaget gjelder lokalradio og FM-nettet.",
    ],
    [
      "Høring - forslag til endringer i pengespillforskriften",
      "Forslaget gjelder nettpoker og ansvarlig spill.",
    ],
    [
      "Høring av Lotteri- og stiftelsestilsynets utredning om regulering av pengespill-lignende elementer i dataspill",
      "Utredningen omtaler lootbokser. Filminstituttet er høringsinstans.",
    ],
    [
      "Redegjørelse av kultur- og likestillingsministeren om mediepolitikk og ytringsfrihet",
      "",
    ],
  ];
  for (const [tittel, tekst] of saker) {
    assert.equal(erPortefoljesak(tittel, tekst), true, tittel);
    assert.equal(erRegjeringenRelevant(tittel, tekst), true, tittel);
  }
});

test("toppidrettssenter er idrett og slipper ikke gjennom, momskompensasjon med frivillighet gjør", () => {
  const toppidrett = "Statsbudsjettet 2027: Regjeringa vil ha nytt nasjonalt toppidrettssenter";
  assert.equal(erRenIdrett(toppidrett), true);
  assert.equal(erPortefoljesak(toppidrett), false);
  assert.equal(erRegjeringenRelevant(toppidrett), false);
  const moms = "Statsbudsjettet 2027: Full momskompensasjon for frivilligheit og idrett også i 2027";
  assert.equal(erRenIdrett(moms), false);
  assert.equal(erRegjeringenRelevant(moms), true);
});

test("presseinvitasjon, nynorskkommune, ministerbesøk og barnevern-redegjørelse er ikke portefølje", () => {
  assert.equal(
    erRegjeringenRelevant(
      "Presseinvitasjon: Kultur- og likestillingsministeren legger fram kulturbudsjettet",
      "Kulturbygg og stipend",
    ),
    false,
  );
  assert.equal(erRegjeringenRelevant("Volda er årets nynorskkommune"), false);
  assert.equal(
    erRegjeringenRelevant(
      "Kultur- og likestillingsministeren besøker Kina",
      "Kultur- og likestillingsdepartementet deltar på møtet.",
    ),
    false,
  );
  const barnevern = "Redegjørelse av barne- og familieministeren om situasjonen i barnevernet";
  assert.equal(erPortefoljesak(barnevern), false);
  assert.equal(erRegjeringenRelevant(barnevern), false);
});

test("innspill og regjeringshøring får sakstype horing", () => {
  assert.equal(sakstypeFraSak({
    tittel: "Innspill til kvotefordelingen av kunstnerstipendmidlene for 2027",
    instans: "KUD – nyhet",
  }), "horing");
  assert.equal(sakstypeFraSak({
    tittel: "Høring av Lotteri- og stiftelsestilsynets utredning om regulering av pengespill-lignende elementer i dataspill",
    instans: "Regjeringen – høring",
  }), "horing");
  assert.equal(sakstypeFraSak({
    tittel: "Statsbudsjettet 2027: Arbeidarparti-regjeringa styrker filmfeltet med 75 millionar kroner",
    instans: "KUD – nyhet",
  }), "budsjett");
});

test("nyhet om samme sak kobles til høringen, og talen til hovedpressemeldingen", () => {
  const horingPoker = {
    id: "d3938f34",
    tittel: "Høring - forslag til endringer i pengespillforskriften",
    instans: "KUD – høring",
    kilde: "https://www.regjeringen.no/no/dokumenter/pengespill/id3171815/",
    sammendrag: "Forslaget gjelder nettpoker.",
  };
  const nyhetPoker = {
    tittel: "Foreslår å tillate nettpoker hos Norsk Tipping",
    instans: "KUD – nyhet",
    kilde: "https://www.regjeringen.no/no/aktuelt/nettpoker/id3173410/",
    sammendrag_raa: "Pressemelding om nettpoker.",
  };
  const motHoring = planleggEmneDedup([nyhetPoker], [horingPoker]);
  assert.deepEqual(motHoring.behold, []);
  assert.equal(motHoring.koblinger[0].hovedsakId, "d3938f34");

  const horingSpill = {
    id: "90a26730",
    tittel: "Høring av Lotteri- og stiftelsestilsynets utredning om regulering av pengespill-lignende elementer i dataspill",
    instans: "Regjeringen – høring",
    kilde: "https://www.regjeringen.no/no/dokumenter/dataspill/id3176704/",
  };
  const nyhetSpill = {
    tittel: "Vurderer strengere regulering av lootbokser i dataspill",
    instans: "KUD – nyhet",
    kilde: "https://www.regjeringen.no/no/aktuelt/lootbokser/id3177013/",
  };
  const loot = planleggEmneDedup([nyhetSpill, horingSpill], []);
  assert.equal(loot.behold.length, 1);
  assert.equal(loot.behold[0].tittel, horingSpill.tittel);
  assert.equal(loot.koblinger[0].item.tittel, nyhetSpill.tittel);

  const hoved = {
    id: "89ee020f",
    tittel: "Statsbudsjettet 2027: Eit rekordstort kulturbudsjett for fellesskap",
    instans: "KUD – nyhet",
    kilde: "https://www.regjeringen.no/no/aktuelt/kulturbudsjett/id3174117/",
  };
  const tale = {
    tittel: "Tale ved fremleggelse av Kultur- og likestillingsbudsjettet 2027",
    instans: "KUD – statsbudsjett",
    kilde: "https://www.regjeringen.no/no/aktuelt/tale/id3176653/",
  };
  const film = {
    tittel: "Statsbudsjettet 2027: Arbeidarparti-regjeringa styrker filmfeltet med 75 millionar kroner",
    instans: "KUD – nyhet",
    kilde: "https://www.regjeringen.no/no/aktuelt/film/id3174115/",
  };
  const budsjett = planleggEmneDedup([tale, film], [hoved]);
  assert.equal(budsjett.behold.length, 1);
  assert.equal(budsjett.behold[0].tittel, film.tittel);
  assert.equal(budsjett.koblinger.length, 1);
  assert.equal(budsjett.koblinger[0].hovedsakId, "89ee020f");
});

test("sammendragsprompten krever nøytral bokmål og avviser pressemeldingsspråk", () => {
  const prompt = byggSammendragPrompt({
    tittel: "Statsbudsjettet 2027: Eit rekordstort kulturbudsjett for fellesskap",
    sammendrag_raa: "Arbeidarparti-regjeringa foreslår ei løyving på rekordstore 28,1 milliardar kroner.",
    instans: "KUD – nyhet",
    frist: null,
  });
  assert.match(prompt, /nøytral bokmål/);
  assert.match(prompt, /nynorsk/);
  assert.match(prompt, /partimerkelapp/);
  assert.match(prompt, /rekordstor/);
  assert.match(prompt, /innfrir lovnaden/);
  assert.match(prompt, /Ikke gjett/);
});

test("hørings- og tilskuddsfrister leses, og seneste merkede dato vinner", () => {
  assert.equal(
    parseRegjeringenFrist("<p>Høringsfrist: 12.01.2027</p><p>Frist for å sende inn høringssvar er 12. januar 2027.</p>"),
    "2027-01-12",
  );
  assert.equal(parseRegjeringenFrist("Høringsfrist 12.11.2026"), "2026-11-12");
  assert.equal(parseRegjeringenFrist("Høyringsfrist: 12. november 2026"), "2026-11-12");
  assert.equal(parseRegjeringenFrist("Høringsfrist: 29. november 2026"), "2026-11-29");
  assert.equal(parseRegjeringenFrist("Frist: 20. november 2026"), "2026-11-20");
  assert.equal(
    parseRegjeringenFrist(
      "Frist for søknad om investeringstilskudd over statsbudsjettet for 2027 er 1. januar 2026. Merk at søknadsfristen for søknader til statsbudsjettet for 2028 er flyttet fram en måned, slik at fristen er 1. desember 2026.",
    ),
    "2026-12-01",
  );
  assert.equal(
    parseRegjeringenFrist("Høringsfrist: 12.10.2026. Ny høringsfrist: 28.10.2026."),
    "2026-10-28",
  );
  assert.equal(parseRegjeringenFrist("Publisert 14. oktober 2026 uten merket frist."), null);
  assert.equal(
    ekstraFristside(
      "Retningslinjer - Tilskudd fra Kultur- og likestillingsdepartementet til nasjonale kulturbygg for 2028",
    ),
    "https://www.regjeringen.no/no/dep/kud/tilskudd/tilskudd-til-nasjonale-kulturbygg-og-tus/id86015/",
  );
  assert.equal(ekstraFristside("Statsbudsjettet 2027: Eit rekordstort kulturbudsjett for fellesskap"), null);
});

test("høringslisten gir frist per sak, og publiseringsdatoen blir ikke frist", () => {
  const html = `
<ul>
<li class="listItem">
  <a href="/no/dokumenter/horing-dataspill/id3176704/">Høring av Lotteri- og stiftelsestilsynets utredning om regulering av pengespill-lignende elementer i dataspill</a>
  <span class="date">12.10.2026</span>
  <span class="event-details">H&#xF8;ringsfrist: 12.01.2027</span>
</li>
<li class="listItem">
  <a href="/no/dokumenter/kringkasting/id3173432/?utm_source=regjeringen.no&amp;utm_medium=rss">Høring - forslag til endringer i kringkastingsforskriften</a>
  <span class="date">30.09.2026</span>
  <span class="event-details">Høringsfrist: 12.11.2026</span>
</li>
<li class="listItem">
  <a href="/no/dokumenter/pengespill/id3171815/">Høring - forslag til endringer i pengespillforskriften</a>
  <span class="date">29.09.2026</span>
  <span class="event-details">Høringsfrist: 29.11.2026</span>
</li>
<li class="listItem">
  <a href="/no/dokumenter/arkiv/id9/">Høyring - arkivforskrifta</a>
  <span class="date">05.09.2025</span>
  <span class="event-details">Høyringsfrist: 01.11.2025</span>
</li>
</ul>`;
  const liste = parseHoringsliste(html);
  assert.deepEqual(liste, [
    { id: "3176704", frist: "2027-01-12" },
    { id: "3173432", frist: "2026-11-12" },
    { id: "3171815", frist: "2026-11-29" },
    { id: "9", frist: "2025-11-01" },
  ]);
  const med = leggPaHoringsfrist(
    [
      {
        tittel: "dataspill",
        kilde: "https://www.regjeringen.no/no/dokumenter/horing-dataspill/id3176704/?utm_source=regjeringen.no&amp;utm_medium=rss",
        frist: null,
      },
      {
        tittel: "allerede",
        kilde: "https://www.regjeringen.no/no/dokumenter/kringkasting/id3173432/",
        frist: "2026-11-01",
      },
      { tittel: "nyhet", kilde: "https://www.regjeringen.no/no/aktuelt/noe/id1/", frist: null },
    ],
    liste,
  );
  assert.equal(med[0].frist, "2027-01-12");
  assert.equal(med[1].frist, "2026-11-01");
  assert.equal(med[2].frist, null);
  assert.equal(erRegjeringenHoring({ instans: "KUD – høring", tittel: "Forslag" }), true);
  assert.equal(erRegjeringenHoring({ instans: "KUD – nyhet", tittel: "Statsbudsjettet 2027: kulturbudsjett" }), false);
});

test("RSS dekoder &amp; og dedup treffer rader som fortsatt har entiteten", () => {
  const kodet = "https://www.regjeringen.no/no/dokumenter/horing/id1/?a=1&amp;b=2";
  const dekodet = "https://www.regjeringen.no/no/dokumenter/horing/id1/?a=1&b=2";
  const items = parseRssItems(
    `<rss><channel><item><title>Høring &amp; kultur</title><link>${kodet}</link><description>Kulturbudsjettet</description></item></channel></rss>`,
    "KUD – høring",
  );
  assert.equal(items[0].tittel, "Høring & kultur");
  assert.equal(items[0].kilde, dekodet);
  assert.equal(dekodXml(kodet), dekodet);
  assert.equal(kildeNokkel(kodet), kildeNokkel(dekodet));
  const ut = dedupEtterKilde(
    [{ id: "ny", kilde: dekodet }],
    [kildeNokkel(kodet)!],
  );
  assert.deepEqual(ut, []);
});

test("innholdsnøkkel slår sammen møtesak med ulik URL og skiller Stortinget-saker", () => {
  const ostfold = {
    instans: "Østfold fylkeskommune",
    tittel: "Tilskuddsordninger kultur og idrett - orientering om tildelinger 2026",
    frist: null,
  };
  assert.equal(
    innholdDedupNokkel({
      ...ostfold,
      kilde: "https://einnsyn.no/moetesak/ms_01m20gmwb2ebbt19bpqjxp7v3v",
    }),
    innholdDedupNokkel({
      ...ostfold,
      kilde: "https://einnsyn.no/moetesak/ms_01m22y2538ezjr23mbf5z13jd8",
    }),
  );
  assert.equal(
    innholdDedupNokkel({
      instans: "Bergen bystyre, Bergen kommune",
      tittel: "Overføring av landbruksoppgaver til myndighetsnivå 1 i Byrådsavdeling for næring, kultur og idrett",
      frist: null,
      kilde: "https://www.bergen.kommune.no/politikk/politiskeutvalg/571424/mote/9064081/sak/269441",
    }),
    innholdDedupNokkel({
      instans: "Bergen bystyre, Bergen kommune",
      tittel: "Overføring av landbruksoppgaver til myndighetsnivå 1 i Byrådsavdeling for næring, kultur og idrett",
      frist: null,
      kilde: "https://www.bergen.kommune.no/politikk/politiskeutvalg/571424/mote/9064089/sak/270599",
    }),
  );
  assert.equal(
    innholdDedupNokkel({
      instans: "Bydel Ullern",
      tittel: "Årshjul Ullern kultur - og oppvekstkomite 2026",
      frist: null,
      kilde: "https://einnsyn.no/moetesak/ms_a",
    }),
    innholdDedupNokkel({
      instans: "Bydel Ullern",
      tittel: "Årshjul Ullern kultur- og oppvekstkomite 2026",
      frist: null,
      kilde: "https://einnsyn.no/moetesak/ms_b",
    }),
  );

  const stortingTittel =
    "Endringer i åndsverkloven mv. (gjennomføring av nett- og videresendingsdirektivet)";
  assert.notEqual(
    innholdDedupNokkel({
      instans: "Familie- og kulturkomiteen, Stortinget",
      tittel: stortingTittel,
      frist: null,
      kilde: "https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=200242",
    }),
    innholdDedupNokkel({
      instans: "Familie- og kulturkomiteen, Stortinget",
      tittel: stortingTittel,
      frist: null,
      kilde: "https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=200243",
    }),
  );
  assert.notEqual(
    innholdDedupNokkel({
      instans: "Stortinget",
      tittel: "Høring om kulturloven",
      frist: "2026-11-01",
      kilde: "https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=1",
    }),
    innholdDedupNokkel({
      instans: "Stortinget",
      tittel: "Høring om kulturloven",
      frist: "2026-12-01",
      kilde: "https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=1",
    }),
  );
  assert.notEqual(
    innholdDedupNokkel({
      instans: "Regjeringen",
      tittel: "Høring",
      frist: null,
      kilde: "https://www.regjeringen.no/no/dokumenter/horing/id111/",
    }),
    innholdDedupNokkel({
      instans: "Regjeringen",
      tittel: "Høring",
      frist: null,
      kilde: "https://www.regjeringen.no/no/dokumenter/horing/id222/",
    }),
  );
});

test("innholdsdedup beholder første og hopper over allerede lagret møtesak", () => {
  const lagret = innholdDedupNokkel({
    instans: "Østfold fylkeskommune",
    tittel: "Tilskuddsordninger kultur og idrett - orientering om tildelinger 2026",
    frist: null,
    kilde: "https://einnsyn.no/moetesak/ms_eldst",
  });
  const ut = dedupEtterInnhold(
    [
      {
        id: "ny-url",
        instans: "Østfold fylkeskommune",
        tittel: "Tilskuddsordninger kultur og idrett - orientering om tildelinger 2026",
        frist: null,
        kilde: "https://einnsyn.no/moetesak/ms_ny",
      },
      {
        id: "annen",
        instans: "Bergen bystyre, Bergen kommune",
        tittel: "Annen sak",
        frist: null,
        kilde: "https://www.bergen.kommune.no/politikk/sak/1",
      },
    ],
    lagret ? [lagret] : [],
  );
  assert.deepEqual(ut.map((r) => r.id), ["annen"]);
});

test("manuelt redigerte rader mister ikke tittel, sammendrag, kategori, frist eller møtedato", () => {
  const rad = {
    tittel: "Ny tittel fra backfill",
    sammendrag: "Nytt sammendrag",
    kategori: "musikk",
    frist: "2026-11-23",
    motedato: "2026-10-27",
    status: "viktig",
  };
  assert.deepEqual(utenManuelleTekstfelt(rad, false), rad);
  assert.deepEqual(utenManuelleTekstfelt({ ...rad, frist: null, motedato: null }, true), {});
});

// ─── kilde_id og konsistent kilde_nokkel ──────────────────────────────────────

const REGISTER = new Map([
  ["stortinget-saker", { id: "11111111-1111-1111-1111-111111111111" }],
  ["stortinget-ventede", { id: "22222222-2222-2222-2222-222222222222" }],
  ["regjeringen-rss", { id: "33333333-3333-3333-3333-333333333333" }],
  ["einnsyn", { id: "44444444-4444-4444-4444-444444444444" }],
  ["bergen", { id: "55555555-5555-5555-5555-555555555555" }],
  ["kulturdirektoratet", { id: "66666666-6666-6666-6666-666666666666" }],
  ["sametinget", { id: "77777777-7777-7777-7777-777777777777" }],
]);

test("adapterFraKildeUrl mapper kjente vertsnavn og lar ukjente være", () => {
  assert.equal(
    adapterFraKildeUrl("https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=200367"),
    "stortinget-saker",
  );
  assert.equal(
    adapterFraKildeUrl("https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/ventede-saker/#sak-110"),
    "stortinget-ventede",
  );
  assert.equal(
    adapterFraKildeUrl("https://www.regjeringen.no/no/dokumenter/nou-2025-3/id3092679/?utm_source=rss"),
    "regjeringen-rss",
  );
  assert.equal(adapterFraKildeUrl("https://einnsyn.no/moetesak/ms_abc"), "einnsyn");
  assert.equal(
    adapterFraKildeUrl("https://www.bergen.kommune.no/politikk/politiskeutvalg/573732/mote/1"),
    "bergen",
  );
  assert.equal(
    adapterFraKildeUrl("https://www.kulturdirektoratet.no/vedtak#NKF-IAB-2026-03-24"),
    "kulturdirektoratet",
  );
  assert.equal(adapterFraKildeUrl("https://sametinget.no/aktuelt/liste.aspx"), "sametinget");
  assert.equal(
    adapterFraKildeUrl("https://www.stavanger.kommune.no/nytt-teater-og-museum/"),
    null,
  );
  assert.equal(adapterFraKildeUrl("  "), null);
  assert.equal(adapterFraKildeUrl(null), null);
});

test("innsettingsrad setter kilde_id og normalisert kilde, aldri kilde_nokkel", () => {
  const rad = byggVarselRad(
    {
      tittel: "Sak",
      adapter: "stortinget-saker",
      instans: "Stortinget",
      kilde: "HTTPS://WWW.STORTINGET.NO/no/Saker-og-publikasjoner/Saker/Sak/?p=200367",
      frist: "2026-11-01",
      sakstype: "høring",
      kommunenr: null,
      fylkesnr: null,
    },
    {
      publisert: true,
      kategori: "kulturarv",
      niva: "nasjonalt",
      status: "viktig",
      sammendrag: "Kort",
    },
    REGISTER,
  );
  assert.ok(rad);
  assert.equal(rad.kilde_id, "11111111-1111-1111-1111-111111111111");
  assert.equal(
    rad.kilde,
    "https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak?p=200367",
  );
  assert.equal("kilde_nokkel" in rad, false);
  assert.equal("handling" in rad, false);
  assert.equal(rad.publisert, true);
  assert.equal(rad.sakstype, "høring");
});

test("avvist rad får kilde_id, men ikke sakstype-feltene", () => {
  const rad = byggVarselRad(
    {
      tittel: "Avvist",
      adapter: "bergen",
      kilde: "https://www.bergen.kommune.no/politikk/sak/1",
      instans: "Bergen kommune",
    },
    {
      publisert: false,
      kategori: "kulturpolitikk",
      niva: "kommune",
      status: "normal",
      sammendrag: "Automatisk avvist av relevansfilteret",
      sted: "Norge",
    },
    REGISTER,
  );
  assert.ok(rad);
  assert.equal(rad.kilde_id, "55555555-5555-5555-5555-555555555555");
  assert.equal("sakstype" in rad, false);
  assert.equal(rad.kilde_nokkel, undefined);
});

test("mangler register-rad blir kilde_id null, ukjent URL droppes", () => {
  assert.equal(kildeUuidForAdapter("bergen", new Map()), null);
  assert.equal(
    byggVarselRad(
      { tittel: "Uten lenke", adapter: "bergen", kilde: "  " },
      { publisert: true, kategori: "musikk", niva: "kommune", status: "normal", sammendrag: "x" },
      REGISTER,
    ),
    null,
  );
  const utenRegister = byggVarselRad(
    {
      tittel: "Teater",
      kilde: "https://www.stavanger.kommune.no/nytt-teater-og-museum/",
    },
    { publisert: true, kategori: "scenekunst", niva: "kommune", status: "normal", sammendrag: "x" },
    REGISTER,
  );
  assert.ok(utenRegister);
  assert.equal(utenRegister.kilde_id, null);
});

test("eInnsyn-prompten har kulturpolitikk for tilskudd og budsjett", () => {
  const prompt = byggSammendragPrompt({ tittel: "Kultur- og idrettstilskudd", instans: "Bydel Østensjø" });
  assert.match(prompt, /kulturpolitikk/);
  assert.match(prompt, /Ikke bruk kulturarv eller visuell bare fordi saken handler om kultur/);
});

test("lokale tilskudds- og budsjettsaker fra eInnsyn blir kulturpolitikk", () => {
  const feil = [
    ["Fordeling av Kulturmidler i Bydel Nordre Aker", "visuell"],
    ["Kultur- og idrettstilskudd", "visuell"],
    ["Revidering av retningslinjer for tilskudd til kultur- og idrettsaktiviteter i Bydel Ullern", "visuell"],
    ["Tilskudd til kultur- og idrettsaktiviteter i Bydel Ullern - 2026", "visuell"],
    ["Årsbudsjett 2027 og økonomiplan 2027-2030 Akershus fylkeskommune", "kulturarv"],
    ["Høring: Bydelsreformen - oppgaveoverføring - lokale kultur og idrettstilskudd", "kulturarv"],
    ["Klage Driftstilskot - kultur og folkehelse 2026", "kulturarv"],
    ["Kultur- og utdanningsutvalgets forslag til utvalgsbudsjett 2027", "kulturarv"],
    ["Opne søknadar kultur og folkehelse", "kulturarv"],
    ["Oppgavefordeling - lokale kultur- og idrettstilskudd", "kulturarv"],
    ["Rapportering av tilskudd til kultur- og idrettsaktiviteter i Bydel Ullern 2025", "kulturarv"],
    ["Tiltaksbudsjett for seksjon kultur, idrett og friluftsliv 2026", "kulturarv"],
    ["Oversikt over tilskuddsordninger innenfor kultur, kulturarv, idrett og friluftsliv i Buskerud fylkeskommune", "kulturarv"],
    ["Tilskuddsordninger kultur og idrett - orientering om tildelinger 2026", "visuell"],
  ] as const;
  for (const [tittel, gammel] of feil) {
    assert.equal(kategoriForEinnsyn(tittel, gammel), "kulturpolitikk", tittel);
  }
});

test("ekte kulturarv, visuell, film og museer beholder fagfeltet", () => {
  assert.equal(
    kategoriForEinnsyn(
      "Befaring utvalg for kultur, idrett og samfunnsdialog 16.09.2026 - Kunst i offentlig rom",
      "kulturarv",
    ),
    "visuell",
  );
  assert.equal(
    kategoriForEinnsyn("Open søknad kultur og folkehelse - frå Stadsraad Lehmkuhl", "visuell"),
    "kulturarv",
  );
  assert.equal(
    kategoriForEinnsyn("Budsjettbehov 2027. Kultur og folkehelse, arkeologisk registrering", "visuell"),
    "kulturarv",
  );
  assert.equal(
    kategoriForEinnsyn(
      "Presentasjon utvalg for kultur, idrett og samfunnsdialog 14.10.2026 - Den norske filmfestivalen",
      "kulturarv",
    ),
    "film",
  );
  assert.equal(
    kategoriForEinnsyn(
      "Søknader om økte faste driftstilskudd innen kultur-, kulturarv-, museums- og kulturminnesektoren fra 2027",
      "visuell",
    ),
    "museer",
  );
  assert.equal(
    kategoriForEinnsyn("Mandat Temaplan for kunst og kultur 2027-2035", "kulturarv"),
    "kulturarv",
  );
  assert.equal(kategoriForEinnsyn("Kultur- og miljøprisen 2025", "visuell"), "visuell");
  assert.equal(
    kategoriForEinnsyn("Byrådets årsberetning for 2025 - Kultur- og utdanningsutvalgets område", "museer"),
    "museer",
  );
});
