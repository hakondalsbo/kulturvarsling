import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  avslagForKonsekvens,
  byggKonsekvensPrompt,
  erKonsekvensLåst,
  erMobiliserNaa,
  EVAL_TIDSBUDSJETT_MS,
  fallbackVurdering,
  forsideRang,
  kanKlassifisereRad,
  kjørFasitEval,
  KONSEKVENS_NAVN,
  KONSEKVENS_TIMEOUT_MS,
  MAKS_KONSEKVENS_PER_KJORING,
  matcherKonsekvensFilter,
  osloDato,
  synligKonsekvens,
  tolkKonsekvensSvar,
  treffrate,
} from "./konsekvens.ts";
import { klassifiserKonsekvens } from "./konsekvens-kall.ts";
import { oppfriskMobiliserNaa } from "./konsekvens-lager.ts";
import { FASIT_SAKER } from "./konsekvens-fasit.ts";

const IDAG = "2026-10-20";

test("mobiliser er true fra i dag til og med 21 dager frem", () => {
  assert.equal(erMobiliserNaa(IDAG, IDAG), true);
  assert.equal(erMobiliserNaa("2026-11-10", IDAG), true);
  assert.equal(erMobiliserNaa("2026-10-28", IDAG), true);
});

test("passert dato og dag 22 er aldri mobiliser", () => {
  assert.equal(erMobiliserNaa("2026-10-19", IDAG), false);
  assert.equal(erMobiliserNaa("2026-11-11", IDAG), false);
  assert.equal(erMobiliserNaa(null, IDAG), false);
  assert.equal(erMobiliserNaa("2026-02-31", IDAG), false);
  assert.equal(erMobiliserNaa("", IDAG), false);
});

test("oslo-datoen skifter ved midnatt norsk tid, ikke UTC", () => {
  assert.equal(osloDato(new Date("2026-10-20T21:30:00Z")), "2026-10-20");
  assert.equal(osloDato(new Date("2026-10-20T22:30:00Z")), "2026-10-21");
  assert.equal(osloDato(new Date("2026-01-15T23:30:00Z")), "2026-01-16");
});

test("ugyldig JSON blir til_orientering med lav sikkerhet", () => {
  const v = tolkKonsekvensSvar("ikke json", IDAG);
  assert.deepEqual(v, fallbackVurdering());
});

test("ukjent konsekvensverdi blir til_orientering", () => {
  const v = tolkKonsekvensSvar(
    JSON.stringify({ konsekvens: "krise", sikkerhet: "høy", begrunnelse: "Nei." }),
    IDAG,
  );
  assert.equal(v.konsekvens, "til_orientering");
  assert.equal(v.sikkerhet, "lav");
  assert.equal(v.ugyldig, true);
  assert.equal(v.mobiliser_naa, false);
});

test("modellens mobiliser_naa overstyres av datoen", () => {
  const innenfor = tolkKonsekvensSvar(JSON.stringify({
    konsekvens: "ny_mulighet",
    sikkerhet: "middels",
    begrunnelse: "Bystyret behandler planen 27. oktober.",
    mobiliser_naa: false,
    mobiliser_dato: "2026-10-27",
    mobiliser_grunn: "Bystyret behandler saken 27.10.2026",
  }), IDAG);
  assert.equal(innenfor.mobiliser_naa, true);
  assert.equal(innenfor.mobiliser_dato, "2026-10-27");

  const passert = tolkKonsekvensSvar(JSON.stringify({
    konsekvens: "stor_endring",
    sikkerhet: "middels",
    begrunnelse: "Møtet er holdt.",
    mobiliser_naa: true,
    mobiliser_dato: "2026-09-29",
    mobiliser_grunn: "Møtet ble holdt 29.09.2026",
  }), IDAG);
  assert.equal(passert.mobiliser_naa, false);
  assert.equal(passert.mobiliser_dato, "2026-09-29");

  const langtFrem = tolkKonsekvensSvar(JSON.stringify({
    konsekvens: "stor_endring",
    sikkerhet: "høy",
    begrunnelse: "Høringen gjelder regelverk for dataspill.",
    mobiliser_naa: true,
    mobiliser_dato: "2027-01-12",
    mobiliser_grunn: "Åpen høring, frist 12.01.2027",
  }), IDAG);
  assert.equal(langtFrem.mobiliser_naa, false);
  assert.equal(langtFrem.mobiliser_grunn, "Åpen høring, frist 12.01.2027");
});

