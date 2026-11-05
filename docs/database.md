# Database

Public-skjemaet til Kulturvarsling kan bygges fra `supabase/migrations/`.
Prod er Supabase-prosjektet `zyyijlvmgoanjdzngmon`. Migrasjonene inneholder
skjema, ikke rader og ikke hemmelige verdier.

## Gjenoppretting

Mot en tom database, i filnavn-rekkefølge:

```bash
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

På et nytt Supabase-prosjekt finnes `auth.users`, `anon`, `authenticated`,
`service_role`, `pg_cron`, `pg_net` og Vault allerede. Baseline hopper over
det som finnes.

Etter migrering må disse Vault-navnene finnes. Verdiene settes i miljøet,
ikke i repoet:

| Navn | Brukes av |
|---|---|
| `hent_saker_platform_jwt` | `hent-saker-daglig`, `oppdater-frister-daglig` |
| `hent_saker_cron_secret` | samme jobber, header `x-cron-secret` |

Cron-jobbene er `hent-saker-daglig` (`0 6 * * *`) og
`oppdater-frister-daglig` (`30 6 * * *`). Begge kaller Edge Function med
`net.http_post` og leser Vault ved kjøring.

## Hva filene gjør

`20260701000000_baseline.sql` ligger foran de eldre migrasjonene. Den
oppretter kjernetabellene (`varsler`, `profiler`, `kampanjer`,
`kampanje_signaturer`, `pamelding`, `fulgte_saker`, `aktivitet`,
`epost_varsler`, `horingssvar`, `ai_dognkvoter` og de øvrige public-tabellene),
viewet `kampanje_med_signaturer`, funksjoner, triggere
(`beskytt_profil_betaling`, `vern_manuelt_redigerte_felt`,
`on_auth_user_created`), policies, grants, RLS og cron-jobbene.

Fire objekter opprettes av eldre filer som ikke tåler at de finnes fra før,
og ligger derfor ikke i baseline:

- `varsler.kilde_nokkel` og `varsler_kilde_nokkel_unik`
- `kilde_kjoringer.alarm`
- viewet `kilde_alarmer`
- policies `les_kilder` og `les_kilde_kjoringer`

`20261021000000_baseline_avslutning.sql` kjører til slutt. To historiske
filer overskriver prod-definisjoner, og de filene er ikke endret:
`20260725180000_nattlig_cron.sql` legger inn en eldre cron-kommando, og
`20261020210000_manuelt_redigert.sql` legger inn en eldre
`vern_manuelt_redigerte_felt`. Avslutningen setter prod-versjonen tilbake,
sammen med kommentarene som nevner `feil_manglende_frist`.

## Ikke kjør historikken mot prod

Baseline alene er et no-op mot prod: tabeller som finnes, hoppes over.
`supabase db push` av hele mappen mot prod er ikke trygt. Flere filer er
allerede kjørt der under andre versjonsnummer, og noen av dem gjør
`add column` uten `if not exists` eller skriver data. Prod-historikken og
filnavnene er ikke samme liste.

`20260725200000` fantes på to filer. SQL-en i Stripe-filen er uendret, men
filnavnet er `20260725200001_stripe_premium.sql` så versjonene er unike.
`20260725200000_seed_kilder_pakke2.sql` beholder det opprinnelige nummeret.

## Hull

- Plattformskjemaene `auth` (utover `users` og `uid()`), `storage`,
  `realtime` og GraphQL eies av Supabase og er ikke med.
- `pg_stat_statements` og `supabase_vault` installeres bare når utvidelsen
  finnes. En ren Postgres uten Supabase-pakken har ikke Vault. Versjonen av
  `pg_cron` og `pg_stat_statements` følger Postgres-versjonen på verten
  (prod er 17.6).
- Ingen tabelldata. Kilde- og samtykketekst som settes inn, kommer fra de
  eldre seed-filene, ikke fra baseline.
- Det finnes ingen unik constraint mot innholdsduplikat. Prod ryddet rader
  uten å legge igjen en slik nøkkel.
- `storage` har ingen buckets.
