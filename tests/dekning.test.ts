import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  erDekningSti,
  erTallavsnitt,
  inlineTekst,
  parseDekning,
  renTekst,
  seksjon,
  type Inline,
} from "../src/innhold/hva-vi-dekker.ts";

const md = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/innhold/hva-vi-dekker.md"),
  "utf8",
);
const dok = parseDekning(md);

function utenMarkdown(kilde: string): string {
  return kilde
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((linje) => linje.trim())
    .filter((linje) => linje !== "")
    .map((linje) => linje.replace(/^#{1,6} /, "").replace(/^- /, "").replace(/\*\*/g, ""))
    .join("\n");
}

function sterk(barn: Inline[]): string {
  return barn
    .filter((d) => d.type === "strong")
    .map((d) => (d.type === "strong" ? inlineTekst(d.barn) : ""))
    .join("");
}

test("siden gjengir den godkjente teksten ordrett", () => {
  assert.equal(renTekst(dok), utenMarkdown(md));
  assert.match(md, /Kulturvarsling er i åpen prøvedrift\./);
  assert.match(md, /Tallene på denne siden er fra 5\. november 2026\./);
  assert.match(
    md,
    /6\. november 2026 var det 166 publiserte varsler\. 43 kom fra eInnsyn, 39 fra Kulturdirektoratet, 30 fra Bergen kommune, 20 fra Stortinget, 18 fra Regjeringen og 15 fra Sametinget\. Ett varsel er lagt inn fra Stavanger kommunes nettsider\./,
  );
  assert.match(md, /16 kommuner og 5 fylkeskommuner/);
  assert.match(md, /5\. november hadde ni kommuner minst ett publisert varsel\./);
  assert.match(md, /fra eInnsyn mellom kl\. 02\.00 og 03\.10/);
  assert.match(md, /fra de andre kildene kl\. 07\.00/);
  assert.match(md, /frister og status oppdateres kl\. 07\.30/);
  const tall = dok.find((b) => b.type === "p" && erTallavsnitt(b.barn));
  assert.ok(tall && tall.type === "p");
});

test("kilde- og kommunelisten beholder de godkjente navnene", () => {
  const kilder = seksjon(dok, "Kilder vi henter fra").find((b) => b.type === "ul");
  assert.ok(kilder && kilder.type === "ul");
  assert.deepEqual(kilder.punkter.map(sterk), [
    "Stortinget:",
    "Regjeringen:",
    "eInnsyn:",
    "Bergen kommune:",
    "Kulturdirektoratet:",
    "Sametinget:",
  ]);
  const med = seksjon(dok, "Kommuner og fylkeskommuner som er med");
  const avsnitt = med.filter((b) => b.type === "p");
  assert.equal(avsnitt.length, 2);
  assert.equal(avsnitt[0].type === "p" ? sterk(avsnitt[0].barn) : "", "Kommuner:");
  assert.match(
    avsnitt[0].type === "p" ? inlineTekst(avsnitt[0].barn) : "",
    /Arendal, Bergen, Bodø, Fredrikstad, Froland, Gjerstad, Grimstad, Hvaler, Malvik, Oslo \(med bydelene\), Risør, Rødøy, Stavanger, Tvedestrand, Vegårshei, Vennesla og Åmli\./,
  );
  assert.equal(avsnitt[1].type === "p" ? sterk(avsnitt[1].barn) : "", "Fylkeskommuner:");
  assert.match(
    avsnitt[1].type === "p" ? inlineTekst(avsnitt[1].barn) : "",
    /Agder, Akershus, Buskerud, Vestland og Østfold\./,
  );
});

test("«ikke med ennå» er bare de tre godkjente punktene", () => {
  const ikke = seksjon(dok, "Hva som ikke er med ennå");
  assert.equal(ikke.length, 2);
  assert.equal(ikke[0].type, "ul");
  assert.deepEqual(
    ikke[0].type === "ul" ? ikke[0].punkter.map((p) => inlineTekst(p)) : [],
    [
      "De fleste kommuner og fylkeskommuner.",
      "Kommuner som publiserer møtene sine i andre systemer enn eInnsyn, for eksempel Trondheim og Tromsø.",
      "Riksantikvaren, Norsk filminstitutt og Kulturtanken.",
    ],
  );
  assert.match(ikke[1].type === "p" ? inlineTekst(ikke[1].barn) : "", /Sakene blir filtrert før de publiseres/);
  assert.doesNotMatch(renTekst(ikke), /nyhetsbrev|e-post/i);
  assert.doesNotMatch(md, /nyhetsbrev|e-postvarsel|Stripe|Premium|\/vilkar/i);
});

test("ruten er /hva-vi-dekker og lenkes fra meny, metode og Mer", () => {
  assert.equal(erDekningSti("/hva-vi-dekker"), true);
  assert.equal(erDekningSti("/hva-vi-dekker/"), true);
  assert.equal(erDekningSti("/app/hva-vi-dekker"), true);
  assert.equal(erDekningSti("/vilkar"), false);
  assert.equal(erDekningSti("/personvern"), false);

  const app = readFileSync("src/App.tsx", "utf8");
  const avis = readFileSync("src/avis.tsx", "utf8");
  const side = readFileSync("src/dekning.tsx", "utf8");
  const vite = readFileSync("vite.config.ts", "utf8");
  assert.match(app, /erDekningSti\(p\)\) return "dekning"/);
  assert.match(app, /id:"dekning",label:"Hva vi dekker"/);
  assert.match(app, /href="\/hva-vi-dekker">Hva vi dekker</);
  assert.match(app, /view==="dekning" && <DekningSide \/>/);
  assert.doesNotMatch(app, /href="\/vilkar"/);
  assert.match(avis, /className="avis-metode-mer"><a href="\/hva-vi-dekker">Hva vi dekker<\/a>/);
  assert.doesNotMatch(avis, /href="\/vilkar"/);
  assert.match(side, /hva-vi-dekker\.md\?raw/);
  assert.match(side, /parseDekning/);
  assert.doesNotMatch(side, /\b168\b|nyhetsbrev|e-postvarsel|Stripe|\/vilkar/);
  assert.match(vite, /\/hva-vi-dekker/);
});
