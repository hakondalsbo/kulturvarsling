import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { premiumAktivFra, premiumFlate, verktøyÅpent } from "../src/premium.ts";
import { registreringErInnlogget } from "../src/registrering.ts";

test("betalingsmuren er av med mindre flagget er nøyaktig true", () => {
  assert.equal(premiumAktivFra("true"), true);
  assert.equal(premiumAktivFra("false"), false);
  assert.equal(premiumAktivFra(undefined), false);
  assert.equal(premiumAktivFra(" TRUE "), false);
  const apen = premiumFlate(false, "gratis");
  assert.equal(apen.visBetaling, false);
  assert.equal(apen.meny.label, "Verktøy");
  assert.match(apen.profilTekst ?? "", /Åpen prøvedrift/);
  assert.equal(verktøyÅpent("gratis", false), true);
  const stengt = premiumFlate(true, "gratis");
  assert.equal(stengt.visBetaling, true);
  assert.equal(stengt.meny.label, "Premium");
  assert.equal(verktøyÅpent("gratis", true), false);
  assert.equal(verktøyÅpent("premium", true), true);
});

test("registrering uten session blir værende på bekreftelse", () => {
  assert.equal(registreringErInnlogget({ user: { id: "a" }, session: { access_token: "t" } }), true);
  assert.equal(registreringErInnlogget({ user: { id: "a" }, session: null }), false);
  assert.equal(registreringErInnlogget({ user: null, session: null }), false);
  assert.equal(registreringErInnlogget(null), false);
  assert.equal(registreringErInnlogget({ session: { access_token: "t" } }), false);
  const app = readFileSync("src/App.tsx", "utf8");
  assert.match(app, /registreringErInnlogget\(data\) && data\.user/);
  assert.doesNotMatch(app, /if\s*\(\s*data\.user\s*\)/);
  assert.match(app, /setBekreftSendt\(true\)/);
});

test("prøvedrift skjuler priser og lar verktøyene stå åpne", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const budsjett = readFileSync("supabase/functions/budsjett/index.ts", "utf8");
  const klartekst = readFileSync("supabase/functions/klartekst/index.ts", "utf8");
  const stripe = readFileSync("supabase/functions/stripe-checkout/index.ts", "utf8");
  assert.match(app, /premiumAktiv\(\) && showPremium/);
  assert.match(app, /Åpen prøvedrift/);
  assert.match(app, /flate\.meny/);
  assert.match(budsjett, /premiumMurAktiv\(Deno\.env\.get\("PREMIUM_AKTIV"\)\)/);
  assert.match(budsjett, /harFagtilgang\(profil, mur\)/);
  assert.match(budsjett, /reserverAiKvote/);
  assert.match(klartekst, /brukPremiumKvote/);
  assert.match(klartekst, /reserverAiKvote/);
  assert.match(stripe, /premiumMurAktiv\(Deno\.env\.get\("PREMIUM_AKTIV"\)\)/);
  assert.match(stripe, /Betaling er ikke åpen i prøvedriften/);
  assert.doesNotMatch(app, /UTSENDING_AKTIV\s*=\s*["']true["']/);
  assert.doesNotMatch(app, /Én e-post per dag/);
});

test("høringshjelp er fortsatt av som standard", () => {
  const klient = readFileSync("src/horingshjelp.ts", "utf8");
  const server = readFileSync("supabase/functions/horingshjelp/index.ts", "utf8");
  const env = readFileSync(".env.example", "utf8");
  assert.match(klient, /VITE_HORINGSHJELP === "true"/);
  assert.match(server, /HORINGSHJELP_AKTIV/);
  assert.doesNotMatch(server, /harPremium/);
  assert.doesNotMatch(env, /^VITE_HORINGSHJELP=true/m);
  assert.doesNotMatch(env, /^HORINGSHJELP_AKTIV=true/m);
  assert.doesNotMatch(env, /^UTSENDING_AKTIV=true/m);
  assert.doesNotMatch(env, /^VITE_PREMIUM_AKTIV=true/m);
  assert.doesNotMatch(env, /^MOBILISERING_SIGNATUR_AKTIV=true/m);
});

test("tilbakemelding er global, og admin-eposter ligger ikke i klienten", () => {
  const ui = readFileSync("src/tilbakemelding.tsx", "utf8");
  const app = readFileSync("src/App.tsx", "utf8");
  const main = readFileSync("src/main.tsx", "utf8");
  const logikk = readFileSync("supabase/functions/_shared/tilbakemelding.ts", "utf8");
  assert.match(ui, /Gi tilbakemelding/);
  assert.match(ui, /post@kulturvarsling\.no/);
  assert.match(ui, /TILBAKEMELDING_TYPER\.map/);
  assert.match(logikk, /Forslag til justering/);
  assert.match(ui, /Ikke skriv sensitive personopplysninger/);
  assert.doesNotMatch(ui, /ADMIN_EPOSTER/);
  assert.doesNotMatch(ui, /hakon@|håkon@|admin@/i);
  assert.match(app, /TilbakemeldingOversikt/);
  assert.match(app, /\/admin\/tilbakemeldinger/);
  assert.match(main, /TilbakemeldingLag/);
  assert.match(readFileSync("src/ui.tsx", "utf8"), /role="dialog"/);
});

test("vilkår, arkiv og robots er med, og design er stengt", () => {
  assert.equal(existsSync("public/vilkar.html"), true);
  assert.equal(existsSync("public/robots.txt"), true);
  assert.equal(existsSync("public/sitemap.xml"), true);
  const vilkar = readFileSync("public/vilkar.html", "utf8");
  const robots = readFileSync("public/robots.txt", "utf8");
  const sitemap = readFileSync("public/sitemap.xml", "utf8");
  const app = readFileSync("src/App.tsx", "utf8");
  assert.match(vilkar, /Utkast til godkjenning/);
  assert.match(vilkar, /vilkår-utkast-2026-11-05/);
  assert.match(vilkar, /åpen prøvedrift/i);
  assert.match(vilkar, /href="\/personvern"/);
  assert.match(vilkar, /minst <strong>16 år<\/strong>/);
  assert.match(robots, /Disallow: \/design/);
  assert.match(robots, /Disallow: \/admin/);
  assert.match(robots, /Sitemap: https:\/\/www\.kulturvarsling\.no\/sitemap\.xml/);
  assert.match(sitemap, /https:\/\/www\.kulturvarsling\.no\/vilkar/);
  assert.match(sitemap, /https:\/\/www\.kulturvarsling\.no\/hva-vi-dekker/);
  assert.doesNotMatch(sitemap, /\/design/);
  assert.match(app, /pushSti\("\/arkiv"\)/);
  assert.match(app, /p === "\/arkiv"\) return "varsler"/);
  assert.match(app, /href="\/vilkar"/);
  assert.match(app, /Slett min konto|onSlettKonto/);
  assert.match(readFileSync("src/minside/MinSide.tsx", "utf8"), /Slett min konto/);
  assert.match(app, /onboarding_done = true/);
  const logo = statSync("public/logo.png").size;
  const navn = statSync("public/Kulturvarsling logo.png").size;
  const stor = statSync("public/ikon-512.png").size;
  assert.ok(logo < 80_000);
  assert.equal(logo, navn);
  assert.ok(stor < 400_000);
  assert.match(readFileSync("public/manifest.json", "utf8"), /\/ikon-512\.png/);
});
