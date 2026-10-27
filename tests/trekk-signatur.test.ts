import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  TREKK_ALLEREDE_TEKST,
  TREKK_ENDEPUNKT,
  TREKK_SLETTET_TEKST,
  TREKK_TILSTANDER,
  erTrekkForesporsel,
  kallTrekk,
  skalKalleTrekk,
  tolkTrekkSvar,
  trekkKropp,
  trekkTekst,
  trekkToken,
  type TrekkHent,
  type TrekkTilstand,
} from "../src/mobiliser/trekk.ts";

const TOKEN = "11111111-2222-4333-8444-555555555555";

function hentMed(status: number, ok: boolean, kast = false): TrekkHent {
  return async (url, init) => {
    assert.equal(url, TREKK_ENDEPUNKT);
    assert.equal(url.includes(TOKEN), false);
    assert.equal(init.method, "POST");
    assert.equal(init.body, JSON.stringify({ handling: "trekk", token: TOKEN }));
    const headers = init.headers as Record<string, string>;
    assert.equal(headers["Content-Type"], "application/json");
    assert.equal(typeof headers.apikey, "string");
    assert.equal(headers.Authorization, `Bearer ${headers.apikey}`);
    assert.equal(JSON.stringify(headers).includes(TOKEN), false);
    if (kast) throw new Error("nett");
    return new Response(JSON.stringify({ ok, feil: TOKEN }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

test("trekk-lenken gjenkjennes uten å plukke med tokenet i andre treff", () => {
  assert.equal(erTrekkForesporsel("?handling=trekk&t=" + TOKEN), true);
  assert.equal(erTrekkForesporsel("handling=trekk"), true);
  assert.equal(erTrekkForesporsel("?handling=signer&t=" + TOKEN), false);
  assert.equal(erTrekkForesporsel(""), false);
  assert.equal(trekkToken("?handling=trekk&t=" + TOKEN), TOKEN);
  assert.equal(trekkToken("?handling=trekk"), null);
  assert.equal(trekkToken("?handling=trekk&t="), null);
  assert.equal(trekkToken("?handling=trekk&t=%20%20"), null);
  assert.equal(trekkToken("?t=" + "a".repeat(81)), null);
});

test("kall skjer bare fra knappen, og ikke mens et kall pågår eller uten token", () => {
  assert.equal(skalKalleTrekk(TOKEN, "bekreft"), true);
  assert.equal(skalKalleTrekk(null, "bekreft"), false);
  assert.equal(skalKalleTrekk("  ", "bekreft"), false);
  assert.equal(skalKalleTrekk(TOKEN, "sender"), false);
  assert.equal(skalKalleTrekk(TOKEN, "slettet"), false);
  assert.equal(skalKalleTrekk(TOKEN, "allerede"), false);
  assert.equal(skalKalleTrekk(TOKEN, "ugyldig"), false);
  assert.equal(skalKalleTrekk(TOKEN, "for-mange"), false);
  assert.equal(skalKalleTrekk(TOKEN, "nett"), true);
  assert.equal(skalKalleTrekk(TOKEN, "lagring"), true);
  assert.equal(skalKalleTrekk(TOKEN, "opptatt"), true);
  assert.deepEqual(trekkKropp(TOKEN), { handling: "trekk", token: TOKEN });
});

test("suksess bruker samtykkeordlyden og nevner ikke tokenet", async () => {
  assert.equal(await kallTrekk(TOKEN, hentMed(200, true)), "slettet");
  assert.equal(tolkTrekkSvar(200, false), "lagring");
  const tekst = trekkTekst("slettet");
  assert.equal(tekst.overskrift, "Signaturen er trukket");
  assert.equal(tekst.status, TREKK_SLETTET_TEKST);
  assert.match(tekst.status, /Kulturvarsling AS har med en gang slettet navnet ditt, e-postadressen din og det du har skrevet om deg selv/);
  assert.match(tekst.status, /Er innspillet allerede sendt, kan det ikke hentes tilbake fra mottakeren/);
  assert.equal(tekst.status.includes(TOKEN), false);
  assert.equal(tekst.visTrekk, false);
  assert.equal(tekst.visProveIgjen, false);
});

test("404, 400 og 429 har hver sin melding", async () => {
  assert.equal(await kallTrekk(TOKEN, hentMed(404, false)), "allerede");
  assert.equal(await kallTrekk(TOKEN, hentMed(400, false)), "ugyldig");
  assert.equal(await kallTrekk(TOKEN, hentMed(429, false)), "for-mange");
  const allerede = trekkTekst("allerede");
  const ugyldig = trekkTekst("ugyldig");
  const mange = trekkTekst("for-mange");
  assert.equal(allerede.overskrift, TREKK_ALLEREDE_TEKST);
  assert.equal(allerede.overskrift, "Signaturen er allerede trukket, eller lenken er ikke lenger gyldig");
  assert.match(allerede.status, /post@kulturvarsling\.no/);
  assert.equal(ugyldig.overskrift, "Lenken er ugyldig.");
  assert.match(ugyldig.status, /post@kulturvarsling\.no/);
  assert.equal(mange.overskrift, "For mange forsøk.");
  assert.equal(mange.status, "Prøv igjen senere.");
  assert.notEqual(allerede.overskrift, ugyldig.overskrift);
  assert.notEqual(ugyldig.overskrift, mange.overskrift);
  assert.notEqual(mange.status, trekkTekst("nett").status);
  assert.equal(allerede.visProveIgjen, false);
  assert.equal(ugyldig.visProveIgjen, false);
  assert.equal(mange.visProveIgjen, false);
  for (const tekst of [allerede, ugyldig, mange]) {
    assert.equal(tekst.overskrift.includes(TOKEN), false);
    assert.equal(tekst.status.includes(TOKEN), false);
  }
});

test("nettverksfeil kan prøves igjen, og serversvar som feiler får egen tekst", async () => {
  assert.equal(await kallTrekk(TOKEN, hentMed(200, true, true)), "nett");
  assert.equal(await kallTrekk(TOKEN, hentMed(500, false)), "lagring");
  assert.equal(await kallTrekk(TOKEN, hentMed(503, false)), "opptatt");
  assert.equal(tolkTrekkSvar(502, false), "nett");
  const nett = trekkTekst("nett");
  assert.equal(nett.overskrift, "Forespørselen kom ikke frem.");
  assert.equal(nett.visProveIgjen, true);
  assert.equal(trekkTekst("lagring").visProveIgjen, true);
  assert.equal(trekkTekst("opptatt").visProveIgjen, true);
  assert.equal(trekkTekst("bekreft").visTrekk, true);
  assert.equal(trekkTekst("bekreft").visProveIgjen, false);
  assert.equal(trekkTekst("bekreft").overskrift, "Vil du trekke signaturen din?");
  assert.match(trekkTekst("bekreft").status, /Ingenting er slettet før du trykker/);
});

test("ingen tilstand viser eller logger tokenet", () => {
  for (const tilstand of TREKK_TILSTANDER) {
    const tekst = trekkTekst(tilstand);
    const samlet = `${tekst.overskrift}\n${tekst.status}`;
    assert.equal(samlet.includes(TOKEN), false);
    assert.equal(samlet.toLowerCase().includes("på vanlig norsk"), false);
    assert.notEqual(tekst.overskrift.trim(), "");
    assert.notEqual(tekst.status.trim(), "");
  }
  const kilde = readFileSync("src/mobiliser/trekk.ts", "utf8") + readFileSync("src/mobiliser/TrekkSignatur.tsx", "utf8");
  assert.doesNotMatch(kilde, /console\./);
});

test("siden kaller ikke ved lasting, virker uten flagg, og er tilgjengelig", () => {
  const side = readFileSync("src/mobiliser/MobiliserSide.tsx", "utf8");
  const komponent = readFileSync("src/mobiliser/TrekkSignatur.tsx", "utf8");
  const trekk = readFileSync("src/mobiliser/trekk.ts", "utf8");
  const funksjon = side.slice(side.indexOf("export function MobiliserSide"));
  assert.ok(funksjon.indexOf("erTrekkForesporsel") < funksjon.indexOf("signaturErSynlig()"));
  assert.doesNotMatch(side, /signer-innspill/);
  assert.doesNotMatch(side, /kampanje_signaturer/);
  assert.doesNotMatch(side, /MOBILISERING_SIGNATUR/);
  assert.doesNotMatch(komponent, /signaturErSynlig|signaturKanSigneres|MOBILISERING_SIGNATUR/);
  assert.match(komponent, /href="\/personvern"/);
  assert.match(komponent, /aria-live="polite"/);
  assert.match(komponent, /role="status"/);
  assert.match(komponent, /autoFocus/);
  assert.match(komponent, /Prøv igjen/);
  assert.match(komponent, /Trekk signaturen/);
  assert.match(komponent, /rel="noreferrer"/);
  assert.match(komponent, /no-referrer/);
  assert.doesNotMatch(komponent, /\{token\}/);
  assert.doesNotMatch(komponent, /console\./);
  const effekter = komponent.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g) ?? [];
  assert.ok(effekter.length >= 2);
  for (const effekt of effekter) {
    assert.doesNotMatch(effekt, /kall\(|kallTrekk|fetch\(/);
  }
  assert.match(komponent, /onClick=\{trekk\}/);
  assert.match(trekk, /handling: "trekk"/);
  assert.doesNotMatch(trekk, /searchParams\.set\("t"/);
  const personvern = readFileSync("public/personvern.html", "utf8");
  assert.match(personvern, /rel="icon" href="\/favicon\.ico"/);
  assert.match(personvern, /rel="icon" type="image\/png" href="\/logo\.png"/);
  assert.equal(personvern.toLowerCase().includes("på vanlig norsk"), false);
});

test("ukjent tilstand er ikke med i listen", () => {
  const kjente: TrekkTilstand[] = [...TREKK_TILSTANDER];
  assert.equal(kjente.length, 9);
  assert.equal(new Set(kjente.map((t) => trekkTekst(t).overskrift)).size >= 7, true);
});
