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

### E4 — Dokument-dyplesing 📄
Fra metadata til innhold.
- Last ned saksdokumenter/PDF-er (lenkene har vi), Claude leser og trekker ut:
  budsjett-tall, vedtaksforslag, konsekvenser — mates inn i klartekst-laget (E2)
- Stortingets fulltekst-API (verifisert) først; deretter kommunale PDF-er

### E5 — Premium og betaling 💳
Se prismodellen under. Stripe-abonnement (raskest å bygge, håndterer kort + kvitteringer);
Vipps som betalingsvalg i v2. PremiumModal-en i appen finnes — kobles til ekte betaling
og ekte funksjons-gating (plan-feltet i profiler styrer tilgang).

### E6 — Nyhetsbrevet som eget produkt 📰
Egen merkevare («Kulturvarsleren»?), egen påmeldingsside, åpen arkivside (SEO).
Gratisutgaven er vekstmotoren som driver folk til appen; premium-abonnenter kan få
utvidet utgave (flere saker, geografisk seksjon for DIN region, tallgrunnlag).

---

## Prismodell (forslag)

| | **Gratis** | **Premium 99 kr/mnd** (790/år) | **Organisasjon 2 990 kr/år** |
|---|---|---|---|
| Nasjonale saker + frister | ✅ | ✅ | ✅ |
| Ukentlig nyhetsbrev | ✅ | ✅ utvidet m/regional seksjon | ✅ |
| Følge saker | 5 | Ubegrenset | Ubegrenset |
| **Geografisk filter (din kommune/fylke)** | — | ✅ | ✅ flere geografier |
| **Klartekst «hva betyr dette for deg»** | 3/mnd | Ubegrenset | Ubegrenset |
| Fristkalender (ICS til din kalender) | — | ✅ | ✅ |
| AI-utkast til høringssvar | — | ✅ | ✅ |
| E-postvarsel straks ved kritisk sak | — | ✅ | ✅ |
| Kampanjeverktøy + signaturliste-eksport | — | — | ✅ |
| Flere brukere / API-tilgang | — | — | ✅ |

Logikk: **datainnsamlingen er gratis synlig** (bygger tillit og trafikk) — **forståelsen,
personaliseringen og verktøyene koster** (det er der tidsbesparelsen og verdien ligger).
Organisasjonsnivået er B2B-sporet: NTO, Creo, kulturhusnettverk, kommuner.

---

## Rekkefølge og begrunnelse

**E1 → E2 → E5 → E3 → E4 → E6.** Geografi og klartekst er premium-funksjonene folk vil
betale for — bygg dem, så betalingen (E5), så utvid dekning og dybde (E3/E4) som gjør
abonnementet stadig mer verdt. Nyhetsbrevet (E6) vokser parallelt som egen kanal.
