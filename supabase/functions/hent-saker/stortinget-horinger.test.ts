import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LINJE_DELTA,
  LINJE_INNSPILL,
  forventetHoringKall,
  hentHoringsprogram,
  hentStortingetHoringer,
  horingSesjoner,
  horingTidspunkt,
  klassifiserHoring,
  planleggHoringLagring,
  skalViseHoring,
  stortingSakIdFraUrl,
} from "./stortinget-horinger.ts";

const NÅ = Date.parse("2026-10-24T10:00:00.000Z");

const FAM = { id: "FAMKULT", navn: "Familie- og kulturkomiteen" };
const KONT = { id: "KONTROLL", navn: "Kontroll- og konstitusjonskomiteen" };

function horing(over: Record<string, unknown>) {
  return {
    type: 1,
    skriftlig: true,
    horing_status: "Aktiv",
    anmodningsfrist_dato_tid: "/Date(-62135596800000)/",
    innspillsfrist: "/Date(1793185200000+0100)/",
    horingstidspunkt_liste: [{ sted: "skriftlig", tidspunkt: "/Date(1793185200000+0100)/" }],
    komite: FAM,
    ...over,
  };
}

test("tidspunkt: sentinel er null, offset lagres ikke, naiv XML-tid er Oslo", () => {
  assert.equal(horingTidspunkt("/Date(-62135596800000)/"), null);
  assert.equal(horingTidspunkt("/Date(-62135596800000+0000)/"), null);
  assert.equal(horingTidspunkt("0001-01-01T00:00:00Z"), null);
  assert.equal(horingTidspunkt("/Date(1791792000000+0200)/"), "2026-10-12T08:00:00.000Z");
  assert.equal(horingTidspunkt("/Date(1792051200000+0200)/"), "2026-10-15T08:00:00.000Z");
  assert.equal(horingTidspunkt("/Date(1793228340000+0100)/"), "2026-10-28T22:59:00.000Z");
  assert.equal(horingTidspunkt("2026-10-28T23:59:00"), "2026-10-28T22:59:00.000Z");
  assert.equal(horingTidspunkt("2026-10-12T10:00:00"), "2026-10-12T08:00:00.000Z");
});

test("muntlig budsjetthøring har to frister og er innenfor 14 dager", () => {
  const klass = klassifiserHoring(horing({
    id: 10005961,
    skriftlig: false,
    horing_status: "Avholdt",
    anmodningsfrist_dato_tid: "/Date(1791792000000+0200)/",
    innspillsfrist: "/Date(1792051200000+0200)/",
    horingstidspunkt_liste: [
      { sted: "Stortingets komitéhus, Akersgt. 18 Høringssal 1", tidspunkt: "/Date(1792393200000+0200)/" },
      { sted: "Stortingets komitéhus, Akersgata 18 Høringssal 2", tidspunkt: "/Date(1792652400000+0200)/" },
      { sted: "Stortingets komitéhus, Akersgt. 18 Høringssal 1", tidspunkt: "/Date(1792738800000+0200)/" },
    ],
    horing_sak_info_liste: [{
      sak_id: 200445,
      sak_korttittel: "Statsbudsjettet 2027 (kapitler fordelt til familie- og kulturkomiteen)",
    }],
    deltaker: "Kari Nordmann",
  }), { nå: NÅ });
  assert.equal(klass.slag, "med");
  if (klass.slag !== "med") return;
  assert.equal(klass.item.tittel, "Høring: Statsbudsjettet 2027 (kapitler fordelt til familie- og kulturkomiteen)");
  assert.equal(klass.item.frist, "2026-10-15");
  assert.equal(klass.item.motedato, "2026-10-19");
  assert.equal(klass.item.handling, "bare_orientering");
  assert.equal(klass.item.horing.frist_delta, "2026-10-12T08:00:00.000Z");
  assert.equal(klass.item.horing.frist_innspill, "2026-10-15T08:00:00.000Z");
  assert.match(klass.item.sammendrag_raa, /^Muntlig høring\./);
  assert.match(klass.item.sammendrag_raa, new RegExp(LINJE_DELTA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "12\\. oktober 2026 kl\\. 10\\.00"));
  assert.match(klass.item.sammendrag_raa, new RegExp(LINJE_INNSPILL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "15\\. oktober 2026 kl\\. 10\\.00"));
  assert.equal(JSON.stringify(klass.item).includes("Kari Nordmann"), false);
  assert.equal(JSON.stringify(klass.item).includes("påmeldingsfrist"), false);
});

