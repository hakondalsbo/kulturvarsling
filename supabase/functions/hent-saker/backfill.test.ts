import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AVVIST_SAMMENDRAG,
  DATASPILL_VARSEL_ID,
} from "../_shared/varselvern.ts";
import {
  BACKFILL_FRA,
  BACKFILL_TIL,
  DATASPILL_FRIST,
  DATASPILL_SAMMENDRAG,
  MEDIEPOLITIKK_SAMMENDRAG,
  MEDIEPOLITIKK_VARSEL_ID,
  STATSBUDSJETT_FRIST,
  STATSBUDSJETT_VARSEL_ID,
  backfillFeeds,
  planleggBackfill,
  planleggTommeHoringsfrister,
  type EksisterendeVarsel,
} from "./backfill.ts";
import { filtrerRegjeringenItems, hentHoringsliste } from "./regjeringen.ts";
import type { RssItem } from "./logikk.ts";

const NÅ = Date.parse("2026-10-20T12:00:00Z");

const BUDSJETT = [
  "Statsbudsjettet 2027: Eit rekordstort kulturbudsjett for fellesskap",
  "Statsbudsjettet 2027: Regjeringa styrker redaktørstyrte medium i ei uroleg tid",
  "Statsbudsjettet 2027: Arbeidarparti-regjeringa held fram styrkinga på dansefeltet i heile landet",
  "Statsbudsjettet 2027: Æresløn til Mari Boine",
  "Statsbudsjettet 2027: Regjeringa gir stønad til fem nye prosjekt i ordninga Nasjonale kulturbygg",
  "Statsbudsjettet 2027: Meir til kunstnarane i Statens kunstnarstipend",
  "Statsbudsjettet 2027: Arbeidarparti-regjeringa styrker filmfeltet med 75 millionar kroner",
  "Statsbudsjettet 2027: Full momskompensasjon for frivilligheit og idrett også i 2027",
];

let itemNr = 0;
function item(tittel: string, over: Partial<RssItem> = {}): RssItem {
  itemNr += 1;
  const slug = tittel.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48);
  return {
    tittel,
    instans: "KUD – nyhet",
    kilde: `https://www.regjeringen.no/no/aktuelt/${slug}/id${itemNr}/`,
    frist: null,
    sammendrag_raa: tittel,
    kilde_id: `rss-${itemNr}`,
    publisert_dato: "2026-10-07",
    ...over,
  };
}

const HULL = [
  ...BUDSJETT.map((t) => item(t, { instans: "KUD – statsbudsjett" })),
  item(
    "Retningslinjer - Tilskudd fra Kultur- og likestillingsdepartementet til nasjonale kulturbygg for 2028",
    { instans: "KUD – tilskudd", frist: "2026-12-01" },
  ),
  item("Innspill til kvotefordelingen av kunstnerstipendmidlene for 2027", {
    frist: "2026-11-20",
  }),
  item("Høring - forslag til endringer i kringkastingsforskriften", {
    instans: "KUD – høring",
    frist: "2026-11-12",
    sammendrag_raa: "Forslaget gjelder lokalradio og FM-nettet.",
  }),
  item("Høring - forslag til endringer i pengespillforskriften", {
    instans: "KUD – høring",
    frist: "2026-11-29",
    sammendrag_raa: "Forslaget gjelder nettpoker.",
  }),
  item(
    "Høring av Lotteri- og stiftelsestilsynets utredning om regulering av pengespill-lignende elementer i dataspill",
    {
      instans: "KUD – høring",
      kilde: "https://www.regjeringen.no/no/dokumenter/dataspill/id90/?a=1&b=2",
      frist: DATASPILL_FRIST,
    },
  ),
  item("Presseinvitasjon: statsbudsjettet legges fram", { instans: "KUD – nyhet" }),
  item("Volda er årets nynorskkommune"),
  item("Kultur- og likestillingsministeren besøker Kina", {
    sammendrag_raa: "Kultur- og likestillingsdepartementet deltar.",
  }),
  item("Redegjørelse av barne- og familieministeren om situasjonen i barnevernet", {
    instans: "Regjeringen – høring",
  }),
];

function rad(over: Partial<EksisterendeVarsel> & Pick<EksisterendeVarsel, "id">): EksisterendeVarsel {
  return {
    kilde: null,
    sammendrag: "Ekte sammendrag",
    manuelt_redigert: false,
    publisert: true,
    frist: null,
    kategori: "kulturpolitikk",
    ...over,
  };
}

test("backfill-vinduet er 29.09–19.10 og bare KUD-tilleggsfeedene", () => {
  const feeds = backfillFeeds();
  assert.equal(feeds.length, 4);
  for (const f of feeds) {
    assert.match(f.url, new RegExp(`from=${BACKFILL_FRA.replaceAll(".", "\\.")}`));
    assert.match(f.url, new RegExp(`to=${BACKFILL_TIL.replaceAll(".", "\\.")}`));
    assert.match(f.url, /owner=545/);
  }
});

