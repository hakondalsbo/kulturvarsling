/**
 * Leser den godkjente teksten i hva-vi-dekker.md.
 * Siden viser den uten å skrive om tall eller setninger.
 */

export type Inline =
  | { type: "tekst"; tekst: string }
  | { type: "strong"; barn: Inline[] };

export type Blokk =
  | { type: "h"; niva: 1 | 2; tekst: string }
  | { type: "p"; barn: Inline[] }
  | { type: "ul"; punkter: Inline[][] };

export function parseDekning(md: string): Blokk[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blokker: Blokk[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const heading = /^(#{1,2}) /.exec(line);
    if (heading) {
      blokker.push({
        type: "h",
        niva: heading[1].length as 1 | 2,
        tekst: line.slice(heading[1].length + 1).trim(),
      });
      i += 1;
      continue;
    }
    if (line.startsWith("- ")) {
      const punkter: Inline[][] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        punkter.push(parseInline(lines[i].slice(2).trim()));
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
      !lines[i].startsWith("- ")
    ) {
      deler.push(lines[i].trim());
      i += 1;
    }
    blokker.push({ type: "p", barn: parseInline(deler.join(" ")) });
  }
  return blokker;
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
    const neste = src.indexOf("**", i);
    const slutt = neste === -1 ? src.length : neste;
    if (slutt > i) out.push({ type: "tekst", tekst: src.slice(i, slutt) });
    i = slutt;
  }
  return out;
}

export function inlineTekst(barn: Inline[]): string {
  return barn.map((d) => (d.type === "tekst" ? d.tekst : inlineTekst(d.barn))).join("");
}

export function renTekst(blokker: Blokk[]): string {
  return blokker
    .map((b) => {
      if (b.type === "h") return b.tekst;
      if (b.type === "p") return inlineTekst(b.barn);
      return b.punkter.map((p) => inlineTekst(p)).join("\n");
    })
    .join("\n");
}

export function seksjon(blokker: Blokk[], tittel: string): Blokk[] {
  const start = blokker.findIndex((b) => b.type === "h" && b.niva === 2 && b.tekst === tittel);
  if (start === -1) return [];
  const rest = blokker.slice(start + 1);
  const neste = rest.findIndex((b) => b.type === "h");
  return neste === -1 ? rest : rest.slice(0, neste);
}

/** Det daterte øyeblikksbildet, slik at det kan settes litt ut fra brødteksten. */
export function erTallavsnitt(barn: Inline[]): boolean {
  return inlineTekst(barn).startsWith("5. november 2026 var det ");
}

export function erDekningSti(sti: string): boolean {
  const ren = sti.split("?")[0].replace(/\/$/, "") || "/";
  return ren === "/hva-vi-dekker" || ren === "/app/hva-vi-dekker";
}