test("skriftlig budsjetthøring peker på innspillsfristen og ikke på et møte", () => {
  const klass = klassifiserHoring(horing({
    id: 10005956,
    horing_sak_info_liste: [{
      sak_id: 200445,
      sak_korttittel: "Statsbudsjettet 2027 (kapitler fordelt til familie- og kulturkomiteen)",
    }],
  }), { nå: NÅ });
  assert.equal(klass.slag, "med");
  if (klass.slag !== "med") return;
  assert.equal(klass.item.frist, "2026-10-28");
  assert.equal(klass.item.motedato, null);
  assert.equal(klass.item.handling, "handling_mulig");
  assert.equal(klass.item.horing.frist_delta, null);
  assert.equal(klass.item.horing.frist_innspill, "2026-10-28T11:00:00.000Z");
  assert.match(klass.item.sammendrag_raa, /^Skriftlig høring\./);
  assert.match(klass.item.kilde, /\?h=10005956$/);
});

test("manglende skriftlig-felt blir ikke antatt skriftlig", () => {
  const rå = horing({
    id: 10005970,
    horing_sak_info_liste: [{ sak_id: 1, sak_korttittel: "Kulturfondet" }],
  });
  delete (rå as { skriftlig?: unknown }).skriftlig;
  const klass = klassifiserHoring(rå, { nå: NÅ });
  assert.equal(klass.slag, "med");
  if (klass.slag !== "med") return;
  assert.equal(klass.item.horing.skriftlig, null);
  assert.match(klass.item.sammendrag_raa, /^Høring\./);
  assert.equal(klass.item.sammendrag_raa.startsWith("Skriftlig høring"), false);
});

test("type 2 med åpen frist er bare orientering, type 1 i kontrollkomiteen kan ha handling", () => {
  const kontroll = klassifiserHoring(horing({
    id: 10006002,
    type: 2,
    skriftlig: false,
    anmodningsfrist_dato_tid: "/Date(1794265140000+0100)/",
    innspillsfrist: "/Date(-62135596800000)/",
    horingstidspunkt_liste: [],
    komite: KONT,
    horing_sak_info_liste: [{ sak_id: 9, sak_korttittel: "Evaluering av kulturfondet" }],
  }), { nå: NÅ });
  assert.equal(kontroll.slag, "med");
  if (kontroll.slag === "med") {
    assert.equal(kontroll.item.handling, "bare_orientering");
    assert.equal(kontroll.item.frist, "2026-11-09");
    assert.equal(kontroll.item.horing.type, "kontroll");
  }
  const sprak = klassifiserHoring(horing({
    id: 10005995,
    type: 1,
    innspillsfrist: "/Date(1794956340000+0100)/",
    komite: KONT,
    horing_sak_info_liste: [{
      sak_id: 99386,
      sak_korttittel: "Grunnlovsforslag om § 120 b (norsk som nasjonalt hovudspråk)",
    }],
  }), { nå: NÅ });
  assert.equal(sprak.slag, "med");
  if (sprak.slag === "med") {
    assert.equal(sprak.item.handling, "handling_mulig");
    assert.equal(sprak.item.frist, "2026-11-17");
    assert.equal(sprak.item.horing.type, "komite");
  }
});

test("kulturfilter: utenrikstjenesten og barnevern ute, statsbudsjett og språk inne", () => {
  assert.equal(skalViseHoring({
    komiteId: "KONTROLL",
    sakTekster: ["Kontroll og kultur i utenrikstjenesten"],
  }), false);
  assert.equal(skalViseHoring({
    komiteId: "FAMKULT",
    sakTekster: ["Kriminelle aktører i barnevernet"],
    sakIder: [200422],
    kjenteSakIder: new Set([200422]),
  }), false);
  assert.equal(skalViseHoring({
    komiteId: "FAMKULT",
    sakTekster: ["Endringer i trossamfunnsloven mv. (taushetsplikt)"],
  }), false);
  assert.equal(skalViseHoring({
    komiteId: "FAMKULT",
    sakTekster: ["Digitale lotterier for frivillige organisasjoner"],
  }), false);
  assert.equal(skalViseHoring({
    komiteId: "FAMKULT",
    sakTekster: ["Statsbudsjettet 2027 (kapitler fordelt til familie- og kulturkomiteen)"],
  }), true);
  assert.equal(skalViseHoring({
    komiteId: "KONTROLL",
    sakTekster: ["norsk som nasjonalt hovudspråk"],
  }), true);
  const gammel = klassifiserHoring(horing({
    id: 10005911,
    horing_status: "Avholdt",
    innspillsfrist: "/Date(1759334340000+0200)/",
    horingstidspunkt_liste: [],
    horing_sak_info_liste: [{ sak_id: 1, sak_korttittel: "Kulturfondet" }],
  }), { nå: NÅ });
  assert.equal(gammel.slag, "hopp");
  const avlyst = klassifiserHoring(horing({
    id: 42,
    horing_status: "Avlyst",
    horing_sak_info_liste: [{ sak_id: 1, sak_korttittel: "Kulturfondet" }],
  }), { nå: NÅ });
  assert.equal(avlyst.slag, "avlyst");
});

