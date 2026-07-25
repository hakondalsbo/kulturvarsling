# Stripe-oppsett for Kulturvarsling Premium (E5)

Dette gjør DU i nettleseren på stripe.com — det tar ca. 15 minutter.
Ingen koding. Koden i appen er allerede klar og finner prisene dine automatisk,
så lenge beløpene stemmer nøyaktig (99 kr og 790 kr).

> **Viktig om nøkler:** Du kommer til å kopiere to hemmelige nøkler fra Stripe.
> De skal **aldri** limes inn i en chat, e-post eller et dokument — bare rett
> inn i terminalkommandoene i del E.

---

## Del A — Opprett Stripe-konto (hopp over hvis du har en)

1. Gå til <https://stripe.com> → **Start now / Kom i gang**.
2. Registrer deg med e-post og passord. Velg **Norge** som land.
3. Du lander i **testmodus** (Stripe kaller det også «Sandbox») — perfekt.
   Alt kan bygges og testes her med lekepenger. Å aktivere ekte betalinger
   (krever organisasjonsnummer og bankkonto) kan vente til alt virker.

## Del B — Opprett produktet og de to prisene (i testmodus)

1. Sjekk at bryteren **«Test mode» / «Sandbox»** oppe til høyre er **PÅ**
   (oransje).
2. Gå til **Product catalogue** (Produktkatalog) i menyen til venstre →
   **+ Add product** (Legg til produkt).
3. Fyll inn:
   - **Name:** `Kulturvarsling Premium`
   - **Description** (valgfritt): `Geografisk filter, klartekst-forklaringer, fristkalender og mer.`
4. Under pris:
   - **Amount:** `99,00` — **Currency:** `NOK`
   - Velg **Recurring** (Gjentakende) og **Monthly** (Månedlig)
   - Klikk **Add product** / **Save**.
5. Åpne produktet du nettopp lagde → **+ Add another price** (Legg til ny pris):
   - **Amount:** `790,00` — **Currency:** `NOK`
   - **Recurring** (Gjentakende) og **Yearly** (Årlig)
   - Lagre.

✅ **Sjekkpunkt:** Produktet «Kulturvarsling Premium» har nå to priser:
**99,00 kr/måned** og **790,00 kr/år**. Beløpene MÅ være nøyaktig disse —
appen finner prisene på beløp og intervall.

*(Organisasjonsplanen på 2 990 kr/år venter vi med — den selges manuelt i
første omgang.)*

## Del C — Hent den hemmelige API-nøkkelen

1. Klikk **Developers** (Utviklere) nederst til venstre → **API keys**.
2. Finn **Secret key** (starter med `sk_test_`).
3. Klikk **Reveal key** og kopier den. Denne brukes i del E.

## Del D — Sett opp webhooken (slik Stripe får sagt fra om betalinger)

1. **Developers** → **Webhooks** → **+ Add endpoint** (Legg til endepunkt).
2. **Endpoint URL** — lim inn nøyaktig denne:
   ```
   https://zyyijlvmgoanjdzngmon.supabase.co/functions/v1/stripe-webhook
   ```
3. Under **Select events** (Velg hendelser), huk av disse to:
   - `checkout.session.completed`
   - `customer.subscription.deleted`
4. Klikk **Add endpoint**.
5. På siden som åpnes: finn **Signing secret** (starter med `whsec_`),
   klikk **Reveal** og kopier den. Brukes i del E.

## Del E — Legg nøklene inn i Supabase (terminal)

Kjør disse to kommandoene i terminalen, én om gangen. Bytt ut
`LIM_INN_HER` med nøklene du kopierte i del C og D — behold `sk_test_`/
`whsec_`-starten som er en del av nøkkelen:

```bash
supabase secrets set --project-ref zyyijlvmgoanjdzngmon STRIPE_SECRET_KEY=sk_test_LIM_INN_HER
```

```bash
supabase secrets set --project-ref zyyijlvmgoanjdzngmon STRIPE_WEBHOOK_SECRET=whsec_LIM_INN_HER
```

## Del F — Test hele løpet

1. Åpne appen → logg inn → klikk **⭐ Premium** → velg plan → **Til sikker
   betaling hos Stripe**.
2. På Stripe-siden, bruk testkortet:
   - Kortnummer: `4242 4242 4242 4242`
   - Utløp: hvilken som helst fremtidig dato (f.eks. `12/34`)
   - CVC: hva som helst (f.eks. `123`)
3. Etter betaling sendes du tilbake til appen — i løpet av noen sekunder
   dukker «⭐ Premium aktivert!» opp, og profilen din viser Premium.
4. Test avmelding: Stripe-dashbordet → **Customers** → velg deg selv →
   **Cancel subscription** → velg **Cancel immediately**. Kontoen i appen skal
   gå tilbake til gratis.

## Når du vil ta imot EKTE penger (senere)

1. Fullfør **Activate payments** i Stripe (org.nr., bankkonto osv.).
2. Skru **AV** testmodus-bryteren og gjenta del B (produkt + to priser),
   del C (nå får du en `sk_live_`-nøkkel) og del D (ny webhook + ny
   `whsec_`-nøkkel) i live-modus.
3. Kjør de to kommandoene i del E på nytt med live-nøklene.

Det er alt — ingen kodeendringer trengs mellom test og live.