test("markdown-gjerde rundt JSON godtas", () => {
  const v = tolkKonsekvensSvar(
    "```json\n" + JSON.stringify({
      konsekvens: "til_orientering",
      sikkerhet: "høy",
      begrunnelse: "Listen viser tilskudd som allerede er tildelt.",
      mobiliser_naa: false,
      mobiliser_dato: null,
      mobiliser_grunn: null,
    }) + "\n```",
    IDAG,
  );
  assert.equal(v.ugyldig, false);
  assert.equal(v.konsekvens, "til_orientering");
  assert.equal(v.sikkerhet, "høy");
});

test("manuelt rettede rader klassifiseres ikke på nytt", () => {
  assert.equal(erKonsekvensLåst({ konsekvens_manuell: true }), true);
  assert.equal(erKonsekvensLåst({ manuelt_redigert: true }), true);
  assert.equal(erKonsekvensLåst({ konsekvens_manuell: false, manuelt_redigert: false }), false);
  assert.equal(kanKlassifisereRad({ konsekvens: null, konsekvens_manuell: false }), true);
  assert.equal(kanKlassifisereRad({ konsekvens: "ny_mulighet", konsekvens_manuell: false }), false);
  assert.equal(kanKlassifisereRad({ konsekvens: null, manuelt_redigert: true }), false);
});

test("lav sikkerhet skjules, og forsiden løfter kutt foran mobiliser", () => {
  assert.equal(synligKonsekvens({
    konsekvens: "kutt_innstramming",
    konsekvens_sikkerhet: "lav",
  }), null);
  assert.equal(synligKonsekvens({
    konsekvens: "kutt_innstramming",
    konsekvens_sikkerhet: "middels",
  }), "kutt_innstramming");

  const iDag = IDAG;
  assert.equal(forsideRang({
    konsekvens: "kutt_innstramming",
    konsekvens_sikkerhet: "middels",
    mobiliser_dato: "2026-10-28",
  }, iDag), 0);
  assert.equal(forsideRang({
    konsekvens: "ny_mulighet",
    konsekvens_sikkerhet: "middels",
    mobiliser_dato: "2026-10-28",
  }, iDag), 1);
  assert.equal(forsideRang({
    konsekvens: "til_orientering",
    konsekvens_sikkerhet: "høy",
    mobiliser_dato: null,
  }, iDag), 2);
  assert.equal(matcherKonsekvensFilter({
    konsekvens: "kutt_innstramming",
    konsekvens_sikkerhet: "lav",
  }, "kutt_innstramming", iDag), false);
  assert.equal(matcherKonsekvensFilter({
    mobiliser_dato: "2026-10-27",
  }, "mobiliser", iDag), true);
});

test("prompten fyller plassholderne og beholder verdiene", () => {
  const prompt = byggKonsekvensPrompt({
    tittel: "Statsbudsjett 2027",
    sammendrag: "Kort sammendrag",
    kildetekst: "Post 50 øker med 3,2 %.",
    instans: "Sametinget",
    frist: null,
    dagensDato: IDAG,
  });
  assert.match(prompt, /tittel: Statsbudsjett 2027/);
  assert.match(prompt, /kildetekst: Post 50 øker med 3,2 %\./);
  assert.match(prompt, /dagens_dato: 2026-10-20/);
  assert.match(prompt, /kutt_innstramming \(bare når kuttet er konkret og navngitt i kilden\)/);
  assert.equal(prompt.includes("{tittel}"), false);
});

test("treffrate regnes per fasitverdi", () => {
  const r = treffrate([
    { forventet: "kutt_innstramming", faktisk: "kutt_innstramming" },
    { forventet: "ny_mulighet", faktisk: "til_orientering" },
    { forventet: "ny_mulighet", faktisk: "ny_mulighet" },
    { forventet: "til_orientering", faktisk: "til_orientering" },
  ]);
  assert.equal(r.treff, 3);
  assert.equal(r.per_verdi.kutt_innstramming.rate, 1);
  assert.equal(r.per_verdi.ny_mulighet.treff, 1);
  assert.equal(r.per_verdi.ny_mulighet.antall, 2);
  assert.equal(r.per_verdi.stor_endring.antall, 0);
  assert.equal(r.per_verdi.stor_endring.rate, null);
});

