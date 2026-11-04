// Node sin testkjører forstår ikke jsr:-importer. Edge-funksjonen gjør det.
// Kroken laster @std/yaml ned én gang, så `node --test` kan parse spec-filen.
import { register } from "node:module";

register(new URL("./jsr-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});
