// Innholdsbasert formatkontroll av openapi/einnsyn.openapi.yml.
// En ny commit i felleslosninger/einnsyn-api-spec er ikke et avvik
// når søket, parameterne, feltene og pagineringen vi bruker er de samme.
//
// Vi sender på /search: query, entity=Moetesak, administrativEnhet,
// moetedatoFrom, sortBy=publisertDato, sortOrder og limit.
// Vi sender på /enhet: query og limit. Deretter GET /enhet/{id}.
// moetedato ligger ikke på Moetesak i spec-en og tas ikke med.

import { parse } from "jsr:@std/yaml/parse";

/**
 * sha256 av det kanoniske utdraget, regnet 4.11.2026 mot
 * cedf5edc, 583442e (PR #69, Base.deleted) og 04f85f5a (PR #68,
 * valgfri saksmappe/moetemappe). De tre gir samme hash.
 */
export const EINNSYN_SPEC_UTDRAG_SHA256 =
  "83fa07520614671fba89e646ae424579a0925f87511e585af6a4c25de65b8e85";

/** Siste spec-commit vi har lest. Ny commit henter yml-filen én gang. */
export const EINNSYN_SPEC_LEST_SHA = "04f85f5a1426833424b05a99ac827cc378c4a46d";

const SOK_PARAMS = [
  "query",
  "entity",
  "administrativEnhet",
  "moetedatoFrom",
  "sortBy",
  "sortOrder",
  "limit",
] as const;

const ENHET_PARAMS = ["query", "limit"] as const;

const MOETESAK_FELT = [
  "id",
  "offentligTittel",
  "publisertDato",
  "journalenhet",
  "moetesaksaar",
  "moetesakssekvensnummer",
] as const;

const ENHET_FELT = ["id", "navn", "orgnummer"] as const;

export class SpecParseFeil extends Error {
  constructor(årsak: unknown) {
    super(årsak instanceof Error ? årsak.message : "spec-fil kunne ikke parses");
    this.name = "SpecParseFeil";
  }
}

type Mappe = Record<string, unknown>;

function erMappe(verdi: unknown): verdi is Mappe {
  return !!verdi && typeof verdi === "object" && !Array.isArray(verdi);
}

function losRef(rot: Mappe, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let cur: unknown = rot;
  for (const del of ref.slice(2).split("/")) {
    const nokkel = decodeURIComponent(del.replace(/~1/g, "/").replace(/~0/g, "~"));
    if (!erMappe(cur) || !(nokkel in cur)) return undefined;
    cur = cur[nokkel];
  }
  return cur;
}

function samleFelter(rot: Mappe, schema: unknown, sett = new Set<string>()): Mappe {
  if (!erMappe(schema)) return {};
  let gjeldende = schema;
  if (typeof schema.$ref === "string") {
    if (sett.has(schema.$ref)) return {};
    sett.add(schema.$ref);
    const mål = losRef(rot, schema.$ref);
    if (!erMappe(mål)) return {};
    gjeldende = mål;
  }
  const ut: Mappe = {};
  if (Array.isArray(gjeldende.allOf)) {
    for (const del of gjeldende.allOf) Object.assign(ut, samleFelter(rot, del, sett));
  }
  if (erMappe(gjeldende.properties)) Object.assign(ut, gjeldende.properties);
  return ut;
}

/** Type, format og enum. Beskrivelse og tallgrenser er ikke kontrakten. */
function forenkle(rot: Mappe, schema: unknown, dybde = 0): unknown {
  if (!erMappe(schema) || dybde > 12) return null;
  if (typeof schema.$ref === "string") {
    const mål = losRef(rot, schema.$ref);
    if (!erMappe(mål)) return { $ref: schema.$ref };
    if (erMappe(mål.properties) || Array.isArray(mål.allOf)) return { $ref: schema.$ref };
    return forenkle(rot, mål, dybde + 1);
  }
  const ut: Mappe = {};
  if (typeof schema.type === "string") ut.type = schema.type;
  if (typeof schema.format === "string") ut.format = schema.format;
  if (Array.isArray(schema.enum)) ut.enum = schema.enum.slice();
  if (schema.items != null) ut.items = forenkle(rot, schema.items, dybde + 1);
  if (Array.isArray(schema.anyOf)) ut.anyOf = schema.anyOf.map((del) => forenkle(rot, del, dybde + 1));
  if (Array.isArray(schema.oneOf)) ut.oneOf = schema.oneOf.map((del) => forenkle(rot, del, dybde + 1));
  return Object.keys(ut).length ? ut : null;
}

