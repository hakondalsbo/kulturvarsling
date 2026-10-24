import { test } from "node:test";
import assert from "node:assert/strict";
import {
  erInnkjopsordning,
  finnOrdningskoder,
  kategoriForOrdning,
  ORDNINGSKODER,
  ORDNINGSKODER_KILDE,
  ORDNINGSKODER_VERSJON,
  ordningsforklaring,
  ordningsnavn,
  ordningsetikett,
} from "./ordningskoder.ts";

// Koder som fantes i varsler 2026-10-24 (read-only opptelling mot tittel og sammendrag).
const KODER_I_VARSLER = [
  "FLB-AUDIO", "FLB-CINE", "FLB-LIVE", "FLB-MEDIA",
  "KUL-AMA", "KUL-IND", "KUL-KRT", "KUL-MAS", "KUL-MKO", "KUL-SMM", "KUL-UPM",
  "NKF-ASF", "NKF-ASP", "NKF-BST", "NKF-FOF", "NKF-FOM", "NKF-FON", "NKF-FPS",
  "NKF-FSK", "NKF-FSV", "NKF-GJE", "NKF-IAB", "NKF-IAV", "NKF-IBK", "NKF-IOL",
  "NKF-ISB", "NKF-ISV", "NKF-ITS", "NKF-PUB",
];

test("ordlisten er versjonert og peker på vedtakssiden", () => {
  assert.equal(ORDNINGSKODER_VERSJON, "2026-10-24");
  assert.equal(ORDNINGSKODER_KILDE, "https://www.kulturdirektoratet.no/vedtak");
  assert.equal(Object.keys(ORDNINGSKODER).length, 76);
});

test("NKF-IAB og NKF-IAV har de offisielle navnene fra nedtrekkslisten", () => {
  assert.equal(
    ordningsnavn("NKF-IAB"),
    "Ny norsk skjønnlitteratur for barn og unge – automatisk innkjøpsordning",
  );
  assert.equal(
    ordningsnavn("nkf-iav"),
    "Ny norsk skjønnlitteratur for vaksne – automatisk innkjøpsordning",
  );
  assert.equal(
    ordningsetikett(" NKF-IAB "),
    "NKF-IAB: Ny norsk skjønnlitteratur for barn og unge – automatisk innkjøpsordning",
  );
});

test("koder som forekommer i varsler har et ikke-tomt offisielt navn", () => {
  for (const kode of KODER_I_VARSLER) {
    const navn = ordningsnavn(kode);
    assert.ok(navn, kode);
    assert.equal(navn.trim(), navn);
    assert.equal(navn.includes("  "), false, kode);
  }
});

test("ukjent kode forklares ikke", () => {
  assert.equal(ordningsnavn("NKF-XYZ"), null);
  assert.equal(ordningsnavn(""), null);
  assert.equal(ordningsnavn(null), null);
  assert.equal(ordningsetikett("NKF-XYZ"), "NKF-XYZ");
});

test("promptforklaringen sender kjent navn og ber modellen la ukjente koder stå", () => {
  const tekst = "ordning NKF-IAB og NKF-XYZ, runde 2026-03-01";
  assert.deepEqual(finnOrdningskoder(tekst), ["NKF-IAB", "NKF-XYZ"]);
  const forklaring = ordningsforklaring(tekst);
  assert.match(forklaring, /NKF-IAB: Ny norsk skjønnlitteratur for barn og unge – automatisk innkjøpsordning/);
  assert.match(forklaring, /NKF-XYZ: ikke i ordlisten/);
  assert.match(forklaring, /Ikke tolk dem/);
  assert.equal(forklaring.includes("på vanlig norsk"), false);
  assert.equal(ordningsforklaring("Ingen kode her"), "");
});

test("ordlisten inneholder ikke uttrykket «på vanlig norsk»", () => {
  for (const navn of Object.values(ORDNINGSKODER)) {
    assert.equal(navn.toLowerCase().includes("på vanlig norsk"), false);
  }
});

const INNKJOP = ["NKF-IAB", "NKF-IAV", "NKF-IUB", "NKF-IUV", "NKF-ISB", "NKF-ISV", "NKF-ITS", "NKF-IOL"];

test("innkjøpsordningene kjennes på det offisielle navnet", () => {
  for (const kode of INNKJOP) assert.equal(erInnkjopsordning(kode), true, kode);
  assert.equal(erInnkjopsordning("FLB-AUDIO"), false);
  assert.equal(erInnkjopsordning("NKF-SKB"), false);
  assert.equal(erInnkjopsordning("NKF-XYZ"), false);
  assert.equal(erInnkjopsordning(null), false);
});

test("litteratur- og innkjøpsordninger får litteratur, ikke et annet fag", () => {
  for (const kode of [...INNKJOP, "NKF-LFO", "NKF-LPO", "NKF-LPR", "NKF-LKV"]) {
    assert.equal(kategoriForOrdning(kode), "litteratur", kode);
  }
});

test("FLB-LIVE er scenekunst og FLB-MEDIA er ikke film", () => {
  assert.equal(kategoriForOrdning("FLB-LIVE"), "scenekunst");
  // KATEGORIER har ikke markedsføring. Ordningen dekker musikk, scene og film,
  // så ingen av de ti fagene er nærmere. kulturpolitikk finnes som samlekategori.
  assert.equal(kategoriForOrdning("FLB-MEDIA"), "kulturpolitikk");
  assert.notEqual(kategoriForOrdning("FLB-MEDIA"), "film");
  assert.notEqual(kategoriForOrdning("FLB-MEDIA"), "markedsføring");
  assert.notEqual(kategoriForOrdning("FLB-MEDIA"), "generell");
});

test("kategoriene er bare id-er som finnes fra før", () => {
  const finnes = new Set([
    "scenekunst", "musikk", "dans", "opera", "litteratur",
    "film", "visuell", "museer", "spill", "kulturarv", "kulturpolitikk",
  ]);
  for (const kode of Object.keys(ORDNINGSKODER)) {
    const kategori = kategoriForOrdning(kode);
    if (kategori == null) continue;
    assert.equal(finnes.has(kategori), true, `${kode} → ${kategori}`);
    assert.notEqual(kategori, "markedsføring", kode);
    assert.notEqual(kategori, "generell", kode);
  }
});

test("entydige ordninger får faget i navnet, blandede får samlekategorien", () => {
  assert.equal(kategoriForOrdning("FLB-AUDIO"), "musikk");
  assert.equal(kategoriForOrdning("FLB-CINE"), "film");
  assert.equal(kategoriForOrdning("FLB-MFA"), "musikk");
  assert.equal(kategoriForOrdning("FLB-MFF"), "film");
  assert.equal(kategoriForOrdning("NKF-FSD"), "dans");
  assert.equal(kategoriForOrdning("NKF-PUB"), "musikk");
  assert.equal(kategoriForOrdning("NKF-FSK"), "scenekunst");
  assert.equal(kategoriForOrdning("KUL-SMM"), "museer");
  assert.equal(kategoriForOrdning("NKF-IBK"), "kulturpolitikk");
  assert.equal(kategoriForOrdning("NKF-XYZ"), null);
  assert.equal(kategoriForOrdning(""), null);
});
