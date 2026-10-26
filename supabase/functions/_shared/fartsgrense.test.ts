import { test } from "node:test";
import assert from "node:assert/strict";
import { FART_EPOST, FART_IP, registrerFartsgrense, skalBlokkere } from "./fartsgrense.ts";

test("grensen teller forsøk som allerede er lagret", () => {
  assert.equal(skalBlokkere(FART_EPOST - 1, FART_EPOST), false);
  assert.equal(skalBlokkere(FART_EPOST, FART_EPOST), true);
  assert.equal(skalBlokkere(FART_IP, FART_IP), true);
});

function falskDb(antall: Record<string, number>, insertFeil = false) {
  const sattInn: unknown[] = [];
  const slettet: string[] = [];
  return {
    sattInn,
    slettet,
    from(tabell: string) {
      assert.equal(tabell, "fartsgrense");
      return {
        select() {
          return {
            eq(_kol: string, endepunkt: string) {
              return {
                eq(_kol2: string, nokkel: string) {
                  return {
                    async gte() {
                      return { count: antall[`${endepunkt}:${nokkel}`] ?? 0, error: null };
                    },
                  };
                },
              };
            },
          };
        },
        async insert(rader: unknown) {
          if (insertFeil) return { error: { message: "nede" } };
          sattInn.push(rader);
          return { error: null };
        },
        delete() {
          return {
            eq(_kol: string, endepunkt: string) {
              return {
                async lt() {
                  slettet.push(endepunkt);
                  return { error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

test("under grensen lagres forsøket og gamle rader ryddes", async () => {
  const db = falskDb({ "meld-pa:epost:a": 1, "meld-pa:ip:b": 2 });
  const utfall = await registrerFartsgrense(db, "meld-pa", [
    { nokkel: "epost:a", grense: FART_EPOST },
    { nokkel: "ip:b", grense: FART_IP },
  ]);
  assert.equal(utfall, "ok");
  assert.equal(db.sattInn.length, 1);
  assert.deepEqual(db.slettet, ["meld-pa"]);
});

test("over grensen skrives ingen ny rad", async () => {
  const db = falskDb({ "avmeld:ip:b": FART_IP });
  const utfall = await registrerFartsgrense(db, "avmeld", [
    { nokkel: "ip:b", grense: FART_IP },
  ]);
  assert.equal(utfall, "blokkert");
  assert.equal(db.sattInn.length, 0);
});

test("databasefeil er utilgjengelig", async () => {
  const db = falskDb({}, true);
  const utfall = await registrerFartsgrense(db, "signer-innspill", [
    { nokkel: "ip:b", grense: FART_IP },
  ]);
  assert.equal(utfall, "utilgjengelig");
});