test("backfill setter inn de manglende sakene én gang, og hopper over støy", () => {
  const første = planleggBackfill({ items: HULL, eksisterende: [], nå: NÅ });
  const titler = første.nye.map((r) => r.tittel);
  for (const t of BUDSJETT) assert.ok(titler.includes(t), t);
  assert.ok(titler.some((t) => String(t).includes("nasjonale kulturbygg for 2028")));
  assert.ok(titler.some((t) => String(t).includes("kunstnerstipendmidlene")));
  assert.ok(titler.some((t) => String(t).includes("kringkastingsforskriften")));
  assert.ok(titler.some((t) => String(t).includes("pengespillforskriften")));
  assert.equal(titler.some((t) => String(t).startsWith("Presseinvitasjon")), false);
  assert.equal(titler.some((t) => String(t).includes("nynorskkommune")), false);
  assert.equal(titler.some((t) => String(t).includes("besøker Kina")), false);
  assert.equal(titler.some((t) => String(t).includes("barnevernet")), false);
  assert.equal(første.nye.length, 13);
  assert.equal(første.koblinger.length, 0);
  const innspill = første.nye.find((r) => String(r.tittel).includes("kunstnerstipendmidlene"));
  assert.equal(innspill?.sakstype, "horing");

  const eksisterende: EksisterendeVarsel[] = første.nye.map((r, i) => rad({
    id: `ny-${i}`,
    kilde: String(r.kilde),
    tittel: String(r.tittel),
    sammendrag: String(r.sammendrag),
    frist: (r.frist as string | null) ?? null,
  }));
  const andre = planleggBackfill({ items: HULL, eksisterende, nå: NÅ });
  assert.deepEqual(andre.nye, []);
});

test("nettpoker-nyheten kobles til eksisterende høring og publiseres ikke", () => {
  const plan = planleggBackfill({
    items: [
      item("Foreslår å tillate nettpoker hos Norsk Tipping", { instans: "KUD – nyhet" }),
      item("Høring - forslag til endringer i pengespillforskriften", {
        instans: "KUD – høring",
        frist: "2026-11-29",
        sammendrag_raa: "Forslaget gjelder nettpoker.",
      }),
    ],
    eksisterende: [],
    nå: NÅ,
  });
  assert.equal(plan.nye.length, 1);
  assert.match(String(plan.nye[0].tittel), /pengespillforskriften/);
  assert.equal(plan.nye[0].sakstype, "horing");
  assert.equal(plan.koblinger.length, 1);
  assert.equal(plan.koblinger[0].rad.publisert, false);
  assert.match(String(plan.koblinger[0].rad.tittel), /nettpoker/);
});

test("lagret &amp;-URL blokkerer nytt innlegg med dekodet lenke", () => {
  const kilde = "https://www.regjeringen.no/no/dokumenter/horing-kultur/id9/?a=1&b=2";
  const plan = planleggBackfill({
    items: [item("Høring om kulturloven", { kilde, instans: "KUD – høring" })],
    eksisterende: [rad({
      id: "gammel",
      kilde: kilde.replace("&", "&amp;"),
    })],
    nå: NÅ,
  });
  assert.deepEqual(plan.nye, []);
});

test("mediepolitikk publiseres med sammendrag, uten kategori, tittel eller frist", () => {
  const plan = planleggBackfill({
    items: [],
    eksisterende: [rad({
      id: MEDIEPOLITIKK_VARSEL_ID,
      tittel: "Redegjørelse av kultur- og likestillingsministeren om mediepolitikk og ytringsfrihet",
      sammendrag: AVVIST_SAMMENDRAG,
      kategori: "kulturpolitikk",
      publisert: false,
      kilde: "https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=200464",
    })],
    nå: NÅ,
  });
  assert.equal(plan.nye.length, 0);
  assert.equal(plan.oppdateringer.length, 1);
  assert.deepEqual(plan.oppdateringer[0].felt, {
    sammendrag: MEDIEPOLITIKK_SAMMENDRAG,
    publisert: true,
  });

  const igjen = planleggBackfill({
    items: [],
    eksisterende: [rad({
      id: MEDIEPOLITIKK_VARSEL_ID,
      sammendrag: MEDIEPOLITIKK_SAMMENDRAG,
      publisert: true,
      kategori: "kulturpolitikk",
    })],
    nå: NÅ,
  });
  assert.deepEqual(igjen.oppdateringer, []);
});

