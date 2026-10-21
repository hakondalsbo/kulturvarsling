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
  });
  assert.equal(rad.status, "feil_auth");
  assert.equal(rad.http_status, 403);
  assert.equal(rad.kjoeringstype, "vanlig");
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

test("vellykkede kall er ikke alarm, og ukalt kilde gir ingen rad", () => {
  const ok = klassifiserKildeKall([utfallOk(200), utfallOk(200)], 1);
  assert.ok(ok);
  assert.equal(ok.status, "ok_nye");
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.alarm, false);
  assert.equal(klassifiserKildeKall([]), null);
});