test("sesjoner og forventet kall: ett listekall, to bare i september, aldri program", () => {
  assert.deepEqual(horingSesjoner(NÅ), ["2026-2027"]);
  assert.deepEqual(
    horingSesjoner(Date.parse("2026-09-15T10:00:00.000Z")),
    ["2025-2026", "2026-2027"],
  );
  const oktober = forventetHoringKall(NÅ);
  assert.equal(oktober.lister, 1);
  assert.equal(oktober.sakOppslagMaks, 10);
  assert.equal(oktober.program, 0);
  assert.equal(oktober.maks, 11);
});

test("ukjent høringsprogram er HTTP 500, og navn fra programpunkter lagres ikke", async () => {
  const ukjent = await hentHoringsprogram(1, async () => ({
    ok: false,
    status: 500,
    text: async () => "feil",
  }));
  assert.deepEqual(ukjent, { ok: false, ukjent: true, status: 500 });
  const program = await hentHoringsprogram(10005961, async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      horingsprogram_liste: [{
        dato: "/Date(1792393200000+0200)/",
        sted: "Høringssal 1",
        tittel: "Kari Nordmann",
        horingsprogram_element_liste: [{ tekst: "Kari Nordmann", rekkefolge_nummer: 1 }],
      }],
    }),
  }));
  assert.equal(program.ok, true);
  assert.equal(JSON.stringify(program).includes("Kari"), false);
  if (program.ok) assert.equal(program.tidspunkter[0]?.tidspunkt, "2026-10-19T07:00:00.000Z");
});

test("henting stopper ved feil, tar med vurderte treff og kaller ikke programmet", async () => {
  const urls: string[] = [];
  const pauser: number[] = [];
  const budsjett = horing({
    id: 10005956,
    horing_sak_info_liste: [{
      sak_id: 200445,
      sak_korttittel: "Statsbudsjettet 2027 (kapitler fordelt til familie- og kulturkomiteen)",
    }],
  });
  const feil = await hentStortingetHoringer({
    nå: NÅ,
    pause: async (ms) => { pauser.push(ms); },
    hent: async (url) => {
      urls.push(url);
      return { ok: false, status: 500, text: async () => "" };
    },
  });
  assert.equal(feil.items.length, 0);
  assert.equal(feil.vellykket, 0);
  assert.equal(feil.feil[0]?.httpStatus, 500);

  const delvis = await hentStortingetHoringer({
    nå: NÅ,
    pause: async (ms) => { pauser.push(ms); },
    hent: async (url) => {
      urls.push(url);
      if (url.includes("/eksport/horinger")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            sesjon_id: "2026-2027",
            horinger_liste: [
              budsjett,
              horing({
                id: 88,
                horing_sak_info_liste: [{ sak_id: 880, sak_korttittel: "Ukjent tema uten nøkkelord" }],
              }),
            ],
          }),
        };
      }
      return { ok: false, status: 503, text: async () => "" };
    },
  });
  assert.equal(delvis.items.length, 1);
  assert.equal(delvis.items[0]?.kilde_id, "stortinget-horing-10005956");
  assert.equal(delvis.feil.length, 1);
  assert.ok(delvis.vellykket < delvis.forsok);
  assert.equal(pauser.includes(400), true);
  assert.equal(urls.some((u) => u.includes("horingsprogram")), false);
  assert.equal(urls.filter((u) => u.includes("sesjonid=2026-2027")).length >= 1, true);
  assert.equal(urls.some((u) => u.includes("2025-2026")), false);
});

