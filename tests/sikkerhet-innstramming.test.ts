import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migrasjon = readFileSync(
  "supabase/migrations/20261026231500_sikkerhet_fart_stripe_kjoringer.sql",
  "utf8",
);

test("kilde_kjoringer leses bare av service_role", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const avis = readFileSync("src/avis.tsx", "utf8");
  assert.doesNotMatch(app, /kilde_kjoringer|kilde_alarmer/);
  assert.doesNotMatch(avis, /kilde_kjoringer|kilde_alarmer/);
  assert.match(app, /\.from\("kilder"\)/);
  assert.match(migrasjon, /drop policy if exists "les_kilde_kjoringer"/);
  assert.match(migrasjon, /revoke select on table public\.kilde_kjoringer from anon, authenticated, public/);
  assert.match(migrasjon, /revoke select on table public\.kilde_alarmer from anon, authenticated, public/);
  assert.match(migrasjon, /revoke select on table public\.kilde_alarmer_frister from anon, authenticated, public/);
  assert.match(migrasjon, /grant select, insert, update, delete on table public\.kilde_kjoringer to service_role/);
  assert.doesNotMatch(migrasjon, /revoke .*net\./);
});

test("fartsgrense og stripe-hendelser er stengt for klienter", () => {
  assert.match(migrasjon, /create table if not exists public\.fartsgrense/);
  assert.match(migrasjon, /revoke all on table public\.fartsgrense from anon, authenticated, public/);
  assert.match(migrasjon, /grant select, insert, delete on table public\.fartsgrense to service_role/);
  assert.match(migrasjon, /create schema if not exists privat/);
  assert.match(migrasjon, /security definer/);
  assert.match(migrasjon, /set search_path = ''/);
  assert.match(migrasjon, /fartsgrense_foreslaa_kampanje/);
  assert.match(migrasjon, /create table if not exists public\.stripe_hendelser/);
  assert.match(migrasjon, /revoke all on table public\.stripe_hendelser from anon, authenticated, public/);
  assert.match(migrasjon, /kampanje_signaturer_aapen_epost_idx/);
});

test("turnstile er med i innlogging og signering, og er av uten nøkkel", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const skjema = readFileSync("src/mobiliser/FellesInnspill.tsx", "utf8");
  const widget = readFileSync("src/turnstile.tsx", "utf8");
  const side = readFileSync("src/mobiliser/MobiliserSide.tsx", "utf8");
  assert.match(app, /captchaToken/);
  assert.match(app, /emailRedirectTo: "https:\/\/www\.kulturvarsling\.no\/app"/);
  assert.match(widget, /VITE_TURNSTILE_SITE_KEY/);
  assert.match(widget, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(skjema, /functions\/v1\/signer-innspill/);
  assert.match(skjema, /captcha_token/);
  assert.doesNotMatch(side, /signer-innspill/);
  assert.match(readFileSync("supabase/functions/meld-pa/index.ts", "utf8"), /registrerFartsgrense\(db, "meld-pa"/);
  assert.match(readFileSync("supabase/functions/avmeld/index.ts", "utf8"), /registrerFartsgrense\(db, "avmeld"/);
  assert.doesNotMatch(readFileSync("supabase/functions/meld-pa/index.ts", "utf8"), /meld_pa_forsok/);
});