test("Haiku-kall: ugyldig svar blir fallback, HTTP-feil blir ikke skrevet", async () => {
  const kall = (tekst: string, status = 200) =>
    klassifiserKonsekvens({
      tittel: "T",
      sammendrag: "S",
      kildetekst: "K",
      instans: "I",
      frist: null,
      dagensDato: IDAG,
    }, "test-nokkel", {
      log: () => {},
      fetch: async () =>
        new Response(JSON.stringify({
          content: [{ type: "text", text: tekst }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }), { status }),
    });

  const ok = await kall(JSON.stringify({
    konsekvens: "ny_mulighet",
    sikkerhet: "middels",
    begrunnelse: "Budsjettet øker.",
    mobiliser_naa: true,
    mobiliser_dato: "2026-12-01",
    mobiliser_grunn: "Frist 01.12.2026",
  }));
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.felt.konsekvens, "ny_mulighet");
    assert.equal(ok.felt.konsekvens_begrunnelse, "Budsjettet øker.");
    assert.equal(ok.felt.mobiliser_naa, false);
    assert.equal(ok.felt.mobiliser_dato, "2026-12-01");
    assert.equal(ok.tokens?.input_tokens, 1);
    assert.equal(ok.tokens?.output_tokens, 1);
  }

  const ugyldig = await kall("helt galt");
  assert.equal(ugyldig.ok, true);
  if (ugyldig.ok) {
    assert.equal(ugyldig.felt.konsekvens, "til_orientering");
    assert.equal(ugyldig.felt.konsekvens_sikkerhet, "lav");
  }

  const http = await kall("{}", 529);
  assert.equal(http.ok, false);
  if (!http.ok) {
    assert.equal(http.grunn, "http");
    assert.equal(http.status, 529);
    assert.equal(http.tokens?.input_tokens, 1);
  }
});

test("eval bruker cron-hemmeligheten og krever ikke egen secret", () => {
  assert.equal(avslagForKonsekvens("POST", null, null, undefined, undefined)?.status, 503);
  assert.equal(avslagForKonsekvens("POST", "feil", null, "cron-hemmelig", undefined)?.status, 401);
  assert.equal(avslagForKonsekvens("POST", null, "cron-hemmelig", "cron-hemmelig", undefined)?.status, 401);
  assert.equal(avslagForKonsekvens("POST", "cron-hemmelig", null, "cron-hemmelig", undefined), null);
  assert.equal(avslagForKonsekvens("GET", "cron-hemmelig", null, "cron-hemmelig", undefined)?.status, 200);
  assert.equal(avslagForKonsekvens("POST", null, "egen", undefined, "egen"), null);
  assert.equal(avslagForKonsekvens("POST", "egen", null, "cron-hemmelig", "egen"), null);
  assert.equal(avslagForKonsekvens("PUT", "cron-hemmelig", null, "cron-hemmelig", undefined)?.status, 405);

  const kilde = fs.readFileSync(
    new URL("../backfill-konsekvens/index.ts", import.meta.url),
    "utf8",
  );
  const evalStart = kilde.indexOf("if (erEval(body))");
  const klient = kilde.indexOf("createClient(");
  assert.ok(evalStart > 0 && klient > evalStart);
  assert.equal(kilde.slice(evalStart, klient).includes("createClient"), false);
  assert.match(kilde, /HENT_SAKER_CRON_SECRET/);
  assert.match(kilde, /x-cron-secret/);
});

test("merketekstene er språkguidens navn, uten «på vanlig norsk»", () => {
  assert.deepEqual(KONSEKVENS_NAVN, {
    kutt_innstramming: "Kutt og innstramming",
    stor_endring: "Stor endring for bransjen",
    ny_mulighet: "Ny mulighet",
    til_orientering: "Til orientering",
  });
  const prompt = byggKonsekvensPrompt({
    tittel: "T",
    sammendrag: "S",
    kildetekst: "K",
    instans: "I",
    frist: null,
    dagensDato: IDAG,
  });
  assert.equal(prompt.includes("på vanlig norsk"), false);
  const sql = fs.readFileSync(
    new URL("../../migrations/20261027010000_konsekvens_dimensjon.sql", import.meta.url),
    "utf8",
  );
  assert.equal(sql.includes("på vanlig norsk"), false);
  assert.match(sql, /manuelt_redigert is not true/);
  assert.match(sql, /konsekvens_manuell is not true/);
  assert.match(sql, /revoke all on function privat\.oppdater_mobiliser_naa\(\) from public/);
  assert.match(sql, /from anon, authenticated, service_role/);
  assert.match(sql, /grant execute on function privat\.oppdater_mobiliser_naa\(\) to postgres/);
  assert.equal(/grant execute on function privat\.oppdater_mobiliser_naa\(\) to (anon|authenticated|service_role)/.test(sql), false);
});