test("sak-oppslag stopper på 10 og prioriterer andre komiteer", async () => {
  const urls: string[] = [];
  const andre = Array.from({ length: 10 }, (_, i) => horing({
    id: 3000 + i,
    komite: FAM,
    horing_sak_info_liste: [{ sak_id: 7000 + i, sak_korttittel: `Ukjent famkulttema ${i}` }],
  }));
  const kontroll = horing({
    id: 4000,
    komite: KONT,
    horing_sak_info_liste: [{ sak_id: 8000, sak_korttittel: "Ukjent kontrolltema" }],
  });
  const utfall = await hentStortingetHoringer({
    nå: NÅ,
    pause: async () => {},
    hent: async (url) => {
      urls.push(url);
      if (url.includes("/eksport/horinger")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            sesjon_id: "2026-2027",
            horinger_liste: [...andre, kontroll],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ emne_liste: [{ id: 6, navn: "Kultur" }] }),
      };
    },
  });
  const sakUrl = urls.filter((u) => u.includes("/eksport/sak"));
  assert.equal(sakUrl.length, 10);
  assert.equal(sakUrl.some((u) => u.includes("sakid=8000")), true);
  assert.equal(sakUrl.some((u) => u.includes("sakid=7009")), false);
  assert.equal(utfall.items.some((i) => i.kilde_id === "stortinget-horing-4000"), true);
  assert.equal(urls.some((u) => u.includes("horingsprogram")), false);
});

test("lagring oppdaterer ikke manuelt redigerte rader og flagger avlyst uten å avpublisere", () => {
  const kilde = "https://www.stortinget.no/no/Hva-skjer-pa-Stortinget/Horing/horing/?h=10005956";
  const klass = klassifiserHoring(horing({
    id: 10005956,
    horing_sak_info_liste: [{
      sak_id: 200445,
      sak_korttittel: "Statsbudsjettet 2027 (kapitler fordelt til familie- og kulturkomiteen)",
    }],
  }), { nå: NÅ });
  assert.equal(klass.slag, "med");
  if (klass.slag !== "med") return;
  const plan = planleggHoringLagring({
    items: [klass.item],
    avlyste: [{
      kilde: "https://www.stortinget.no/no/Hva-skjer-pa-Stortinget/Horing/horing/?h=42",
      horing: { horing_id: 42, horing_status: "Avlyst", sak_ider: [] },
    }],
    eksisterende: [
      { id: "manuell", kilde, manuelt_redigert: true },
      { id: "avlyst-rad", kilde: "https://www.stortinget.no/no/Hva-skjer-pa-Stortinget/Horing/horing/?h=42", manuelt_redigert: false },
    ],
    nyeIder: [{ kilde: "https://www.stortinget.no/no/Hva-skjer-pa-Stortinget/Horing/horing/?h=10005995", id: "ny" }],
    saker: [{ stortingSakId: "200445", varselId: "sak-200445" }],
    nå: NÅ,
  });
  assert.equal(plan.varselOppdateringer.some((o) => o.id === "manuell"), false);
  assert.equal(plan.siderader.some((r) => r.horing_id === 10005956 && r.varsel_id === "manuell"), true);
  assert.deepEqual(plan.avlystTilRedaktor, [{
    horing_id: 42,
    horing_status: "Avlyst",
    varsel_id: "avlyst-rad",
  }]);
  assert.equal(JSON.stringify(plan).includes("publisert"), false);

  const ny = planleggHoringLagring({
    items: [{ ...klass.item, sakIder: [200445] }],
    eksisterende: [],
    nyeIder: [{ kilde, id: "ny-horing" }],
    saker: [{ stortingSakId: "200445", varselId: "sak-200445" }],
    nå: NÅ,
  });
  const opp = ny.varselOppdateringer.find((o) => o.id === "ny-horing");
  assert.equal(opp?.felt.hovedsak_id, "sak-200445");
  assert.equal(opp?.felt.handling, "handling_mulig");
  assert.equal(opp?.felt.frist, "2026-10-28");
});

test("p=200 matcher ikke p=2004, og nattkjøringen setter handling uten å hente program", () => {
  assert.equal(stortingSakIdFraUrl("https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=200"), "200");
  assert.equal(stortingSakIdFraUrl("https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=2004"), "2004");
  assert.equal(stortingSakIdFraUrl("https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=200&x=1"), "200");
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const logikk = readFileSync(new URL("./logikk.ts", import.meta.url), "utf8");
  assert.match(index, /kjørAdapter\("stortinget-horinger"/);
  assert.equal(index.includes("horingsprogram"), false);
  assert.equal(/eksport\/horinger[\s\S]{0,160}er nede|er nede \(500\)|horinger = 500/.test(index), false);
  assert.equal(/eksport\/horinger[\s\S]{0,160}er nede|horinger = 500/.test(logikk), false);
  assert.equal(index.includes("påmeldingsfrist"), false);
});
