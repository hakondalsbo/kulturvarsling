import { test } from "node:test";
import assert from "node:assert/strict";
import { byggKildeKjoringRad } from "../hent-saker/datofilter.ts";
import {
  harKildeAlarm,
  klassifiserKildeKall,
  planleggDatoSkriving,
  tolkSkriving,
  utfallFeil,
  utfallOk,
} from "./kall.ts";

test("alle 403 logges som feil_auth med HTTP-kode og alarm", () => {
  const ut = klassifiserKildeKall([
    utfallFeil("auth", 403),
    utfallFeil("auth", 403),
  ]);
  assert.ok(ut);
  assert.equal(ut.status, "feil_auth");
  assert.equal(ut.httpStatus, 403);
  assert.equal(ut.alarm, true);
  assert.match(ut.feilmelding ?? "", /HTTP 403/);
  const rad = byggKildeKjoringRad({
    kildeId: "regjeringen",
    status: ut.status,
    antallFunnet: ut.forsok,
    antallEtterFilter: ut.vellykket,
    antallNye: 0,
    feilmelding: ut.feilmelding,
    httpStatus: ut.httpStatus,
    varighetMs: 12,
    kjoertAv: "supabase_cron",
    kjoeringstype: "vanlig",
    jobb: "oppdater-frister",
  });
  assert.equal(rad.status, "feil_auth");
  assert.equal(rad.http_status, 403);
  assert.equal(rad.kjoeringstype, "vanlig");
  assert.equal(rad.jobb, "oppdater-frister");
  assert.equal(rad.antall_nye, 0);
  assert.equal(rad.antall_oppdatert, 0);
  assert.equal(harKildeAlarm([ut]), true);
});

test("Stortinget 500 på alle kall logges som feil_http", () => {
  const ut = klassifiserKildeKall([utfallFeil("http", 500)]);
  assert.ok(ut);
  assert.equal(ut.status, "feil_http");
  assert.equal(ut.httpStatus, 500);
  assert.equal(ut.alarm, true);
});

test("nesten alle feil blir delvis og alarm, spredte feil logges uten alarm", () => {
  const nesten = klassifiserKildeKall([
    utfallFeil("http", 500),
    utfallFeil("http", 500),
    utfallFeil("http", 500),
    utfallFeil("http", 500),
    utfallOk(200),
  ]);
  assert.ok(nesten);
  assert.equal(nesten.status, "delvis");
  assert.equal(nesten.httpStatus, 500);
  assert.equal(nesten.alarm, true);
  assert.match(nesten.feilmelding ?? "", /4 av 5/);

  const spredt = klassifiserKildeKall([
    utfallFeil("http", 500),
    utfallOk(200),
    utfallOk(200),
    utfallOk(200),
    utfallOk(200),
  ]);
  assert.ok(spredt);
  assert.equal(spredt.status, "http_feil");
  assert.equal(spredt.httpStatus, 500);
  assert.equal(spredt.alarm, false);
  assert.match(spredt.feilmelding ?? "", /HTTP 500/);
  assert.equal(harKildeAlarm([spredt]), false);
});

test("én saks 500 logges per sak og gjør ikke kilden til http_feil", () => {
  const kall = [
    utfallFeil("http", 500, "sak"),
    ...Array.from({ length: 12 }, () => utfallOk(200)),
  ];
  const ut = klassifiserKildeKall(kall);
  assert.ok(ut);
  assert.equal(ut.status, "ok_ingen_oppdatering");
  assert.equal(ut.alarm, false);
  assert.notEqual(ut.status, "http_feil");
  assert.match(ut.feilmelding ?? "", /1 av 13 enkeltsaker/);
  assert.match(ut.feilmelding ?? "", /HTTP 500/);
  assert.equal(harKildeAlarm([ut]), false);

  const medEndring = klassifiserKildeKall(kall, 2);
  assert.ok(medEndring);
  assert.equal(medEndring.status, "ok_oppdatert");
  assert.equal(medEndring.oppdatert, 2);
});

test("alle saks-500 er fortsatt kildefeil med alarm", () => {
  const ut = klassifiserKildeKall(Array.from({ length: 13 }, () => utfallFeil("http", 500, "sak")));
  assert.ok(ut);
  assert.equal(ut.status, "feil_http");
  assert.equal(ut.alarm, true);
  assert.equal(harKildeAlarm([ut]), true);
});

test("403 på én sak er fortsatt http_feil", () => {
  const ut = klassifiserKildeKall([
    utfallFeil("auth", 403, "sak"),
    utfallOk(200),
    utfallOk(200),
    utfallOk(200),
    utfallOk(200),
  ]);
  assert.ok(ut);
  assert.equal(ut.status, "http_feil");
  assert.equal(ut.alarm, false);
});

test("dato skrives bare når verdien endres, og bare rader som kom tilbake telles", () => {
  const naa = "2026-10-24T06:30:00.000Z";
  assert.equal(planleggDatoSkriving("2026-10-14", "2026-10-14", naa), null);
  assert.equal(planleggDatoSkriving(null, "", naa), null);
  assert.deepEqual(planleggDatoSkriving(null, "2026-11-04", naa), {
    verdi: "2026-11-04",
    oppdatert: naa,
  });
  assert.deepEqual(planleggDatoSkriving("2026-10-01", "2026-11-04T00:00:00Z", naa), {
    verdi: "2026-11-04",
    oppdatert: naa,
  });
  assert.deepEqual(tolkSkriving(null, []), { feil: null, antall: 0 });
  assert.deepEqual(tolkSkriving({ message: "Kan ikke endre møtedato" }, null), {
    feil: "Kan ikke endre møtedato",
    antall: 0,
  });
  assert.deepEqual(tolkSkriving(null, [{ id: "a" }]), { feil: null, antall: 1 });
});

test("oppdaterte frister er ikke nye saker", () => {
  const ok = klassifiserKildeKall([utfallOk(200), utfallOk(200)], 20);
  assert.ok(ok);
  assert.equal(ok.status, "ok_oppdatert");
  assert.equal(ok.oppdatert, 20);
  assert.equal(ok.alarm, false);
  const rad = byggKildeKjoringRad({
    kildeId: "einnsyn",
    status: ok.status,
    antallFunnet: ok.forsok,
    antallEtterFilter: ok.vellykket,
    antallNye: 20,
    antallOppdatert: ok.oppdatert,
    feilmelding: null,
    httpStatus: ok.httpStatus,
    varighetMs: 4,
    kjoertAv: "supabase_cron",
    kjoeringstype: "vanlig",
    jobb: "oppdater-frister",
  });
  assert.equal(rad.antall_nye, 0);
  assert.equal(rad.antall_oppdatert, 20);
  assert.notEqual(rad.status, "ok_nye");

  const ingen = klassifiserKildeKall([utfallOk(200)]);
  assert.ok(ingen);
  assert.equal(ingen.status, "ok_ingen_oppdatering");
  assert.equal(ingen.oppdatert, 0);
  assert.equal(klassifiserKildeKall([]), null);
});