test("konsekvenstaket får plass i veggklokken på 150 sekunder", () => {
  const vegg = 150_000;
  const relevansOgInnhenting = 70_000;
  const klartekst = 8 * 6_000;
  const igjen = vegg - relevansOgInnhenting - klartekst;
  assert.equal(MAKS_KONSEKVENS_PER_KJORING, 4);
  assert.equal(KONSEKVENS_TIMEOUT_MS, 8_000);
  assert.ok(MAKS_KONSEKVENS_PER_KJORING * KONSEKVENS_TIMEOUT_MS <= igjen);
  assert.equal(EVAL_TIDSBUDSJETT_MS, 120_000);
  assert.ok(EVAL_TIDSBUDSJETT_MS < vegg);
});

test("fasiten har 30 saker og eval stopper ved tidsbudsjettet uten å skrive", async () => {
  assert.equal(FASIT_SAKER.length, 30);
  const verdier = new Set(["kutt_innstramming", "stor_endring", "ny_mulighet", "til_orientering"]);
  assert.equal(new Set(FASIT_SAKER.map((s) => s.id)).size, 30);
  for (const sak of FASIT_SAKER) assert.equal(verdier.has(sak.forventet), true);

  let kall = 0;
  const rapport = await kjørFasitEval(
    [
      { id: "1", forventet: "til_orientering" },
      { id: "2", forventet: "kutt_innstramming" },
      { id: "3", forventet: "ny_mulighet" },
    ],
    async () => {
      kall++;
      return kall === 1 ? "til_orientering" : null;
    },
    (() => {
      let t = 0;
      return () => {
        t += 50;
        return t;
      };
    })(),
    80,
  );
  assert.equal(kall, 1);
  assert.equal(rapport.vurdert, 1);
  assert.equal(rapport.treff, 1);
  assert.equal(rapport.saker[0]?.begrunnelse, null);
  assert.equal(rapport.token_forbruk.kall, 0);

  const medTekst = await kjørFasitEval(
    [{ id: "a", forventet: "ny_mulighet" }],
    async () => ({
      konsekvens: "ny_mulighet",
      begrunnelse: "Kilden øker bevilgningen med 3,5 %.",
      tokens: {
        input_tokens: 120,
        output_tokens: 40,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 0,
      },
    }),
  );
  assert.equal(medTekst.saker[0]?.begrunnelse, "Kilden øker bevilgningen med 3,5 %.");
  assert.equal(medTekst.token_forbruk.input_tokens, 120);
  assert.equal(medTekst.token_forbruk.output_tokens, 40);
  assert.equal(medTekst.token_forbruk.cache_read_input_tokens, 10);
  assert.equal(medTekst.token_forbruk.kall, 1);
  assert.equal(rapport.per_verdi.til_orientering.treff, 1);
  assert.equal(rapport.per_verdi.kutt_innstramming.antall, 0);
  assert.deepEqual(rapport.utsatt, ["2", "3"]);
  assert.equal(rapport.saker[2]?.grunn, "tidsbudsjett");
});

test("oppfrisk skriver ikke mobiliser_naa på låste rader", async () => {
  const skrevet: string[] = [];
  const supabase = {
    from() {
      return {
        select() {
          return {
            or: async () => ({
              data: [
                { id: "låst-manuelt", mobiliser_dato: "2026-10-21", mobiliser_naa: false, manuelt_redigert: true, konsekvens_manuell: false },
                { id: "låst-konsekvens", mobiliser_dato: "2026-10-21", mobiliser_naa: false, manuelt_redigert: false, konsekvens_manuell: true },
                { id: "åpen", mobiliser_dato: "2026-10-21", mobiliser_naa: false, manuelt_redigert: false, konsekvens_manuell: false },
              ],
              error: null,
            }),
          };
        },
        update() {
          const filter: Record<string, unknown> = {};
          const api = {
            eq(k: string, v: unknown) {
              filter[k] = v;
              return api;
            },
            select: async () => {
              if (filter.manuelt_redigert === false && filter.konsekvens_manuell === false && filter.id === "åpen") {
                skrevet.push(String(filter.id));
                return { data: [{ id: "åpen" }], error: null };
              }
              return { data: [], error: null };
            },
          };
          return api;
        },
      };
    },
  };
  const antall = await oppfriskMobiliserNaa(supabase, IDAG);
  assert.equal(antall, 1);
  assert.deepEqual(skrevet, ["åpen"]);
});