function getOperasjon(rot: Mappe, sti: string): Mappe | null {
  if (!erMappe(rot.paths)) return null;
  const stiObj = rot.paths[sti];
  if (!erMappe(stiObj) || !erMappe(stiObj.get)) return null;
  return stiObj.get;
}

function parametre(rot: Mappe, op: Mappe | null, navn: readonly string[]): Record<string, unknown> {
  const ut: Record<string, unknown> = {};
  for (const n of navn) ut[n] = null;
  if (!op || !Array.isArray(op.parameters)) return ut;
  const funnet = new Map<string, Mappe>();
  for (const rad of op.parameters) {
    const lost = erMappe(rad) && typeof rad.$ref === "string" ? losRef(rot, rad.$ref) : rad;
    if (!erMappe(lost) || typeof lost.name !== "string") continue;
    funnet.set(lost.name, lost);
  }
  for (const n of navn) {
    const p = funnet.get(n);
    if (!p) continue;
    ut[n] = {
      in: typeof p.in === "string" ? p.in : null,
      schema: forenkle(rot, p.schema),
    };
  }
  return ut;
}

function paginering(rot: Mappe, op: Mappe | null): { items: unknown; next: unknown } | null {
  if (!op || !erMappe(op.responses)) return null;
  const ok = op.responses["200"] ?? op.responses[200];
  if (!erMappe(ok) || !erMappe(ok.content)) return null;
  const json = ok.content["application/json"];
  if (!erMappe(json)) return null;
  const felter = samleFelter(rot, json.schema);
  return {
    items: felter.items != null ? forenkle(rot, felter.items) : null,
    next: felter.next != null ? forenkle(rot, felter.next) : null,
  };
}

function skjemaFelter(rot: Mappe, navn: string, felter: readonly string[]): Record<string, unknown> {
  const schemas = erMappe(rot.components) && erMappe(rot.components.schemas)
    ? rot.components.schemas
    : {};
  const props = samleFelter(rot, schemas[navn]);
  const ut: Record<string, unknown> = {};
  for (const felt of felter) ut[felt] = props[felt] != null ? forenkle(rot, props[felt]) : null;
  return ut;
}

export type SpecUtdrag = {
  search: { parametre: Record<string, unknown>; svar: { items: unknown; next: unknown } | null };
  enhet: { parametre: Record<string, unknown>; svar: { items: unknown; next: unknown } | null };
  enhetId: boolean;
  moetesak: Record<string, unknown>;
  enhetFelter: Record<string, unknown>;
};

export function hentSpecUtdrag(yml: string): SpecUtdrag {
  let doc: unknown;
  try {
    doc = parse(yml);
  } catch (e) {
    throw new SpecParseFeil(e);
  }
  if (!erMappe(doc)) throw new SpecParseFeil("ikke objekt");
  return {
    search: {
      parametre: parametre(doc, getOperasjon(doc, "/search"), SOK_PARAMS),
      svar: paginering(doc, getOperasjon(doc, "/search")),
    },
    enhet: {
      parametre: parametre(doc, getOperasjon(doc, "/enhet"), ENHET_PARAMS),
      svar: paginering(doc, getOperasjon(doc, "/enhet")),
    },
    enhetId: getOperasjon(doc, "/enhet/{id}") != null,
    moetesak: skjemaFelter(doc, "Moetesak.Moetesak", MOETESAK_FELT),
    enhetFelter: skjemaFelter(doc, "Enhet.Enhet", ENHET_FELT),
  };
}

export function kanoniskJson(verdi: unknown): string {
  return JSON.stringify(sorter(verdi));
}

function sorter(verdi: unknown): unknown {
  if (Array.isArray(verdi)) return verdi.map(sorter);
  if (!erMappe(verdi)) return verdi;
  const ut: Mappe = {};
  for (const nokkel of Object.keys(verdi).sort()) ut[nokkel] = sorter(verdi[nokkel]);
  return ut;
}

export async function sha256Hex(tekst: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function specUtdragSha256(yml: string): Promise<string> {
  return sha256Hex(kanoniskJson(hentSpecUtdrag(yml)));
}
