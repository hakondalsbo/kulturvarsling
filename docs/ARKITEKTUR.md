# Kulturvarsling: Innhentingsmotoren

> Målbilde: **Alt som politisk og økonomisk påvirker kultur-Norge — nasjonalt, fylke og kommune —
> hentes inn automatisk hver dag, filtreres for relevans, oversettes til klartekst og varsles i tide.**

Dette dokumentet beskriver arkitekturen. Konkrete, verifiserte datakilder ligger i [KILDEKART.md](KILDEKART.md).

---

## 1. Fire bærende prinsipper

### 1.1 Adapter per PLATTFORM — aldri per organ
Norge har 357 kommuner og 15 fylkeskommuner, men de kjøper innsynsløsninger fra en håndfull
leverandører (Acos, Elements/Public360, Sikri, Framsikt m.fl.). Vi skriver **én adapter per
plattform**, ikke én per organ. En adapter er en funksjon med signaturen:

```
adapter(kildeConfig) → RåSak[]        // normalisert: tittel, organ, nivå, dokumentlenker, frist, kilde-URL
```

Å legge til kommune nr. 44 på samme plattform = **én ny rad i databasen**, null ny kode.

### 1.2 Kilder er data, ikke kode
Alle kilder ligger i en `kilder`-tabell i Supabase (se §3). Innhentingsmotoren leser tabellen og
kjører riktig adapter per rad. Dermed kan kilder skrus av/på, prioriteres og feilsøkes uten deploy.

### 1.3 AI i to lag — billig først, dyrt sist
- **Lag 1 — Relevansfilter (Haiku, billig):** «Er denne saken relevant for kulturfeltet?»
  Kjøres på alt som passerer nøkkelordfilteret. Dette har vi allerede i `hent-saker`.
- **Lag 2 — Klartekst (større modell, kun på relevante saker):** «Hva betyr dette konkret
  for en kulturaktør i {kommune}?» — oversetter budsjettposter, vedtak og forvaltningsspråk
  til forståelig norsk, med hvem-påvirkes, beløp, frist og handlingsalternativ.

Nøkkelordfilter (gratis) → Haiku (øre) → stor modell (kroner, men bare på det som teller).

### 1.4 Overvåket drift — stillhet er ikke suksess
Hver kjøring per kilde logges i `kilde_kjoringer`. En kilde som feiler tre dager på rad flagges.
Offentlige nettsider endrer seg uten varsel; motoren må *vite* når den er blind, ikke anta at
null treff betyr null nyheter.

---

## 2. Dataflyt

```
                       ┌────────────────────────── KJØRETID (hver natt, uten AI-agent) ─┐
Vercel Cron (06:00 UTC)│                                                                │
   └─► api/cron/hent-saker ─► Edge Function «hent-saker» (orkestrator)                  │
            │                        │                                                  │
            │            leser `kilder` (aktiv=true)                                    │
            │                        │                                                  │
            │        ┌── adapter: stortinget-api ──┐                                    │
            │        ├── adapter: regjeringen-rss ─┤                                    │
            │        ├── adapter: einnsyn ─────────┤──► normaliserte RåSaker            │
            │        ├── adapter: acos ────────────┤          │                         │
            │        ├── adapter: elements-360 ────┤     dedup mot `varsler`            │
            │        ├── adapter: framsikt ────────┤          │                         │
            │        └── adapter: kostra-ssb ──────┘     nøkkelordfilter                │
            │                                                 │                         │
            │                                        Claude lag 1: relevans?            │
            │                                                 │ ja                      │
            │                                        Claude lag 2: klartekst            │
            │                                                 │                         │
            │                                        insert i `varsler`                 │
            │                                        logg i `kilde_kjoringer`           │
            └───────────────────────────────────────────────────────────────────────────┘

                       ┌────────────────────────── BYGGETID / DRIFT (Claude Code) ──────┐
                       │ • Multi-agent kildekartlegging (gjort: se KILDEKART.md)        │
                       │ • Skrive/teste nye adaptere med underagenter i parallell       │
                       │ • Ukentlig helsesjekk: lese kilde_kjoringer, fikse brukne      │
                       │   kilder, foreslå nye                                          │
                       │ • Dypanalyse av budsjett-PDF-er som pipeline flagger           │
                       └────────────────────────────────────────────────────────────────┘
```

Skillet er bevisst: **produksjonspipelinen er deterministisk og billig** (vanlig kode + to små
AI-kall per sak). **Agentene** brukes der skjønn og bygging trengs — ikke som nattlig cron.

---

## 3. Databaseskjema (nytt/utvidet)

