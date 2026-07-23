# Forslag: smarte funksjoner for hele plattformen

Prioritert etter verdi/innsats. ✦ = mine sterkeste anbefalinger.

## ✦ 1. Geografisk personalisering
Bruker velger kommune + fylke i profilen → ser bare saker som treffer *dem* (nasjonalt + eget
fylke + egen kommune). Datamodellen støtter det allerede (`kommunenr`/`fylkesnr` i ARKITEKTUR.md).
Dette er forskjellen på «nyhetsstrøm» og «varsling som angår meg» — kjerneverdien.

## ✦ 2. Fristkalender med kalender-abonnement (ICS)
Alle høringsfrister som en kalenderfil brukeren abonnerer på i sin egen kalender
(Google/Outlook/Apple). Billig å bygge (ett endepunkt som genererer ICS), stor opplevd verdi:
fristene dukker opp der folk faktisk planlegger.

## ✦ 3. E-postsammendrag (ukentlig/daglig digest)
`profiler.varsel_frekvens` finnes allerede, men ingenting sendes. Med f.eks. Resend
(3 000 gratis e-poster/mnd): «Denne uken: 3 saker som påvirker deg, 1 frist nærmer seg.»
E-post er kanalen kulturfeltet faktisk leser. Uten dette må folk huske å besøke siden.

## ✦ 4. «Hva betyr dette for meg?»-knapp
Klartekst-laget (ARKITEKTUR §5) gjort personlig: bruker trykker på en sak → Claude får sakens
innhold + brukerens org-profil (sjanger, størrelse, fylke) → svarer konkret: «Som friteater i
Vestland betyr kuttet i post 323 trolig …». Dette er visjonen din destillert til én knapp.

## ✦ 5. Budsjettvakt per kommune (KOSTRA-differ)
Årlig automatisk sammenligning av kulturutgifter per kommune (SSB-tall): «Din kommune kutter
12 % i kultur — vedtaket skjer i desember.» Ingen konkurrent gjør dette. Datagrunnlaget er
gratis og strukturert.

## 6. AI-utkast til høringssvar
MalModal-en har statiske maler i dag. Oppgrader: Claude skriver førsteutkast basert på sakens
dokumenter + organisasjonens profil. Tidsbesparelsen er enorm for små aktører uten fagfolk.
(Krever tydelig «dette er et utkast»-etikett.)

## 7. Sakssporing på tvers av faser
En kultursak lever: høring → komité → vedtak → budsjettpost. I dag er hvert dokument en egen
rad. Med en `sak_tråd`-kobling kan vi varsle: «Saken du fulgte i høring er nå vedtatt — dette
ble utfallet.» Følg-funksjonen finnes allerede (`fulgte_saker`) og blir dobbelt så verdifull.

## 8. Kildehelse-side (offentlig tillit + egen drift)
Enkel side som viser `kilde_kjoringer`: hvilke kilder overvåkes, sist hentet, status.
To gevinster: du ser selv når noe er brukket, og brukerne ser at overvåkingen er reell
(«vi følger 372 organ — 371 OK»). Transparens som salgsargument.

## 9. Push-varsler (PWA)
Manifest er allerede på plass. Web push for kritiske frister («3 dager igjen») er neste steg
for engasjement uten app-butikk.

## 10. Åpent API / embed-widget for organisasjonene
Creo, NTO, Norske Kulturhus osv. har medlemssider. En widget/API («siste kultursaker for
scenekunst») gjør Kulturvarsling til infrastruktur — og organisasjonene til distributører.
B2B-inntektsspor.

---

### Teknisk fundament (svar på «er Node/Supabase det beste?»)
Vurdert ærlig: **ja, behold stacken.** React/Vite/Vercel/Supabase er i 2026 blant de mest
anbefalte oppsettene for akkurat denne typen produkt og teamstørrelse. Bytte gir ukers arbeid
og null brukerverdi — flaskehalsen er datakilder og funksjoner, ikke plattformen. De reelle
tekniske forbedringene er interne:
1. **Anthropic Batch API** for natt-klassifiseringen: samme kvalitet, ~50 % lavere AI-kostnad
   (sakene haster ikke minutt-for-minutt om natten).
2. **Claude structured outputs** i stedet for «svar bare med JSON»-prompting: garantert gyldig
   JSON, færre kastede svar.
3. **Chunket innhenting** når kildeantallet vokser: orkestratoren tar N kilder per kjøring
   (styrt av `kilder`-tabellen), aldri alt i én funksjon som kan time'e ut.
4. **Splitt `src/App.tsx`** (3 470 linjer) gradvis + rydd de 527 typefeilene → så kan full
   typesjekk gate produksjon. Egen oppgave er opprettet.
