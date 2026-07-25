# Veikart til komplett versjon (V1.0)

> **V1.0-definisjonen:** En kulturaktør hvor som helst i Norge kan (1) følge alt som politisk
> påvirker feltet sitt — kommune, fylke og stat, (2) filtrere til sitt eget fagfelt og sted,
> (3) *forstå* hver sak i klartekst, (4) reagere i tide (frister, kampanjer, høringssvar),
> og (5) betale for verktøyene som gir dyp verdi. Nyhetsbrevet er egen vekstmotor.

Status i dag: motor + AI-filter + historikk + kampanjerigg + nyhetsbrev er i drift.
Det som gjenstår er etappene under — i anbefalt rekkefølge.

---

## Etappene

### E1 — Geografi: «vis meg det som angår MEG» 🎯
Kjerneopplevelsen som gjør varsling personlig.
- Adapterne fyller `kommunenr`/`fylkesnr` (eInnsyn: journalenhet → orgnr → kommunenr;
  Stortinget/Regjeringen: nasjonalt)
- Profilen spør «hvilken kommune holder du til i?» (+ valgfritt flere)
- Varsellisten og forsiden filtrerer: nasjonalt + mitt fylke + min kommune
- **Premium-kobling:** gratis = nasjonalt; geografisk filtrering = betalt

### E2 — Klartekst: «hva betyr dette for deg?» 💬
Visjonens kjerne — forvaltningsspråk → menneskespråk.
- Knapp på hver sak: Claude får saken + brukerens profil (fagfelt, sted, org-type)
  → «Som friteater i Vestland betyr dette …» med hvem-påvirkes, beløp, frist, handlingsvalg
- Caches per sak+profiltype så kostnad holdes nede
- **Premium-kobling:** 3 gratis per måned, ubegrenset for betalende

### E3 — Full kildedekning: adapterpakke 2 📡
Fra «mange kommuner» til «alle de store + pengestrømmene».
- Bergen (eget API, fulltekstsøk), Digdem (Trondheim/Tromsø/Hamar), FirstAgenda (Kristiansand)
- Kulturdirektoratets vedtaksdatabase (CSV — hvem får penger)
- Spillemidlene (statsråd-RSS + Lottstift) og Sametinget (RSS med tildelingslister)
- KOSTRA-budsjettvakt: «din kommune kutter X % i kultur» (årlig, automatisk)
- Alt er ferdig kartlagt og verifisert i [KILDEKART.md](KILDEKART.md)

### E4 — Budsjettverktøy + dokument-dyplesing 📄
**Del 1 — Budsjettverktøy (✅ BYGGET):** Premium-fagverktøyet «tolke budsjett». Edge Function
`budsjett` henter kommunens kulturøkonomi fra SSB KOSTRA (tabell 13135 — kr/innbygger, andel av
kommunebudsjett, bibliotek, kulturskole, 2021–2025), sammenligner med landssnittet, og Claude
tolker tallene i klartekst med et konkret spørsmål til lokalpolitikerne. Kommune-velger med alle
358 kommuner. I appen: Premium → 📊 Kulturbudsjett.

**Del 2 — Dokument-dyplesing (gjenstår):** Last ned saksdokumenter/PDF-er (lenkene har vi),
Claude leser og trekker ut vedtaksforslag/konsekvenser → mates inn i klartekst-laget (E2).
Stortingets fulltekst-API (verifisert) først; deretter kommunale PDF-er.

### E5 — Premium og betaling 💳
Se prismodellen under. Stripe-abonnement (raskest å bygge, håndterer kort + kvitteringer);
Vipps som betalingsvalg i v2. PremiumModal-en i appen finnes — kobles til ekte betaling
og ekte funksjons-gating (plan-feltet i profiler styrer tilgang).

### E6 — Nyhetsbrevet som eget produkt 📰
Egen merkevare («Kulturvarsleren»?), egen påmeldingsside, åpen arkivside (SEO).
Gratisutgaven er vekstmotoren som driver folk til appen; premium-abonnenter kan få
utvidet utgave (flere saker, geografisk seksjon for DIN region, tallgrunnlag).

---

## Prismodell — GRUNNPRINSIPP: demokrati er gratis

> **Kulturvarsling er en demokrati-plattform.** All informasjon om saker, retten til å følge
> med, forstå, delta og mobilisere er GRATIS og skal aldri ha betalingsmur. Man betaler ikke
> for å vite hva politikerne bestemmer om kulturen sin. Premium er **fagverktøy** som gjør en
> jobb for deg — ikke tilgang til det demokratiske.

| | **Gratis (demokratisk kjerne)** | **Premium 99 kr/mnd** (fagverktøy) | **Organisasjon 2 990 kr/år** |
|---|---|---|---|
| Alle saker (nasjonalt/fylke/kommune) | ✅ | ✅ | ✅ |
| **Geografisk filter (mitt fylke/kommune)** | ✅ | ✅ | ✅ |
| Følge saker | ✅ ubegrenset | ✅ | ✅ |
| **Klartekst «hva betyr dette for deg»** | ✅ | ✅ | ✅ |
| Kampanjer + mobilisering + delta i høring | ✅ | ✅ | ✅ |
| Ukentlig nyhetsbrev | ✅ | ✅ utvidet m/regional seksjon | ✅ |
| **Budsjettolkning / KOSTRA-sammenligning** («din kommune vs nabo», utvikling over tid) | — | ✅ | ✅ |
| **AI-utkast til profesjonelt høringssvar** | — | ✅ | ✅ |
| Historiske trender, statistikk, dataeksport | — | ✅ | ✅ |
| Fristkalender (ICS til din kalender) | — | ✅ | ✅ |
| E-postvarsel straks ved kritisk sak | — | ✅ | ✅ |
| Organisasjonsverktøy: flere brukere, API, signaturliste-eksport, egen merkevare | — | — | ✅ |

Tommelfingerregel: **Betaler man for å VITE eller DELTA? → gratis. Betaler man for et VERKTØY
som gjør en jobb for deg (tolke tall, skrive utkast, eksportere, integrere)? → premium.**
Organisasjonsnivået er B2B-sporet: NTO, Creo, kulturhusnettverk, kommuner. E5s Stripe-mur er
bygget — den gjenbrukes på fagverktøyene (E4-budsjett m.m.), ikke på informasjon/geografi/klartekst.

---

## Rekkefølge og begrunnelse

**E1 → E2 → E5 → E3 → E4 → E6.** Geografi og klartekst er premium-funksjonene folk vil
betale for — bygg dem, så betalingen (E5), så utvid dekning og dybde (E3/E4) som gjør
abonnementet stadig mer verdt. Nyhetsbrevet (E6) vokser parallelt som egen kanal.
