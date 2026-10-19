# Teknisk baseline

Kartlegging 19. oktober 2026. Dette er avvik mellom repoet og det som faktisk
kjører, pluss oppsettet etter PR-en for kildehelse og cron. Ingenting her er
deployet som del av den PR-en.

## a) Kjernetabeller uten create-table i repoet

Disse brukes i kode, men har ingen `create table` (eller `create view`) i
`supabase/migrations/`. Migrasjonene som finnes, oppretter `kilder`,
`kilde_kjoringer`, `klartekst_cache` og `budsjett_cache`, og legger kolonner på
`varsler` — de oppretter ikke `varsler`.

| Relasjon | Brukt fra | I repoet |
|---|---|---|
| `varsler` | `src/App.tsx`, `hent-saker`, `nyhetsbrev` | bare `alter table` |
| `profiler` | `src/App.tsx`, Stripe-webhook | nei |
| `kampanjer` | `src/App.tsx` | nei |
| `kampanje_signaturer` | `src/App.tsx` | nei |
| `kampanje_med_signaturer` | `src/App.tsx` (view i prod) | nei |
| `fulgte_saker` | `src/App.tsx` | nei |
| `aktivitet` | `src/App.tsx` | nei |
| `feedback` | `src/App.tsx` (`sendFeedbackDB`) | nei |
| `pamelding` | `supabase/functions/nyhetsbrev` | nei |

Prod har i tillegg tabeller koden i dette repoet ikke oppretter, blant annet
`ai_dognkvoter`, `epost_varsler`, `horingssvar`, `kommune_*` og `kommuner`.
De er ikke med i tabellen over fordi denne lista er «brukt i repo-koden, uten
create-migrasjon».

`pamelding` i prod (lest 19.10) har kolonnene `id`, `epost`, `fornavn`,
`etternavn`. Nyhetsbrev-funksjonen i repoet leser og skriver `avmeldt`, som
ikke ligger i det kolonnesettet. Det er skjema-drift, ikke fikset her.

**Anbefalt første steg:** schema-dump kun skjema fra prod (`pg_dump --schema-only`,
uten data) og en baseline-migrasjon som speiler det dumpen viser. Aldri
`create table` på frihånd mot prod — tabellene finnes allerede, og en frihånds-
DDL vil divergere fra RLS, defaults og views som allerede kjører.

## b) Repo og live Edge Functions er ikke samme kode

Live-funksjoner deployet 4. oktober (blant annet `hent-saker` v36 og `klartekst`
v7) inneholder moduler som ikke finnes i repoet. Verifisert fraværende her:

- `supabase/functions/_shared/tilgang.ts` — server-side auth, Premium og kvoter
  for budsjett og klartekst
- `supabase/functions/hent-saker/kilde-status.ts` — feilhåndtering i den
  deployede adapteren

Denne PR-en legger til `hent-saker/kildehelse.ts` (nytt filnavn, med vilje).
Den erstatter ikke den deployede `kilde-status.ts`. Å deploye en Edge Function
fra denne branchen før modulene er hentet inn i repoet, overskriver live-koden
og fjerner Premium-gating, kvoter og den deployede feilhåndteringen.

**Før neste `supabase functions deploy`:** hent deployet `_shared/tilgang.ts`,
`kilde-status.ts` og eventuelle andre live-only filer inn i repoet og
foren dem med denne branchen. Ikke deploy funksjoner fra branchen før det er
gjort.

## c) Cron etter denne PR-en

Én jobb, inne i Supabase:

| Felt | Verdi (verifisert i `cron.job` 19.10.2026) |
|---|---|
| `jobname` | `hent-saker-daglig` |
| `schedule` | `0 6 * * *` |
| `active` | `true` |
| Kall | `net.http_post` mot `.../functions/v1/hent-saker` |
| Body | `{"utlost_av":"pg_cron","tidspunkt": now()}` |
| Auth | Vault-hemmelighetene `hent_saker_platform_jwt` og `hent_saker_cron_secret` (navn, ikke verdier). Header `x-cron-secret` settes fra Vault. |
| Timeout | 120000 ms |

Funksjonen leser `body.utlost_av`. `pg_cron` lagres som `kjoert_av = supabase_cron`.
Uten merke blir det `manuell`. `vercel_cron` finnes i enumet hvis et kall
eksplisitt merker seg slik, men Vercel Cron er fjernet fra `vercel.json`, og
`api/cron/hent-saker.ts` er slettet — den gjorde bare en videresending og hadde
ingen andre kallere.

Migrasjonen `supabase/migrations/20260725180000_nattlig_cron.sql` er allerede
kjørt og skal ikke endres. Den scheduler samme jobbnavn med innebygd anon-nøkkel
i SQL-en. Prod-jobben er siden (5.10) byttet til Vault-legitimasjon utenfor den
filen. Nøkkelen i migrasjonsfilen bør fjernes i en **fremtidig** migrasjon som
ikke skriver om historikken — ikke i denne PR-en.

`docs/ARKITEKTUR.md` §2 tegner fortsatt Vercel Cron som inngangen. Det er
utdatert. Gjeldende inngang er pg_cron, som over.

Verifiser ved merge, ikke stol på datoen over:

```sql
select jobname, schedule, active
from cron.job
where jobname = 'hent-saker-daglig';
```

Forvent `active = true` og `0 6 * * *`. Ikke merge hvis jobben er borte eller
inaktiv — da stopper nattlig innhenting, fordi Vercel-reserven er fjernet.

## d) Gating

Budsjett og klartekst er gated server-side i live (deployet `_shared/tilgang.ts`).
Repoet har ikke den modulen. Denne PR-en endrer ikke gating, pris, kvoter eller
nyhetsbrevets tilgangslogikk. Live forblir gated så lenge funksjonene ikke
deployes fra en branch uten `tilgang.ts`.
