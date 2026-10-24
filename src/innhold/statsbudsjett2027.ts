/**
 * Leser den publiserbare teksten i statsbudsjett2027.md.
 * Komponenten viser den uten å skrive om tall eller setninger.
 */

export type Inline =
  | { type: "tekst"; tekst: string }
  | { type: "strong"; barn: Inline[] }
  | { type: "em"; barn: Inline[] }
  | { type: "lenke"; tekst: string; href: string };

export type Overskrift = { type: "h"; niva: 1 | 2 | 3 | 4; barn: Inline[] };
export type Avsnitt = { type: "p"; barn: Inline[] };
export type Liste = { type: "ul"; punkter: Inline[][] };
export type Tabell = {
  type: "tabell";
  caption: Inline[];
  innledning: Inline[] | null;
  kolonner: string[];
  rader: string[][];
};

export type Blokk = Overskrift | Avsnitt | Liste | Tabell;

export type Dokument = { blokker: Blokk[] };

/** Onsdag 28. oktober 2026 kl. 12.00, Europe/Oslo (CET, UTC+1). */
export const INNSPILL_FRIST_ISO = "2026-10-28T12:00:00+01:00";
const INNSPILL_FRIST_OSLO = "2026-10-28T12:00:00";

export function parseDokument(md: string): Dokument {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blokker: Blokk[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const heading = /^(#{1,3}) /.exec(line);
    if (heading) {
      blokker.push({
        type: "h",
        niva: heading[1].length as 1 | 2 | 3,
        barn: parseInline(line.slice(heading[1].length + 1).trim()),
      });
      i += 1;
      continue;
    }
    if (line.startsWith("|")) {
      const lest = lesTabell(lines, i);
      blokker.push(lest.tabell);
      i = lest.neste;
      continue;
    }
    if (line.startsWith("- ")) {
      const punkter: Inline[][] = [];
      while (i < lines.length && (lines[i].startsWith("- ") || (punkter.length > 0 && /^ {2}\S/.test(lines[i])))) {
        if (lines[i].startsWith("- ")) punkter.push(parseInline(lines[i].slice(2).trim()));
        else {
          const sist = punkter[punkter.length - 1];
          const mer = parseInline(lines[i].trim());
          if (sist.length > 0 && mer.length > 0) sist.push({ type: "tekst", tekst: " " });
          sist.push(...mer);
        }
        i += 1;
      }
      blokker.push({ type: "ul", punkter });
      continue;
    }
    const deler = [line.trim()];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("|") &&
      !lines[i].startsWith("- ") &&
      !erEgetAvsnitt(lines[i])
    ) {
      deler.push(lines[i].trim());
      i += 1;
    }
    blokker.push({ type: "p", barn: parseInline(deler.join(" ")) });
  }
  return { blokker: knyttTabelltitler(blokker) };
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("**", i)) {
      const slutt = src.indexOf("**", i + 2);
      if (slutt === -1) {
        out.push({ type: "tekst", tekst: src.slice(i) });
        break;
      }
      out.push({ type: "strong", barn: parseInline(src.slice(i + 2, slutt)) });
      i = slutt + 2;
      continue;
    }
    if (src[i] === "*") {
      const slutt = src.indexOf("*", i + 1);
      if (slutt === -1) {
        out.push({ type: "tekst", tekst: src.slice(i) });
        break;
      }
      out.push({ type: "em", barn: parseInline(src.slice(i + 1, slutt)) });
      i = slutt + 1;
      continue;
    }
    if (src[i] === "[") {
      const m = /^\[([^\]]+)\]\(([^)]+)\)/.exec(src.slice(i));
      if (m) {
        out.push({ type: "lenke", tekst: m[1], href: m[2] });
        i += m[0].length;
        continue;
      }
    }
    let j = i + 1;
    while (j < src.length && src[j] !== "*" && src[j] !== "[") j += 1;
    out.push({ type: "tekst", tekst: src.slice(i, j) });
    i = j;
  }
  return out.filter((del) => del.type !== "tekst" || del.tekst !== "");
}

function lesTabell(lines: string[], start: number): { tabell: Tabell; neste: number } {
  const kolonner = celler(lines[start]);
  let i = start + 1;
  if (i < lines.length && erSkille(lines[i])) i += 1;
  const rader: string[][] = [];
  while (i < lines.length && lines[i].startsWith("|")) {
    if (!erSkille(lines[i])) rader.push(celler(lines[i]));
    i += 1;
  }
  return { tabell: { type: "tabell", caption: [], innledning: null, kolonner, rader }, neste: i };
}

function celler(line: string): string[] {
  return line.split("|").slice(1, -1).map((celle) => celle.trim());
}

function erSkille(line: string): boolean {
  return /^\|[-:| ]+\|$/.test(line.trim());
}

/** Kildelinje og «Hvem berøres» står på egen linje i teksten, uten tom linje foran. */
function erEgetAvsnitt(line: string): boolean {
  const t = line.trim();
  return t.startsWith("*Kilde") || t.startsWith("**Hvem berøres:");
}

