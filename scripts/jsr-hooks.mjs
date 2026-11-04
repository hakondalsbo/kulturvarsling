import { access, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const VERSJON = "1.3.0";
const CACHE = `/tmp/jsr-std-yaml-${VERSJON}`;
const ROT = `https://jsr.io/@std/yaml/${VERSJON}`;

let klar = null;

function sikreCache() {
  if (klar) return klar;
  klar = (async () => {
    try {
      await access(`${CACHE}/parse.ts`);
      return;
    } catch {
      // Første testkjøring henter pakken. Senere treff leser cachen.
    }
    const meta = await fetch(`${ROT}_meta.json`, {
      headers: { "user-agent": "Kulturvarsling-test" },
    });
    if (!meta.ok) throw new Error(`@std/yaml meta HTTP ${meta.status}`);
    const json = await meta.json();
    await mkdir(CACHE, { recursive: true });
    for (const sti of Object.keys(json.manifest ?? {})) {
      if (!sti.endsWith(".ts") || sti.includes("_test")) continue;
      const res = await fetch(`${ROT}${sti}`, {
        headers: { "user-agent": "Kulturvarsling-test" },
      });
      if (!res.ok) throw new Error(`@std/yaml ${sti} HTTP ${res.status}`);
      const dest = `${CACHE}${sti}`;
      await mkdir(dest.slice(0, dest.lastIndexOf("/")), { recursive: true });
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    }
  })();
  return klar;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "jsr:@std/yaml" || specifier.startsWith("jsr:@std/yaml/")) {
    await sikreCache();
    let sti = specifier === "jsr:@std/yaml"
      ? "mod.ts"
      : specifier.slice("jsr:@std/yaml/".length);
    if (!sti.endsWith(".ts")) sti += ".ts";
    return { url: pathToFileURL(`${CACHE}/${sti}`).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
