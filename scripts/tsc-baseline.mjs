// Teller tsc-feil og sammenligner med tsc-baseline.txt.
// Feiler bare hvis antallet er høyere enn baseline.
// Lavere antall er lov. Kjør med --write for å senke filen til det nye tallet.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselineFile = resolve(root, "tsc-baseline.txt");
const write = process.argv.includes("--write");

const baseline = Number(readFileSync(baselineFile, "utf8").trim());
if (!Number.isInteger(baseline) || baseline < 0) {
  console.error(`Ugyldig tall i ${baselineFile}`);
  process.exit(1);
}

const require = createRequire(resolve(root, "package.json"));
const tsc = require.resolve("typescript/lib/tsc.js");
const result = spawnSync(process.execPath, [tsc, "-b", "--pretty", "false"], {
  cwd: root,
  encoding: "utf8",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const count = (output.match(/error TS\d+/g) ?? []).length;

if (result.status !== 0 && count === 0) {
  console.error(output);
  console.error("tsc avsluttet med feil uten at noen error TS-linjer ble telt.");
  process.exit(result.status ?? 1);
}

console.log(`tsc-feil: ${count}`);
console.log(`baseline: ${baseline}`);

if (count > baseline) {
  console.error(output);
  console.error(`Antallet tsc-feil økte fra ${baseline} til ${count}.`);
  process.exit(1);
}

if (count < baseline) {
  const melding = `Antallet tsc-feil sank fra ${baseline} til ${count}.`;
  console.log(melding);
  if (write) {
    writeFileSync(baselineFile, `${count}\n`);
    console.log("Oppdaterte tsc-baseline.txt. Commit filen så taket følger med ned.");
  } else if (process.env.CI) {
    console.log(`::warning::${melding} Senk tsc-baseline.txt med npm run typecheck:baseline -- --write`);
  } else {
    console.log("Kjør npm run typecheck:baseline -- --write og commit tsc-baseline.txt.");
  }
}