function bareStrong(b: Blokk): b is Avsnitt & { barn: [{ type: "strong"; barn: Inline[] }] } {
  return b.type === "p" && b.barn.length === 1 && b.barn[0].type === "strong";
}

function knyttTabelltitler(blokker: Blokk[]): Blokk[] {
  const out: Blokk[] = [];
  for (let i = 0; i < blokker.length; i += 1) {
    const b = blokker[i];
    if (bareStrong(b)) {
      const n1 = blokker[i + 1];
      const n2 = blokker[i + 2];
      if (n1?.type === "tabell") {
        n1.caption = b.barn[0].barn;
        continue;
      }
      if (n1?.type === "p" && n2?.type === "tabell") {
        n2.caption = b.barn[0].barn;
        n2.innledning = n1.barn;
        i += 1;
        continue;
      }
      out.push({ type: "h", niva: 4, barn: b.barn[0].barn });
      continue;
    }
    out.push(b);
  }
  return out;
}

export function renInline(barn: Inline[]): string {
  let ut = "";
  for (const del of barn) {
    if (del.type === "tekst" || del.type === "lenke") ut += del.tekst;
    else ut += renInline(del.barn);
  }
  return ut;
}

export function renTekst(dok: Dokument): string {
  const deler: string[] = [];
  const legg = (barn: Inline[]) => deler.push(renInline(barn));
  for (const b of dok.blokker) {
    if (b.type === "h" || b.type === "p") legg(b.barn);
    else if (b.type === "ul") for (const punkt of b.punkter) legg(punkt);
    else {
      if (b.caption.length > 0) legg(b.caption);
      if (b.innledning) legg(b.innledning);
      deler.push(b.kolonner.join(" "));
      for (const rad of b.rader) deler.push(rad.join(" "));
    }
  }
  return deler.join("\n").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}

export function h1Tekst(dok: Dokument): string {
  const h = dok.blokker.find((b) => b.type === "h" && b.niva === 1);
  if (!h || h.type !== "h") throw new Error("Mangler tittel");
  return renInline(h.barn);
}

/** Redaksjonell etikett i kildefilen. Skal ikke vises som overskrift. */
export function erIngressEtikett(b: Blokk): boolean {
  return b.type === "h" && renInline(b.barn) === "Ingress";
}

export function synligeBlokker(dok: Dokument): Blokk[] {
  return dok.blokker.filter((b) => !erIngressEtikett(b));
}

export function ingressTekst(dok: Dokument): string {
  const idx = dok.blokker.findIndex(erIngressEtikett);
  const neste = dok.blokker[idx + 1];
  if (idx < 0 || !neste || neste.type !== "p") throw new Error("Mangler ingress");
  return renInline(neste.barn);
}

export function tabeller(dok: Dokument): Tabell[] {
  return dok.blokker.filter((b): b is Tabell => b.type === "tabell");
}

export function finnInnspill(dok: Dokument): { ledetekst: string; lenkeTekst: string; href: string } {
  for (const b of dok.blokker) {
    if (b.type !== "ul") continue;
    for (const punkt of b.punkter) {
      const strong = punkt.find((del) => del.type === "strong");
      const lenke = punkt.find((del) => del.type === "lenke");
      if (strong?.type === "strong" && lenke?.type === "lenke" && renInline(strong.barn).startsWith("Skriftlig innspill")) {
        return { ledetekst: renInline(strong.barn), lenkeTekst: lenke.tekst, href: lenke.href };
      }
    }
  }
  throw new Error("Fant ikke skriftlig innspill i teksten");
}

export function alleLenker(dok: Dokument): Array<{ tekst: string; href: string }> {
  const ut: Array<{ tekst: string; href: string }> = [];
  const ga = (barn: Inline[]) => {
    for (const del of barn) {
      if (del.type === "lenke") ut.push({ tekst: del.tekst, href: del.href });
      else if (del.type !== "tekst") ga(del.barn);
    }
  };
  for (const b of dok.blokker) {
    if (b.type === "h" || b.type === "p") ga(b.barn);
    else if (b.type === "ul") for (const punkt of b.punkter) ga(punkt);
    else {
      ga(b.caption);
      if (b.innledning) ga(b.innledning);
    }
  }
  return ut;
}

export function osloStempel(nå: Date): string {
  const deler = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(nå);
  const v = (type: Intl.DateTimeFormatPartTypes) => deler.find((del) => del.type === type)?.value ?? "";
  let time = v("hour");
  if (time === "24") time = "00";
  return `${v("year")}-${v("month")}-${v("day")}T${time}:${v("minute")}:${v("second")}`;
}

/** True fra og med 28. oktober 2026 kl. 12.00 i Europe/Oslo. */
export function innspillFristPassert(nå = new Date()): boolean {
  return osloStempel(nå) >= INNSPILL_FRIST_OSLO;
}

export function erStatsbudsjettSti(sti: string): boolean {
  const ren = sti.split("?")[0].replace(/\/+$/, "") || "/";
  return ren === "/statsbudsjett" || ren === "/app/statsbudsjett";
}