```sql
-- Kilderegisteret: én rad per organ+kildetype
create table kilder (
  id            uuid primary key default gen_random_uuid(),
  navn          text not null,              -- «Bergen kommune – politisk møtekalender»
  niva          text not null check (niva in ('nasjonalt','fylke','kommune')),
  organ         text not null,              -- «Bergen kommune»
  kommunenr     text,                       -- SSB-kode, muliggjør geografisk filtrering
  fylkesnr      text,
  adapter       text not null,              -- «acos» | «elements-360» | «stortinget-api» | ...
  config        jsonb not null default '{}',-- adapterspesifikt: base-URL, utvalgs-ID-er, feed-URL
  aktiv         boolean default true,
  prioritet     int default 3,              -- 1 = hentes alltid først
  sist_hentet   timestamptz,
  sist_status   text                        -- «ok» | «feil: …» | «tom»
);

-- Kjøringslogg: gjør drift observerbar
create table kilde_kjoringer (
  id            bigint generated always as identity primary key,
  kilde_id      uuid references kilder(id),
  kjort         timestamptz default now(),
  status        text not null,              -- «ok» | «feil»
  antall_funnet int,
  antall_nye    int,
  feilmelding   text,
  varighet_ms   int
);

-- Utvidelser av eksisterende varsler-tabell
alter table varsler add column if not exists kilde_id   uuid references kilder(id);
alter table varsler add column if not exists kommunenr  text;
alter table varsler add column if not exists fylkesnr   text;
alter table varsler add column if not exists klartekst  text;  -- lag 2-output: «hva betyr dette for deg»
alter table varsler add column if not exists sakstype   text;  -- «høring» | «vedtak» | «budsjett» | «tildeling» | «plan»
```

`kommunenr`/`fylkesnr` er det som senere lar dashbordet si: *«vis meg alt som påvirker
kulturlivet i Trondheim»* — geografisk filtrering er innebygd fra dag én.

---

## 4. Adaptere

| Adapter | Dekker | Status |
|---|---|---|
| `stortinget-api` | Høringer, saker, komitéarbeid nasjonalt | ✅ i drift (i hent-saker) |
| `regjeringen-rss` | KUD + tema-feeds | ✅ i drift (i hent-saker) |
| *(resten fylles fra KILDEKART.md når verifiseringen er ferdig)* | | ⏳ |

Hver ny adapter følger samme mal: egen fil i `supabase/functions/hent-saker/adaptere/`,
ren funksjon, testbar isolert, feil i én adapter velter aldri de andre (feilisolasjon per kilde).

---

## 5. AI-lagene i detalj

### Lag 1: Relevansfilter
Dagens prompt i `hent-saker` videreføres, men flyttes til delt modul så samme definisjon av
«kulturrelevant» brukes overalt. Utvides med nivå-kontekst (en kommunal sak vurderes annerledes
enn en nasjonal).

### Lag 2: Klartekst — kjernen i visjonen
Input: sak + evt. dokumentutdrag (budsjett-PDF, saksfremlegg).
Output (strukturert):
- **Hva skjer:** én setning uten forvaltningsspråk
- **Hvem påvirkes:** fagfelt + geografi
- **Tall:** beløp, endring fra i fjor (for budsjettsaker)
- **Frist:** når må man reagere
- **Hva kan du gjøre:** høringssvar / kontakt utvalg / mobiliser

### Budsjett-differ (egen jobb, sjeldnere frekvens)
KOSTRA/SSB-tall per kommune år-over-år → automatisk generert varsel ved kutt over terskel:
*«Kommune X reduserer netto driftsutgifter til kultur med 12 %»*. Kjøres når SSB publiserer,
ikke daglig.

---

## 6. Utrullingsfaser

1. **Fase 1 — Nasjonalt komplett:** flere nasjonale kilder inn i eksisterende pipeline
   (statsbudsjett, Kulturdirektoratet-tildelinger, alle dep.-høringer). Kilderegister + logging etableres.
2. **Fase 2 — Fylkeskommunene:** 15 organ, 3–4 plattformer. Første plattform-adaptere skrives.
3. **Fase 3 — Storbyene:** Oslo, Bergen, Trondheim, Stavanger, Tromsø, Kristiansand — dekker
   en stor andel av kulturfeltet med få nye adaptere.
4. **Fase 4 — Alle kommuner:** resten rulles ut som *data* (rader i `kilder`), plattform for
   plattform. Underagenter genererer og verifiserer config per kommune i parallell.
5. **Kontinuerlig:** ukentlig helsesjekk-rutine + kildekart-oppdatering.

---

## 7. Hvordan Claude Code brukes i bygging og drift

| Oppgave | Verktøy |
|---|---|
| Kartlegge kilder bredt | Multi-agent workflow (fan-out + skeptisk verifisering) — gjort 23.07.2026 |
| Skrive N adaptere parallelt | Underagenter, én per adapter, felles normalformat |
| Generere kilde-config for 357 kommuner | Workflow: oppslag → config → verifiser med ekte kall |
| Ukentlig helsesjekk | Planlagt rutine: les `kilde_kjoringer`, feilsøk, rapporter |
| Dyp dokumentanalyse (budsjett-PDF) | Agent med PDF-lesing, on-demand |
```
