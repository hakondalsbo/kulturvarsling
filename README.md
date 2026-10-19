# Kulturvarsling.no

> Aldri mer gå glipp av en kulturpolitisk avgjørelse.

Kulturvarsling overvåker Stortinget, regjeringen, fylkeskommunene og kommunene automatisk,
filtrerer fram sakene som angår kulturfeltet, og varsler kulturaktører i tide til å si ifra.
En demokrati-plattform, ikke et datasalg-produkt.

- **Live:** [www.kulturvarsling.no](https://www.kulturvarsling.no) (selve appen under `/app`)
- **Språk:** norsk bokmål
- **Status:** i produksjon. `main` auto-deployer til Vercel; innhentingen kjører automatisk hver natt.

## Grunnprinsipp: demokrati er gratis

All informasjon om saker, retten til å **følge med, forstå, delta og mobilisere** er gratis og
skal aldri ha betalingsmur – inkludert geografisk filtrering («min kommune») og grunnleggende
klartekst-forklaring. **Premium** er profesjonelle *fagverktøy* som sparer tid (budsjettolkning,
utkast til høringssvar, eksport), ikke tilgang til demokratisk informasjon.

Tommelfingerregel: betaler man for å **vite eller delta** → gratis. Betaler man for et **verktøy
som gjør en jobb for deg** → premium.

Arbeidsregler for videre utvikling ligger i [AGENTS.md](AGENTS.md); faktagrunnlag og norske
forhold i [docs/FAKTAGRUNNLAG-OG-NORGE.md](docs/FAKTAGRUNNLAG-OG-NORGE.md).

## Teknisk stack

| Lag | Teknologi |
|---|---|
| Frontend | React 19 + TypeScript + Vite 8, deployet på **Vercel** |
| Backend / database | **Supabase** (Postgres + Auth + Edge Functions, Deno) |
| KI | Anthropic Claude API (Haiku til relevansfiltrering, Sonnet til tolkning/analyse) |
| Betaling | Stripe (abonnement), webhook styrer `plan` på serveren |
| Automatikk | `pg_cron` + `pg_net` i Supabase (nattlig innhenting) |

Supabase-prosjekt: `zyyijlvmgoanjdzngmon`.

## Hvordan det virker

### Innhentingsmotoren (kjører hver natt, uten KI-agent)

```
pg_cron (06:00 UTC) → Edge Function «hent-saker»
   → adaptere henter fra kildene (parallelt, feilisolert per kilde)
   → nøkkelordfilter (gratis) → Claude Haiku: «kulturrelevant?» (øre)
   → dedup mot varsler-tabellen → lagre, og logg kjøring per kilde
```

Adaptere (`supabase/functions/hent-saker/`): Stortinget (saker + høringsfrister + ventede saker),
regjeringen (RSS fra alle departement + spillemidler), eInnsyn (kommuner/fylker nasjonalt, med
geo-tagging via Brønnøysund), Bergen (eget API), Kulturdirektoratet (tildelinger) og Sametinget.
Ren, testbar logikk ligger i `logikk.ts`; hver kjøring logges i `kilde_kjoringer` slik at en død
kilde aldri blir usynlig («stillhet er ikke suksess»).

Full kildeoversikt: [docs/KILDEKART.md](docs/KILDEKART.md). Arkitektur:
[docs/ARKITEKTUR.md](docs/ARKITEKTUR.md).

### Appen

En SPA der hoveddelen bor i `src/App.tsx`, med logikk skilt ut i rene, testbare moduler
(`navigasjon`, `saksvisning`, `prioritering`, `innspill`, `kildehelse`, `kulturhistorie`,
`useDialog`). Hovedflater: personalisert forside («dette angår deg i ditt fylke»), varselliste
med filtrering, saksdetalj med klartekst-forklaring, mobiliser/høringssvar-verktøy, kampanjer,
historikk/arkiv, kildehelse-side og premium-fagverktøy.

## Funksjoner

**Gratis (demokratisk kjerne):** alle saker nasjonalt/fylke/kommune · geografisk filtrering ·
følge saker · klartekst «hva betyr dette for deg» · kampanjer og mobilisering · ukentlig
nyhetsbrev · frister · åpen kildehelse-side.

**Premium (fagverktøy):** budsjettolkning via SSB KOSTRA/COFOG – kommune, fylke og nasjonalt, som
jakter *skjulte kutt* (totalen stiger mens bibliotek/kulturskole kuttes) · KI-utkast til
høringssvar · historiske trender og eksport. Prismodell i [docs/VEIKART.md](docs/VEIKART.md).

> KI-tolkning, kildeopplysninger og eksempeldata holdes synlig atskilt. Vi lover ikke komplett
> kildedekning eller juridisk etterlevelse – se AGENTS.md.

## Prosjektstruktur

```
src/                     Frontend (App.tsx + rene moduler + .css)
supabase/functions/      Edge Functions (Deno):
  hent-saker/            innhentingsmotoren + adaptere + logikk.ts
  klartekst/             «hva betyr dette for deg» (Claude, cachet)
  budsjett/              budsjettverktøy (SSB KOSTRA/COFOG, premium)
  nyhetsbrev/            ukentlig KI-skrevet nyhetsbrev (Resend)
  stripe-checkout/       premium-betaling (Checkout Session)
  stripe-webhook/        setter plan=premium på serveren
  _shared/               claude.ts (KI-kall), tilgang.ts (auth)
supabase/migrations/     Postgres-skjema + RLS + sikkerhetsherding
tests/                   Node-tester for logikk, flyt og sikkerhet
docs/                    ARKITEKTUR, KILDEKART, VEIKART, FORSLAG,
                         FAKTAGRUNNLAG-OG-NORGE, STRIPE-OPPSETT,
                         teknisk-baseline.md
```

## Utvikling

```bash
npm install
npm run dev        # lokal utviklingsserver (Vite)
npm test           # enhetstester (Node --test): edge-logikk + tests/
npm run lint       # ESLint, null advarsler tillatt
npm run build      # tsc -b + vite build
```

Appen laster `@supabase/supabase-js` via esm.sh i `App.tsx`. Supabase anon-nøkkel er offentlig av
design (ligger i frontend). Hemmeligheter (`ANTHROPIC_API_KEY`, `STRIPE_*`, `RESEND_API_KEY`)
settes som Supabase function secrets – aldri i koden.

## Deploy

- **Frontend:** push til `main` → Vercel bygger og publiserer automatisk.
- **Edge Functions:** `supabase functions deploy <navn>` (krever `supabase login` + `supabase link`).
- **Database:** migrasjoner i `supabase/migrations/`. Nye migrasjoner verifiseres i isolert
  database før produksjon (mange kjøres manuelt i SQL-editoren pga. nettverk mot poolern).
- **Stripe:** oppsett i [docs/STRIPE-OPPSETT.md](docs/STRIPE-OPPSETT.md).

## Drift – viktig å vite

- **Nattlig innhenting:** `pg_cron`-jobben `hent-saker-daglig` kjører 06:00 UTC. Et kostnadstak
  begrenser antall KI-vurderte saker per kjøring; etterslep tømmes over flere netter.
- **Gratisnivå pauser:** Supabase-gratisprosjekter pauser etter ~1 ukes inaktivitet. Da viser
  appen 0 saker og cronen stopper – **ingen data tapes**, men prosjektet må gjenopptas fra
  Supabase-dashbordet. Varig løsning for en levende tjeneste er Supabase Pro.
- **Kjøringslogg:** `kilder` + `kilde_kjoringer` viser status per kilde (se kildehelse-siden i
  appen). Statussettet og cron-oppsettet står i [docs/teknisk-baseline.md](docs/teknisk-baseline.md).

## Dokumentasjon

| Dokument | Innhold |
|---|---|
| [docs/ARKITEKTUR.md](docs/ARKITEKTUR.md) | Dataflyt, adapter-per-plattform, databaseskjema, faser |
| [docs/KILDEKART.md](docs/KILDEKART.md) | Alle kartlagte datakilder med verifiseringsstatus |
| [docs/VEIKART.md](docs/VEIKART.md) | Veikart til komplett versjon + prismodell |
| [docs/FAKTAGRUNNLAG-OG-NORGE.md](docs/FAKTAGRUNNLAG-OG-NORGE.md) | Faktakrav, personvern, norske forhold |
| [docs/STRIPE-OPPSETT.md](docs/STRIPE-OPPSETT.md) | Premium-betaling steg for steg |
| [docs/FORSLAG.md](docs/FORSLAG.md) | Prioriterte funksjonsforslag |
| [docs/teknisk-baseline.md](docs/teknisk-baseline.md) | Skjema som mangler i repoet, live-funksjoner, cron |
| [AGENTS.md](AGENTS.md) | Arbeidsregler for videre utvikling |
