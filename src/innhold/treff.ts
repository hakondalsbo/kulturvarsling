import { ORDLISTE, type OrdlisteInnslag } from "./ordliste.ts";

export type TekstDel =
  | { type: "tekst"; tekst: string }
  | { type: "ord"; tekst: string; id: string };

export type Treff = { start: number; end: number; id: string; spesifikk: number };

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Søkemønstrene fra redaktøren, pluss synonym og begrepsnavn. */
export function monstreFor(innslag: OrdlisteInnslag): string[] {
  return [...innslag.sok, ...innslag.synonymer, innslag.begrep];
}

export function monsterTilRegExp(monster: string): RegExp {
  const m = monster.trim();
  if (m === "post + tall") return /(?<![\p{L}\p{N}])post\s+\d+/iu;
  if (m.includes("…")) return /(?<![\p{L}\p{N}])prop\.\s*(?:\d+\s+)?s(?![\p{L}\p{N}])/iu;
  if (m === "ramme(n/ne)") return /(?<![\p{L}\p{N}])ramme(?:n(?:e)?)?(?![\p{L}\p{N}])/iu;
  if (m === "kap.") return /(?<![\p{L}\p{N}])kap\./iu;
  if (m === "innst.") return /(?<![\p{L}\p{N}])innst\./iu;
  if (m === "meld. st") return /(?<![\p{L}\p{N}])meld\.\s*st[\p{L}]*/iu;
  if (m.toLowerCase() === "nou") return /(?<![\p{L}\p{N}])nou(?![\p{L}\p{N}])/iu;
  if (/\s/.test(m)) {
    const deler = m.split(/\s+/).map(esc);
    return new RegExp(`(?<![\\p{L}\\p{N}])${deler.join("\\s+")}`, "iu");
  }
  if (m.endsWith(".")) return new RegExp(`(?<![\\p{L}\\p{N}])${esc(m)}`, "iu");
  // «kriterier» skal også treffe «kriteriene»: bestemt form bytter -er mot -ene.
  const stamme = m.length >= 5 && m.toLowerCase().endsWith("er")
    ? `${esc(m.slice(0, -2))}(?:er|ene)`
    : esc(m);
  return new RegExp(`(?<![\\p{L}\\p{N}])${stamme}[\\p{L}]*`, "iu");
}

function overlapp(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && a.end > b.start;
}

function tidligste(
  tekst: string,
  innslag: OrdlisteInnslag,
  sperret: { start: number; end: number }[],
): Treff | null {
  let best: Treff | null = null;
  for (const monster of monstreFor(innslag)) {
    const re = monsterTilRegExp(monster);
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = g.exec(tekst))) {
      if (m[0].length === 0) {
        g.lastIndex += 1;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      if (sperret.some((v) => overlapp({ start, end }, v))) continue;
      const spesifikk = monster.length;
      const lengre = best != null && end - start > best.end - best.start;
      const likeLangtMerSpesifikk = best != null && end - start === best.end - best.start && spesifikk > best.spesifikk;
      if (!best || start < best.start || (start === best.start && (lengre || likeLangtMerSpesifikk))) {
        best = { start, end, id: innslag.id, spesifikk };
      }
      break;
    }
  }
  return best;
}

/**
 * Første treff per begrep. Lengre og mer spesifikke treff vinner når to
 * begreper dekker samme ord. Det kortere begrepet kan fortsatt treffe senere
 * i teksten. `brukt` husker begreper som allerede er markert i samme sak.
 */
export function finnTreff(tekst: string, brukt: Set<string> = new Set()): Treff[] {
  const valgt: Treff[] = [];
  for (;;) {
    const kandidater = ORDLISTE
      .filter((o) => !brukt.has(o.id))
      .map((o) => tidligste(tekst, o, valgt))
      .filter((t): t is Treff => t != null)
      .sort((a, b) => (b.end - b.start) - (a.end - a.start) || b.spesifikk - a.spesifikk || a.start - b.start);
    if (kandidater.length === 0) break;
    let utsatt = false;
    for (const k of kandidater) {
      if (valgt.some((v) => overlapp(k, v))) {
        utsatt = true;
        continue;
      }
      valgt.push(k);
      brukt.add(k.id);
    }
    if (!utsatt) break;
  }
  return valgt.sort((a, b) => a.start - b.start);
}

export function delOpp(tekst: string, brukt: Set<string> = new Set()): TekstDel[] {
  const treff = finnTreff(tekst, brukt);
  const deler: TekstDel[] = [];
  let cursor = 0;
  for (const t of treff) {
    if (t.start > cursor) deler.push({ type: "tekst", tekst: tekst.slice(cursor, t.start) });
    deler.push({ type: "ord", tekst: tekst.slice(t.start, t.end), id: t.id });
    cursor = t.end;
  }
  if (cursor < tekst.length) deler.push({ type: "tekst", tekst: tekst.slice(cursor) });
  return deler;
}

/** Flere felter i én sak deler hvilke begreper som allerede er markert. */
export function delOppDokument(tekster: string[]): TekstDel[][] {
  const brukt = new Set<string>();
  return tekster.map((t) => delOpp(t, brukt));
}
