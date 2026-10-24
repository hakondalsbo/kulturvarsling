import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  alleLenker,
  erStatsbudsjettSti,
  finnInnspill,
  h1Tekst,
  ingressTekst,
  innspillFristPassert,
  parseDokument,
  renTekst,
  tabeller,
} from "../src/innhold/statsbudsjett2027.ts";

const md = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/innhold/statsbudsjett2027.md"),
  "utf8",
);
const dok = parseDokument(md);

/** Uavhengig av parseren: fjern markdown-syntaks og behold ordene i rekkefølge. */
function markdownRenTekst(kilde: string): string {
  const linjer = kilde.replace(/\r\n/g, "\n").split("\n");
  const ut: string[] = [];
  for (const rå of linjer) {
    const linje = rå.trim();
    if (linje === "" || /^\|[-:| ]+\|$/.test(linje)) continue;
    let tekst = linje;
    if (tekst.startsWith("|") && tekst.endsWith("|")) {
      tekst = tekst.slice(1, -1).split("|").map((c) => c.trim()).join(" ");
    }
    tekst = tekst.replace(/^#{1,6} /, "").replace(/^- /, "");
    tekst = tekst.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
    tekst = tekst.replace(/\*\*/g, "").replace(/\*/g, "");
    if (tekst.trim()) ut.push(tekst.trim());
  }
  return ut.join("\n").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}

test("publisert tekst er ordrett lik markdown-filen", () => {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  assert.equal(norm(renTekst(dok)), norm(markdownRenTekst(md)));
  const fraMd = [...md.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((m) => `${m[1]} ${m[2]}`);
  const fraDok = alleLenker(dok).map((l) => `${l.tekst} ${l.href}`);
  assert.deepEqual(fraDok, fraMd);
  for (const utelatt of ["Kildevakt", "Ikke publiser", "Utkast fra varselredaktøren", "på vanlig norsk"]) {
    assert.equal(md.includes(utelatt), false, utelatt);
  }
});

test("tall, lenker og kuttliste fra den godkjente teksten", () => {
  const tekst = renTekst(dok);
  for (const tall of [
    "28,1 milliarder",
    "946 millioner",
    "3,5 prosent",
    "342 193",
    "354 801",
    "698 arbeidsstipend",
    "22,1",
    "25,9",
    "740 millioner",
    "47 millioner mer",
    "374,2 millioner",
    "147 millioner mindre",
    "7 758,7",
    "8 010,0",
    "521,2",
    "−147,0",
    "204,82",
    "167,62",
    "−37,2",
    "2,715",
    "−2,715",
    "15,435",
    "−1,065",
    "0,795",
    "−0,58",
    "47,8 millioner",
  ]) {
    assert.equal(tekst.includes(tall), true, tall);
  }
  const tab = tabeller(dok);
  assert.deepEqual(tab.map((t) => t.rader.length), [4, 14, 12]);
  assert.equal(tab.reduce((n, t) => n + t.rader.length, 0) + 3, 33);
  for (const t of tab) {
    for (const rad of t.rader) assert.equal(rad.length, t.kolonner.length);
    assert.ok(t.rader.length > 0);
  }
  assert.equal(tab[1].rader[0][3], "–");
  assert.equal(tab[2].kolonner.includes("Forklaring i proposisjonen"), false);
  const innspill = finnInnspill(dok);
  assert.equal(innspill.lenkeTekst, "Skriv innspill på stortinget.no");
  assert.equal(innspill.href, "https://www.stortinget.no/no/Hva-skjer-pa-Stortinget/Horing/horing/?h=10005956");
  assert.equal(h1Tekst(dok), "Statsbudsjettet 2027: hva det betyr for kulturfeltet");
  assert.match(ingressTekst(dok), /^Regjeringen foreslår 28,1 milliarder/);
});

test("tom tabell har ingen rader å vise", () => {
  const tom = parseDokument("| Mottaker | 2026 |\n|---|---|\n");
  assert.equal(tabeller(tom)[0].rader.length, 0);
});

test("innspillfristen er 28. oktober 2026 kl. 12.00 norsk tid", () => {
  assert.equal(innspillFristPassert(new Date("2026-10-28T10:59:59.000Z")), false);
  assert.equal(innspillFristPassert(new Date("2026-10-28T11:00:00.000Z")), true);
  assert.equal(innspillFristPassert(new Date("2026-10-24T12:00:00.000Z")), false);
});

test("ruten er /statsbudsjett", () => {
  assert.equal(erStatsbudsjettSti("/statsbudsjett"), true);
  assert.equal(erStatsbudsjettSti("/statsbudsjett/"), true);
  assert.equal(erStatsbudsjettSti("/app/statsbudsjett"), true);
  assert.equal(erStatsbudsjettSti("/app"), false);
  assert.equal(erStatsbudsjettSti("/"), false);
});
