import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KILDE_DATO_MARGIN_MS,
  avklarKjoering,
  byggKildeKjoringRad,
  filtrerNyeEtterKildedato,
  planleggKildePublisertBackfill,
} from "./datofilter.ts";
import { BACKFILL_KODE } from "./backfill.ts";

const SISTE = "2026-10-20T06:00:00.000Z";
const NÅ = Date.parse("2026-10-21T06:00:00.000Z");
const GRENSE = new Map<string, string | null>([["regjeringen-rss", SISTE]]);

function sak(tittel: string, iso: string | null, adapter = "regjeringen-rss") {
  return { tittel, adapter, kilde_publisert: iso, publisert_dato: iso?.slice(0, 10) ?? null };
}

test("gammelt element hoppes over", () => {
  const folkemusikk = sak("Folkemusikkarven", "2026-06-24T08:00:00.000Z");
  const dns = sak("DNS-blokkering", "2026-09-21T10:00:00.000Z");
  const ut = filtrerNyeEtterKildedato([folkemusikk, dns], {
    modus: "vanlig",
    sisteVellykket: GRENSE,
    nå: NÅ,
  });
  assert.deepEqual(ut.behold, []);
  assert.deepEqual(ut.forGamle, [folkemusikk, dns]);
});

test("nytt element beholdes for innsetting", () => {
  const ny = sak("Ny høring", "2026-10-21T08:00:00.000Z");
  const ut = filtrerNyeEtterKildedato([ny], {
    modus: "vanlig",
    sisteVellykket: GRENSE,
    nå: NÅ,
  });
  assert.deepEqual(ut.behold, [ny]);
  assert.deepEqual(ut.forGamle, []);
});

test("element innenfor 72-timersmarginen beholdes", () => {
  assert.equal(KILDE_DATO_MARGIN_MS, 72 * 60 * 60 * 1000);
  const innenfor = sak("Rett før forrige kjøring", "2026-10-18T07:00:00.000Z");
  const paaGrense = sak("Akkurat på grensen", "2026-10-17T06:00:00.000Z");
  const utenfor = sak("En time for gammel", "2026-10-17T05:00:00.000Z");
  const ut = filtrerNyeEtterKildedato([innenfor, paaGrense, utenfor], {
    modus: "vanlig",
    sisteVellykket: GRENSE,
    nå: NÅ,
  });
  assert.deepEqual(ut.behold.map((s) => s.tittel), [
    "Rett før forrige kjøring",
    "Akkurat på grensen",
  ]);
  assert.deepEqual(ut.forGamle.map((s) => s.tittel), ["En time for gammel"]);
});

test("element uten dato hoppes over i vanlig kjøring og beholdes i backfill", () => {
  const uten = sak("Ventet sak uten tidsstempel", null, "stortinget-ventede");
  const vanlig = filtrerNyeEtterKildedato([uten], {
    modus: "vanlig",
    sisteVellykket: GRENSE,
    nå: NÅ,
  });
  assert.deepEqual(vanlig.behold, []);
  assert.deepEqual(vanlig.utenDato, [uten]);
  const backfill = filtrerNyeEtterKildedato(
    [uten, sak("Gammel", "2026-06-24T00:00:00.000Z")],
    { modus: "backfill", sisteVellykket: GRENSE, nå: NÅ },
  );
  assert.equal(backfill.behold.length, 2);
  assert.deepEqual(backfill.forGamle, []);
});

test("uten tidligere suksess er grensen nå minus 72 timer", () => {
  const gammel = sak("Juni", "2026-06-24T08:00:00.000Z");
  const fersk = sak("I går", "2026-10-20T12:00:00.000Z");
  const ut = filtrerNyeEtterKildedato([gammel, fersk], {
    modus: "vanlig",
    sisteVellykket: new Map([["regjeringen-rss", null]]),
    nå: NÅ,
  });
  assert.deepEqual(ut.behold, [fersk]);
  assert.deepEqual(ut.forGamle, [gammel]);
});

test("backfill-modus logges som kjoeringstype og kan ikke utløses av cron", () => {
  const manuell = avklarKjoering({
    kjoertAv: "manuell",
    modus: "backfill",
    backfillKode: null,
    forventetBackfillKode: BACKFILL_KODE,
  });
  assert.equal(manuell.avvist, null);
  assert.equal(manuell.kjoeringstype, "backfill");
  assert.equal(manuell.spesialBackfill, false);
  const rad = byggKildeKjoringRad({
    kildeId: "kilde-1",
    status: "ok_nye",
    antallFunnet: 8,
    antallEtterFilter: 2,
    antallNye: 1,
    feilmelding: null,
    httpStatus: 200,
    varighetMs: 40,
    kjoertAv: "manuell",
    kjoeringstype: manuell.kjoeringstype,
  });
  assert.equal(rad.kjoeringstype, "backfill");
  assert.equal(rad.kjoert_av, "manuell");
  assert.equal(rad.http_status, 200);

  const cron = avklarKjoering({
    kjoertAv: "supabase_cron",
    modus: "backfill",
    backfillKode: null,
    forventetBackfillKode: BACKFILL_KODE,
  });
  assert.equal(cron.avvist, "Backfill kan ikke kjøres fra cron");
  assert.equal(cron.kjoeringstype, "vanlig");

  const vercel = avklarKjoering({
    kjoertAv: "vercel_cron",
    modus: null,
    backfillKode: BACKFILL_KODE,
    forventetBackfillKode: BACKFILL_KODE,
  });
  assert.equal(vercel.avvist, "Backfill kan ikke kjøres fra cron");

  const spesial = avklarKjoering({
    kjoertAv: "manuell",
    modus: null,
    backfillKode: BACKFILL_KODE,
    forventetBackfillKode: BACKFILL_KODE,
  });
  assert.equal(spesial.spesialBackfill, true);
  assert.equal(spesial.kjoeringstype, "backfill");

  const daglig = avklarKjoering({
    kjoertAv: "supabase_cron",
    modus: null,
    backfillKode: null,
    forventetBackfillKode: BACKFILL_KODE,
  });
  assert.equal(daglig.kjoeringstype, "vanlig");
  assert.equal(daglig.avvist, null);
});

test("kilde_publisert fylles bare der den mangler og raden ikke er manuelt redigert", () => {
  const plan = planleggKildePublisertBackfill(
    [
      {
        kilde: "https://www.regjeringen.no/no/aktuelt/folkemusikk/id1/",
        kilde_publisert: "2026-06-24T08:00:00.000Z",
      },
      {
        kilde: "https://www.regjeringen.no/no/aktuelt/dns/id2/",
        publisert_dato: "2026-09-21",
      },
      {
        kilde: "https://www.regjeringen.no/no/aktuelt/har-dato/id3/",
        kilde_publisert: "2026-10-01T12:00:00.000Z",
      },
    ],
    [
      {
        id: "aapen",
        kilde: "https://www.regjeringen.no/no/aktuelt/folkemusikk/id1/",
        kilde_publisert: null,
        manuelt_redigert: false,
      },
      {
        id: "redigert",
        kilde: "https://www.regjeringen.no/no/aktuelt/dns/id2/",
        kilde_publisert: null,
        manuelt_redigert: true,
      },
      {
        id: "har-dato",
        kilde: "https://www.regjeringen.no/no/aktuelt/har-dato/id3/",
        kilde_publisert: "2026-10-01T12:00:00.000Z",
        manuelt_redigert: false,
      },
    ],
  );
  assert.deepEqual(plan, [
    { id: "aapen", kilde_publisert: "2026-06-24T08:00:00.000Z" },
  ]);
});