test("tom frist på en manuelt redigert rad fylles ikke", () => {
  const kilde = "https://www.regjeringen.no/no/dokumenter/horing-om-kulturbygg/id77/";
  const plan = planleggBackfill({
    items: [item("Høring om kulturbygg", {
      kilde,
      instans: "KUD – høring",
      frist: "2026-12-01",
    })],
    eksisterende: [rad({
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      kilde,
      frist: null,
      manuelt_redigert: true,
    })],
    nå: NÅ,
  });
  assert.deepEqual(plan.oppdateringer, []);
  assert.deepEqual(plan.nye, []);
});

test("statsbudsjett 80653f79 beholder redaktørens frist, status og kategori", () => {
  const felles = rad({
    id: STATSBUDSJETT_VARSEL_ID,
    tittel: "Statsbudsjett 2027",
    sammendrag: "Ekte sammendrag om litteraturkapitlene.",
    kategori: "kulturpolitikk",
    frist: STATSBUDSJETT_FRIST,
    manuelt_redigert: true,
    kilde: "https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=200445",
  });
  assert.equal(STATSBUDSJETT_FRIST, "2026-10-28");
  assert.deepEqual(
    planleggBackfill({ items: [], eksisterende: [felles], nå: NÅ }).oppdateringer,
    [],
  );
  assert.deepEqual(
    planleggBackfill({
      items: [],
      eksisterende: [{ ...felles, frist: null }],
      nå: NÅ,
    }).oppdateringer,
    [],
  );
});

test("dataspillhøringen 90a26730 overskrives ikke", () => {
  const plan = planleggBackfill({
    items: [],
    eksisterende: [rad({
      id: DATASPILL_VARSEL_ID,
      sammendrag: AVVIST_SAMMENDRAG,
      kategori: "spill",
      publisert: false,
      frist: null,
      manuelt_redigert: true,
    })],
    nå: NÅ,
  });
  assert.deepEqual(plan.oppdateringer, []);

  const rettet = planleggBackfill({
    items: [],
    eksisterende: [rad({
      id: DATASPILL_VARSEL_ID,
      sammendrag: DATASPILL_SAMMENDRAG,
      kategori: "spill",
      publisert: true,
      frist: DATASPILL_FRIST,
      manuelt_redigert: true,
    })],
    nå: NÅ,
  });
  assert.deepEqual(rettet.oppdateringer, []);
  assert.deepEqual(rettet.nye, []);
});

test("høringslisten som ikke svarer gir ingen frist og en tydelig feil", async () => {
  const tom = await hentHoringsliste(async () => null);
  assert.equal(tom.feil, "Høringslisten svarte ikke");
  assert.equal(tom.treff.length, 0);
  const utfordring = await hentHoringsliste(async () =>
    "<html><title>Just a moment...</title></html>"
  );
  assert.equal(utfordring.feil, "Høringslisten manglet treff");
});

test("tom høringsfrist settes fra listen bare når raden ikke er manuelt redigert", () => {
  const horing = rad({
    id: "horing-1",
    tittel: "Høring - forslag til endringer i kringkastingsforskriften",
    instans: "KUD – høring",
    kilde: "https://www.regjeringen.no/no/dokumenter/kringkasting/id3173432/",
    frist: null,
    manuelt_redigert: true,
    sammendrag: "Redaktørens tekst",
    kategori: "film",
  });
  const åpen = rad({
    id: "horing-apen",
    tittel: "Høring - pengespillforskriften",
    instans: "KUD – høring",
    kilde: "https://www.regjeringen.no/no/dokumenter/pengespill/id3171815/",
    frist: null,
    manuelt_redigert: false,
  });
  const plan = planleggTommeHoringsfrister({
    eksisterende: [
      horing,
      åpen,
      { ...åpen, id: "har-frist", frist: "2026-11-01" },
      rad({
        id: "nyhet",
        tittel: "Statsbudsjettet 2027: Eit rekordstort kulturbudsjett for fellesskap",
        instans: "KUD – nyhet",
        kilde: "https://www.regjeringen.no/no/aktuelt/budsjett/id8/",
        frist: null,
      }),
    ],
    frister: new Map([["3173432", "2026-11-12"], ["3171815", "2026-11-29"], ["8", "2026-12-01"]]),
    nå: NÅ,
  });
  assert.deepEqual(plan, [{
    id: "horing-apen",
    felt: { frist: "2026-11-29", status: "normal" },
  }]);
});

test("KUD-tillegg eldre enn vinduet droppes, globale dokumenter beholdes", () => {
  const nå = NÅ;
  const gammel = "2020-01-01";
  const ut = filtrerRegjeringenItems([
    item("Gammel KUD-nyhet", { instans: "KUD – nyhet", publisert_dato: gammel }),
    item("Fersk KUD-nyhet", { instans: "KUD – nyhet", publisert_dato: "2026-10-07" }),
    item("Gammel NOU", { instans: "Regjeringen – NOU", publisert_dato: gammel }),
  ], nå);
  assert.deepEqual(ut.map((i) => i.tittel), ["Fersk KUD-nyhet", "Gammel NOU"]);
});
