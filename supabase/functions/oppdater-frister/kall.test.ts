import { test } from "node:test";
import assert from "node:assert/strict";
import { byggKildeKjoringRad } from "../hent-saker/datofilter.ts";
import {
  harKildeAlarm,
  klassifiserKildeKall,
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
