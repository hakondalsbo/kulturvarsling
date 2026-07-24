# Kildekart for innhentingsmotoren

Generert 23.–24. juli 2026 av multi-agent-kartlegging (12 områder, ekte endpoint-testing med
curl, uavhengig skeptisk re-verifisering). Rådata med testresultater, feltstrukturer og
integrasjonsnotater per kilde: [kildekart-data.json](kildekart-data.json).
Arkitekturen kildene plugges inn i: [ARKITEKTUR.md](ARKITEKTUR.md).

**Status:** 120 kilder · 32 uavhengig verifisert ✅ · 83 testet av kildejeger 🟡 (endelig verifisering skjer når adapteren bygges) · 1 bekreftet nede ❌ · 4 utestet ⚪. Kartleggingen er FULLFØRT 24.07.2026 (tre kjøringer, 111 agenter).

---

## 🚨 Kritiske funn — påvirker produksjonen NÅ

1. **Høringshentingen i `hent-saker` er død.** Endepunktet pipelinen kaller i dag,
   `eksport/horingsoversikt`, **finnes ikke** (HTTP 404 — verifisert gjentatte ganger).
   Koden svelger feilen stille (`continue` ved !res.ok), så kjøringene ser vellykkede ut
   men henter null høringer fra Stortinget. Dette er nøyaktig feilklassen
   ARKITEKTUR.md §1.4 («stillhet er ikke suksess») skal fange — nå har vi beviset.

2. **Det dokumenterte alternativet er også nede.** `eksport/horinger` (offisielt dokumentert,
   med anmodningsfrister) gir HTTP 500 på alle sesjoner — til og med dokumentasjonens eget
   eksempel feiler. Serverside-feil hos Stortinget. → Legg inn overvåking som varsler når
   endepunktet svarer 200 igjen, og ta det i bruk da.

3. **Fungerende erstatning finnes — verifisert:** `eksport/sak?sakid=X` gir full saksgang
   per sak med daterte hendelser, inkludert **HOERFRIST** (komiteens høringsfrister),
   høringsdatoer, innstilling, votering og vedtakstekst. Strategi: hent `eksport/saker`
   daglig, følg `sist_oppdatert_dato` for delta, slå opp detaljer for endrede kultursaker.

4. **Komité-filteret i `eksport/saker` ignoreres av serveren.** `?komite=FaKu` og
   `?komiteid=FAMKULT` gir identisk resultat som uten filter (650 saker, byte-likt innhold).
   Dagens pipeline *tror* den filtrerer. → Filtrer klientside på `komite.id === "FAMKULT"`
   og/eller `emne_liste` med hovedemne id 6 (Kultur).

5. **Tidligvarsling er mulig:** `eksport/ventedesaker` lister regjeringens *varslede* kommende
   proposisjoner med departement og måned (verifisert — inneholder bl.a. kommende
   åndsverkslov-endringer fra KUD). Vi kan varsle kulturfeltet **før** saker fremmes.

## Konsekvens: tiltak i hent-saker (Fase 1)

- [ ] Erstatt `hentStortingetHøringer()` (404-endepunktet) med saker-delta + `eksport/sak`-oppslag
- [ ] Flytt komité/emne-filtrering til klientside
- [ ] Ny kilde: `eksport/ventedesaker` (tidligvarsling)
- [ ] Regjeringen.no: bytt fra 3 hardkodede KUD-feeds til RSS-generatoren som dekker
      høringer/NOU/meldinger/proposisjoner fra ALLE departement (verifisert)
- [ ] Ny kilde: Kulturdirektoratets vedtaksdatabase (CSV — hvem får penger, verifisert)
- [ ] `kilde_kjoringer`-logging (ARKITEKTUR §3) så en død kilde aldri mer er usynlig
- [ ] Overvåk `eksport/horinger` — bytt inn når Stortinget fikser den

## Kommuneplattformene — nøkkelen «én integrasjon → mange kommuner» (fullført 24.07)

| Storby | Plattform | Status |
|---|---|---|
| Bergen | Eget JSON REST-API (BK360 bak) — **fulltekstsøk på «kultur»: 6 911 treff** | ✅ verifisert, åpent |
| Trondheim | Digdem (Sikri Elements, multi-tenant GraphQL) | 🟡 fungerer uautentisert |
| Stavanger | **eInnsyn** (nasjonalt API — forlot OpenGov 2023) | ✅ verifisert, åpent |
| Tromsø | Digdem (som Trondheim — samme integrasjon) | 🟡 |
| Kristiansand | FirstAgenda Publication | 🟡 |

**Anbefalt integrasjonsrekkefølge:** eInnsyn (nasjonal dekning i ett API — åpent for lesing uten nøkkel, i strid med egen dokumentasjon) → Digdem (Trondheim/Tromsø/Hamar +flere) → Bergen (rikest API) → FirstAgenda → Acos Innsyn Pluss. OpenGov 360online er i utfasing (500 for alle storbyer) — nedprioritert.

⚠️ **Verifikator-korreksjon for eInnsyn:** datofilteret \`moetedatoAfter\` ignoreres STILLE av API-et — riktige parametre er \`moetedatoFrom\`/\`moetedatoTo\` (verifisert korrekt filtrering). Enda et eksempel på at stille feil er verre enn høylytte.

**Hull funnet og tettet av kritikeren:** (1) **Spillemidlene** — Norsk Tippings overskudd, hovedfordelingen fanges via «Offisielt fra statsråd»-RSS + tilskudd.no/Lottstift (verifisert); (2) **Sametinget** — nyhets-RSS med ukentlige tildelingslister (verifisert) + møte-API for plenum/komiteer.

---
## Kildetabell

Status: ✅ = uavhengig verifisert · ❌ = verifisert IKKE fungerende nå · 🟡 = testet av kildejeger, endelig verifisering ved adapterbygging · ⚪ = ikke testet

| Kilde | Nivå | Tilgang | Pri | Status | Endpoint |
|---|---|---|---|---|---|
| Stortinget: Saker per sesjon (eksport/saker) | nasjonalt | api | 1 | ✅ bekreftet | `https://data.stortinget.no/eksport/saker?sesjonid=2025-2026&format=json` |
| Stortinget: Sak-detalj med saksgang og høringsfrister (eksport/sak) | nasjonalt | api | 1 | ✅ bekreftet | `https://data.stortinget.no/eksport/sak?sakid=104907&format=json` |
| Stortinget: Komitehøringer (eksport/horinger) — NEDE | nasjonalt | api | 1 | ❌ avkreftet/nede | `https://data.stortinget.no/eksport/horinger?sesjonid=2025-2026&format=json` |
| Regjeringen.no RSS-generator — høringer fra ALLE departement | nasjonalt | rss | 1 | ✅ bekreftet | `https://www.regjeringen.no/no/rss/Rss/2581966/?documentType=dokumenter/h%C3%B8ringer` |
| Regjeringen.no dokumentlisting (HTML) — høringer MED frist og status | nasjonalt | skraping | 1 | ✅ bekreftet | `https://www.regjeringen.no/no/dokument/id2000006/?documenttype=dokumenter/h%C3%B8ringer&so` |
| Kulturdirektoratet – vedtaksdatabase (CSV-eksport) | nasjonalt | skraping | 1 | ✅ bekreftet | `https://www.kulturdirektoratet.no/actions/download-determination-csv/determination-downloa` |
| Kulturdirektoratet – tilskuddsordninger med søknadsfrister | nasjonalt | skraping | 1 | ✅ bekreftet | `https://www.kulturdirektoratet.no/tilskuddsordninger` |
| Regjeringen.no – Gul bok datagrunnlag (Statsbudsjettet per kapittel/post) | nasjonalt | dataset | 1 | ✅ bekreftet | `https://www.regjeringen.no/contentassets/bad238c9c4d94a639dbc8104fce42e1c/2026_gulbok_data` |
| eInnsyn søke-API (/search) — fulltekstsøk på tvers av alle organ | tverrgaende | api | 1 | 🟡 testet | `https://api.einnsyn.no/search?query=kultur&entity=Moetesak&sortBy=publisertDato&sortOrder=` |
| eInnsyn kommende politiske møter (Moetemappe/Moetesak med moetedatoFrom) | tverrgaende | api | 1 | 🟡 testet | `https://api.einnsyn.no/search?query=kultur&entity=Moetemappe&moetedatoFrom=2026-07-23&sort` |
| Sikri Elements Publikum — udokumentert åpent JSON-API (møteplan) | kommune | api | 1 | 🟡 testet | `https://prod01.elementscloud.no/publikum/api/PredefinedQuery/DmbMeetings?DateFrom=2026-08-` |
| eInnsyn API (Digdir) - nasjonalt aggregat for politiske møter | tverrgaende | api | 1 | 🟡 testet | `https://api.einnsyn.no/search?entity=Moetemappe&administrativEnhet={enh_id}&sortBy=moeteda` |
| Oslo kommune - Kultur- og utdanningsutvalget (KOUV) via eInnsyn | fylke | api | 1 | 🟡 testet | `https://api.einnsyn.no/search?administrativEnhet=enh_01j73r5z2ff3wt0e76tve0zh8b&entity=Moe` |
| Akershus fylkeskommune - Komité for kultur, mangfold, næring og tannhelse via eInnsyn | fylke | api | 1 | 🟡 testet | `https://api.einnsyn.no/search?administrativEnhet=enh_01j73r5z25fp9rt9fa8kankap6&entity=Moe` |
| Østfold fylkeskommune - Hovedutvalg for folkehelse, kultur og mangfold via eInnsyn | fylke | api | 1 | 🟡 testet | `https://api.einnsyn.no/search?administrativEnhet=enh_01j73r5z26ecjahsmxvysw5c6m&entity=Moe` |
| Buskerud fylkeskommune - Hovedutvalg for kultur, idrett og folkehelse via eInnsyn | fylke | api | 1 | 🟡 testet | `https://api.einnsyn.no/search?administrativEnhet=enh_01j73r5z1devka8mj0yd4rtyy5&entity=Moe` |
| Innlandet fylkeskommune - Elements Publikum API (Sikri) - Hovedutvalg for kultur | fylke | api | 1 | 🟡 testet | `https://prod01.elementscloud.no/publikum/api/PredefinedQuery/DmbMeetings?year=2026` |
| eInnsyn søke-API (frontend) – Agder fylkeskommune | fylke | api | 1 | 🟡 testet | `https://einnsyn.no/api/result` |
| Møre og Romsdal fylkeskommune – Acos Innsyn JSON-API (møtekalender og møtedetaljer) | fylke | api | 1 | 🟡 testet | `https://mrfylke.no/api/presentation/v2/nye-innsyn/overviewInit` |
| Trøndelag fylkeskommune – OpenGov 360online (møtekalender og saksdokumenter) | fylke | skraping | 1 | 🟡 testet | `https://opengov.360online.com/Meetings/TRONDELAG` |
| Nordland fylkeskommune – Acos Innsyn JSON-API (møtekalender) | fylke | api | 1 | 🟡 testet | `https://www.nfk.no/api/presentation/v2/nye-innsyn/overviewInit` |
| Troms fylkeskommune – OpenGov 360online (møtekalender og saksdokumenter) | fylke | skraping | 1 | 🟡 testet | `https://opengov.360online.com/Meetings/tromsfylke` |
| Framsikt publiserte budsjett/okonomiplaner — skjult JSON-struktur | tverrgaende | api | 1 | 🟡 testet | `https://pub.framsikt.net/{aar}/{kommune}/{dokument-slug}/content/data/tree.json` |
| eInnsyn API (søk i journalposter og møtesaker) | tverrgaende | api | 1 | 🟡 testet | `https://api.einnsyn.no/search?query=kultur&entity=Moetesak&sortBy=publisertDato&sortOrder=` |
| Kudos (DFØ) — kunnskaps- og styringsdokumenter i offentlig sektor | nasjonalt | api | 1 | 🟡 testet | `https://kudos.dfo.no/api/v0/documents/search?query=kultur&sort=newest` |
| eInnsyn API (nasjonalt aggregat — dekker Stavanger m.fl.) | tverrgaende | api | 1 | ✅ bekreftet | `https://api.einnsyn.no/search?entity=Moetemappe&administrativEnhet={enhetId}&moetedatoAfte` |
| Bergen kommune — politikere-utvalg API (egen løsning, BK360/bksak bak) | kommune | api | 1 | ✅ bekreftet | `https://www.bergen.kommune.no/politikere-utvalg/api/allemoter (+ /api/utvalg?q=, /api/utva` |
| Digdem (Sikri Elements møteportal) — multi-tenant GraphQL | tverrgaende | api | 1 | 🟡 testet | `POST https://{tenant}.digdem.no/graphql — operasjoner: GetMonthMeetings($where:MeetingList` |
| tilskudd.no / tilskudd.lottstift.no — ordningsdata og tildelingsstatistikk (inkl. momskompensasjon) | nasjonalt | skraping | 1 | ✅ bekreftet | `https://tilskudd.lottstift.no/ordning/DT-0036/2025/momskompensasjon-for-frivillige-organis` |
| Sametinget nyhets-RSS (Aktuelt, inkl. ukentlige tildelingslister) | nasjonalt | rss | 1 | ✅ bekreftet | `https://sametinget.no/ArtikkelRSS.ashx?NyhetsKategoriId=9&Spraak=Norsk` |
| Sametingets møteoversikt-API (plenum, fagkomiteer, sametingsrådet) — Acos Innsyn JSON | nasjonalt | api | 1 | 🟡 testet | `POST https://sametinget.no/api/presentation/v2/nye-innsyn/overview med body {"type":1,"key` |
| Sametingets møtedetalj- og saksdokument-API (saksliste + saksfremlegg-PDF før møter) | nasjonalt | api | 1 | 🟡 testet | `POST https://sametinget.no/api/presentation/v2/nye-innsyn/mote/{møte-id} og POST .../nye-i` |
| Stortinget: Ventede saker (eksport/ventedesaker) | nasjonalt | api | 2 | ✅ bekreftet | `https://data.stortinget.no/eksport/ventedesaker?format=json` |
| Stortinget: Skriftlige spørsmål (eksport/skriftligesporsmal) | nasjonalt | api | 2 | ✅ bekreftet | `https://data.stortinget.no/eksport/skriftligesporsmal?sesjonid=2025-2026&status=alle&forma` |
| Stortinget: Voteringer per sak (eksport/voteringer) | nasjonalt | api | 2 | ✅ bekreftet | `https://data.stortinget.no/eksport/voteringer?sakid=104907&format=json` |
| Stortinget: Publikasjon fulltekst (eksport/publikasjon) | nasjonalt | api | 2 | ✅ bekreftet | `https://data.stortinget.no/eksport/publikasjon?publikasjonid=inns-202526-014s` |
| Stortinget: Emneregister (eksport/emner) | nasjonalt | api | 2 | ✅ bekreftet | `https://data.stortinget.no/eksport/emner?format=json` |
| Stortinget: Komiteer og sesjoner (eksport/komiteer + eksport/sesjoner) | nasjonalt | api | 2 | 🟡 testet | `https://data.stortinget.no/eksport/komiteer?sesjonid=2025-2026&format=json` |
| Høringsdetaljside på regjeringen.no (per sak) | nasjonalt | skraping | 2 | ✅ bekreftet | `https://www.regjeringen.no/no/dokumenter/{slug}/id{contentId}/` |
| RSS-generator — NOU-er, meldinger (St.meld.) og proposisjoner | nasjonalt | rss | 2 | ✅ bekreftet | `https://www.regjeringen.no/no/rss/Rss/2581966/?documentType=dokumenter/nouer` |
| Riksantikvaren – WordPress REST API (nyheter/høringer) | nasjonalt | api | 2 | ✅ bekreftet | `https://www.riksantikvaren.no/wp-json/wp/v2/posts?per_page=20` |
| Kulturtanken – RSS + WordPress REST API | nasjonalt | rss | 2 | ✅ bekreftet | `https://www.kulturtanken.no/feed/` |
| Norsk filminstitutt – tildelingsdatabase (Sprig-komponent) | nasjonalt | skraping | 2 | 🟡 testet | `https://www.nfi.no/actions/sprig-core/components/render` |
| Norsk filminstitutt – søknadsfrister | nasjonalt | skraping | 2 | ✅ bekreftet | `https://www.nfi.no/soeknadsfrister` |
| Norsk filminstitutt – høringer og høringssvar | nasjonalt | skraping | 2 | ✅ bekreftet | `https://www.nfi.no/om-oss/hva-gjor-vi/horinger-og-horingssvar` |
| Nasjonalbiblioteket / bibliotekutvikling.no – WordPress REST API | nasjonalt | api | 2 | ✅ bekreftet | `https://bibliotekutvikling.no/wp-json/wp/v2/posts?per_page=20` |
| DFØ statsregnskapet.no – nedlastbare CSV-datasett (ZIP) | nasjonalt | dataset | 2 | 🟡 testet | `https://statsregnskapet.dfo.no/nedlasting/statsregnskapet_hittil_i_aar.zip` |
| eInnsyn enhetsregister (/enhet) — hvilke organ som er med | tverrgaende | api | 2 | 🟡 testet | `https://api.einnsyn.no/enhet?limit=100` |
| eInnsyn detaljoppslag + dokumentnedlasting (saksdokumenter i PDF) | tverrgaende | api | 2 | 🟡 testet | `https://api.einnsyn.no/moetesak/{id}?expand=dokumentbeskrivelse.dokumentobjekt` |
| Sikri Elements Publikum — postjournal/sakssøk (samme API) | kommune | api | 2 | 🟡 testet | `https://prod01.elementscloud.no/publikum/api/PredefinedQuery/CasesAndRegistryEntries?Query` |
| ACOS Innsyn (wfinnsyn.ashx) — møteplan og postliste | kommune | skraping | 2 | 🟡 testet | `https://innsyn.ringsaker.kommune.no/wfinnsyn.ashx?response=moteplan` |
| OpenGov 360online — politiske møter og sakspapirer | kommune | skraping | 2 | 🟡 testet | `https://opengov.360online.com/Meetings/NORDREFOLLO` |
| api.einnsyn.no – offisielt åpent lese-API (Digdir) | tverrgaende | api | 2 | 🟡 testet | `https://api.einnsyn.no/search?query=kultur&entity=Moetemappe` |
| OpenGov 360online – Telemark fylkeskommune | fylke | skraping | 2 | 🟡 testet | `https://opengov.360online.com/Meetings/telemarkfylke/Boards/Details/200083` |
| OpenGov 360online – Vestfold fylkeskommune | fylke | skraping | 2 | 🟡 testet | `https://opengov.360online.com/Meetings/vestfoldfylke/Boards/Details/200294` |
| Møre og Romsdal fylkeskommune – Høyringar (CMS-liste) | fylke | skraping | 2 | 🟡 testet | `https://mrfylke.no/tenester/hoyringar/` |
| Finnmark fylkeskommune – OpenGov 360online (møtekalender og saksdokumenter) | fylke | skraping | 2 | 🟡 testet | `https://opengov.360online.com/Meetings/ffk` |
| eInnsyn API (postlister, tverrgående) | tverrgaende | api | 2 | 🟡 testet | `https://api.einnsyn.no/search` |
| SSB KOSTRA tabell 12362 — Utgifter til tjenesteomradene, kommunekonsern, etter funksjon og art (K) | kommune | api | 2 | 🟡 testet | `https://data.ssb.no/api/v0/no/table/12362` |
| Framsikt publiseringsoversikt (Google My Maps KML-eksport) | tverrgaende | dataset | 2 | 🟡 testet | `https://www.google.com/maps/d/kml?mid=1sPGOCev2pRCjfk5jMlTdPMxYCeAte-8&forcekml=1` |
| Framsikt fylkeskommune-publiseringer | fylke | api | 2 | 🟡 testet | `https://pub.framsikt.net/2026/rogaland/bm-2026-okonomiplan_2026-2029_og_arsbudsjett_2026/c` |
| Lovdata — Norsk Lovtidend RSS (nye lover og forskrifter) | tverrgaende | rss | 2 | 🟡 testet | `https://lovdata.no/feed?data=LT&type=RSS` |
| NTB Kommunikasjon — presserom-RSS (Kulturdirektoratet m.fl.) | nasjonalt | rss | 2 | 🟡 testet | `https://kommunikasjon.ntb.no/rss/releases/latest?publisherId=89220` |
| FirstAgenda Publication ('Politisk Agenda') — Kristiansand m.fl. | tverrgaende | api | 2 | 🟡 testet | `GET https://politiskagenda.kristiansand.kommune.no/api/agenda/udvalgsliste (+ /api/agenda/` |
| Acos Innsyn Pluss — møteoversikt-API (innsynpluss.onacos.no + selvdriftede instanser) | tverrgaende | api | 2 | 🟡 testet | `POST https://innsynpluss.onacos.no/api/presentation/v2/nye-innsyn/overviewInit body {"type` |
| Lovdata — rammeforskrifter for spillemiddelfordelingen (via allerede kartlagt Norsk Lovtidend-RSS) | nasjonalt | rss | 2 | ✅ bekreftet | `https://lovdata.no/dokument/SF/forskrift/2026-04-17-615 (eksempel; fanges av https://lovda` |
| Lottstift.no — Viktige frister (årshjul for frivillighetsstøtte) | nasjonalt | skraping | 2 | 🟡 testet | `https://lottstift.no/viktige-frister/` |
| Fylkeskommunenes kulturbygg-sider (desentralisert ordning) — frister og detaljfordeling | fylke | skraping | 2 | 🟡 testet | `https://www.vestlandfylke.no/kultur/kunst--og-kulturutvikling/tilskot-til-kulturbygg/ (ver` |
| Sametingets aktive høringer | nasjonalt | skraping | 2 | ✅ bekreftet | `https://sametinget.no/politikk/horinger/aktive-horinger/` |
| Sametingets tilskuddsregelverk med søknadsfrister (print-versjon) | nasjonalt | skraping | 2 | ✅ bekreftet | `https://sametinget.no/stipend-og-tilskudd/oversikt-over-tilskuddsordninger/kultur/{ordning` |
| Stortinget: Enkeltspørsmål med svartekst (eksport/enkeltsporsmal) | nasjonalt | api | 3 | 🟡 testet | `https://data.stortinget.no/eksport/enkeltsporsmal?nsporsmalid=126831&format=json` |
| Stortinget: Interpellasjoner (eksport/interpellasjoner) | nasjonalt | api | 3 | 🟡 testet | `https://data.stortinget.no/eksport/interpellasjoner?sesjonid=2025-2026&format=json` |
| Stortinget: Publikasjonslister (eksport/publikasjoner) | nasjonalt | api | 3 | 🟡 testet | `https://data.stortinget.no/eksport/publikasjoner?publikasjontype=innstilling&sesjonid=2025` |
| Stortinget: Møter og dagsorden (eksport/moter + eksport/dagsorden) | nasjonalt | api | 3 | 🟡 testet | `https://data.stortinget.no/eksport/moter?sesjonid=2025-2026&format=json` |
| Stortinget: Høringsprogram og høringsinnspill (eksport/horingsprogram + eksport/horingsinnspill) — NEDE | nasjonalt | api | 3 | 🟡 testet | `https://data.stortinget.no/eksport/horingsprogram?horingid=10003502` |
| RSS — Offisielt fra statsråd (vedtak i statsråd) | nasjonalt | rss | 3 | ✅ bekreftet | `https://www.regjeringen.no/no/rss/Rss/2581966/?documentType=aktuelt/offisieltfrastatsr%C3%` |
| RSS — Kalenderhendelser per departement | nasjonalt | rss | 3 | ✅ bekreftet | `https://www.regjeringen.no/no/rss/Rss/2612030/?owner=545` |
| Tildelingsbrev-sider per departement (KUD: id750084) | nasjonalt | skraping | 3 | ✅ bekreftet | `https://www.regjeringen.no/no/dokument/dep/kud/tildelingsbrev-arsrapporter-og-instrukser--` |
| Kulturdirektoratet – kalender (råds-, styre- og infomøter) | nasjonalt | skraping | 3 | 🟡 testet | `https://www.kulturdirektoratet.no/kalender` |
| Kulturdirektoratet – aktuelt (nyheter) | nasjonalt | skraping | 3 | 🟡 testet | `https://www.kulturdirektoratet.no/aktuelt` |
| Tilskudd.no (Lotteri- og stiftelsestilsynet) – statlig tilskuddsregister | tverrgaende | skraping | 3 | 🟡 testet | `https://tilskudd.lottstift.no/forvalter/971527412/kulturdirektoratet` |
| Riksantikvaren – fredningsvedtak (custom post type) | nasjonalt | api | 3 | 🟡 testet | `https://www.riksantikvaren.no/wp-json/wp/v2/fredning?per_page=10` |
| SSB PxWeb API – KOSTRA kultur, kommuner (tabell 13135) | kommune | api | 3 | 🟡 testet | `https://data.ssb.no/api/v0/no/table/13135` |
| SSB PxWeb API – KOSTRA kultur, fylkeskommuner (tabell 12064/12264) | fylke | api | 3 | 🟡 testet | `https://data.ssb.no/api/v0/no/table/12064` |
| eInnsyn postjournaler (Journalpost) — statlig kulturforvaltning | nasjonalt | api | 3 | 🟡 testet | `https://api.einnsyn.no/search?query=tilskudd&entity=Journalpost&administrativEnhet=enh_01j` |
| Norske-postlister.no — kildekartlegging (discovery) | tverrgaende | skraping | 3 | 🟡 testet | `https://norske-postlister.no/postlister` |
| Innlandet fylkeskommune - økonomiplan/budsjett på Framsikt | fylke | skraping | 3 | 🟡 testet | `https://innlandetfylke.no/framsikt/` |
| SSB KOSTRA tabell 12264 — Utgifter til kultur, nokkeltall (F) | fylke | api | 3 | 🟡 testet | `https://data.ssb.no/api/v0/no/table/12264` |
| Doffin — offentlige anskaffelser (public API) | tverrgaende | api | 3 | 🟡 testet | `https://api.doffin.no/public/v2/search` |
| Google News RSS — norske kulturpolitiske søk | tverrgaende | rss | 3 | 🟡 testet | `https://news.google.com/rss/search?q=kulturbudsjett%20OR%20%22kulturpolitikk%22%20OR%20%22` |
| Innsynsportal.no ('Jupiter' innsynsplattform) — Trondheim/Tromsø | tverrgaende | api | 3 | 🟡 testet | `POST https://{tenant}.innsynsportal.no/graphql — operasjoner: getLists (lister m/ external` |
| Frivillighetsregisteret — åpent API (Brønnøysundregistrene) | nasjonalt | api | 3 | 🟡 testet | `https://data.brreg.no/frivillighetsregisteret/api/frivillige-organisasjoner (org-oppslag: ` |
| Sametingets postjournal-API (sak- og dokumentsøk, Acos Innsyn) | nasjonalt | api | 3 | 🟡 testet | `POST https://sametinget.no/api/presentation/v2/nye-innsyn/overview med body {"type":0,"key` |
| Sametingets kalender-RSS (hendelser og politiske møter) | nasjonalt | rss | 3 | 🟡 testet | `https://sametinget.no/Handlers/rss.ashx?lang=1&typ=0&search=` |
| Stortinget: Spørretimespørsmål (eksport/sporretimesporsmal) | nasjonalt | api | 4 | 🟡 testet | `https://data.stortinget.no/eksport/sporretimesporsmal?sesjonid=2025-2026&format=json` |
| Nasjonalarkivet (tidl. Arkivverket) | nasjonalt | ukjent | 4 | 🟡 testet | `https://www.nasjonalarkivet.no/` |
| eInnsyn OpenAPI-spesifikasjon og TypeScript-SDK (utviklerressurser) | tverrgaende | dataset | 4 | 🟡 testet | `https://raw.githubusercontent.com/felleslosninger/einnsyn-api-spec/main/openapi/einnsyn.op` |
| 360online postjournal ({kommune}.pj.360online.com) | kommune | skraping | 4 | 🟡 testet | `https://klepp.pj.360online.com/` |
| Fylkenes budsjett-/plan-sider (Akershus, Østfold, Buskerud, Oslo) | tverrgaende | skraping | 4 | ⚪ ikke testet | `https://afk.no/om-fylkeskommunen/planer-strategier-og-budsjett/` |
| Framsikt (pub.framsikt.net) – økonomiplan/budsjett/tertial | tverrgaende | skraping | 4 | ⚪ ikke testet | `https://pub.framsikt.net/2025/agder/mr-202508-tertialrapport_2_2025_agder_fylkeskommune` |
| Framsikt (pub.framsikt.net) – økonomiplan/budsjett-publisering | tverrgaende | ukjent | 4 | 🟡 testet | `https://pub.framsikt.net/2026/nordlandfk/` |
| Kommunenes egne budsjettdokument-sider (ikke-Framsikt) | kommune | skraping | 4 | ⚪ ikke testet | `https://www.trondheim.kommune.no/tema/politikk-og-planer/budsjett-regnskap-og-rapporter/ha` |
| NRK RSS (kultur og distrikter) | nasjonalt | rss | 4 | 🟡 testet | `https://www.nrk.no/kultur/toppsaker.rss` |
| Altinget.no RSS | nasjonalt | rss | 4 | 🟡 testet | `https://www.altinget.no/rss` |
| OpenGov 360online (Tietoevry Public 360 møteportal) — restkommuner | tverrgaende | skraping | 4 | ✅ bekreftet | `https://opengov.360online.com/Meetings/{ORGNAVN} (HTML; /Meetings/{ORG}/Meetings/Details/{` |
| Regjeringen.no RSS-generator — dokumenttype kongelige resolusjoner | nasjonalt | rss | 4 | 🟡 testet | `https://www.regjeringen.no/no/rss/Rss/2581966/?documentType=loverogregler/kongeligresolusj` |
| Anleggsregisteret.no (spillemiddelsøknader idrettsanlegg og kulturbygg) | nasjonalt | skraping | 4 | 🟡 testet | `https://www.anleggsregisteret.no/kulturanlegg/ (infosider); søkeapp: https://backoffice.an` |
| KUD tilskuddsoversikt på regjeringen.no (spillemiddelordningene samlet) | nasjonalt | skraping | 4 | ⚪ ikke testet | `https://www.regjeringen.no/no/dep/kud/tilskudd/id711839/ og ordningssiden https://www.regj` |
| sametinget.no sitemap.xml (endringsdeteksjon) | nasjonalt | dataset | 4 | 🟡 testet | `https://sametinget.no/sitemap.xml` |
| Regjeringen.no autosuggest-API (eneste åpne JSON-endepunkt funnet) | nasjonalt | api | 5 | ✅ bekreftet | `https://www.regjeringen.no/no/api/autosuggestapi/search/?q=kultur` |
| Nasjonalbiblioteket nb.no – WordPress REST API | nasjonalt | api | 5 | 🟡 testet | `https://www.nb.no/wp-json/wp/v2/posts?per_page=10` |
| SSB PxWeb API – Statsregnskapet (tabeller 10486/03730/07107/05588) | nasjonalt | api | 5 | 🟡 testet | `https://data.ssb.no/api/v0/no/table/10486` |
| Felles datakatalog / data.norge.no søke-API | tverrgaende | api | 5 | 🟡 testet | `https://search.api.fellesdatakatalog.digdir.no/search/datasets` |
| KS Fiks-plattformen (api.fiks.ks.no) | tverrgaende | ukjent | 5 | 🟡 testet | `https://api.fiks.ks.no/` |
| Fylkenes egne møtekalendersider (ACOS CMS) + historisk Viken-arkiv | tverrgaende | skraping | 5 | 🟡 testet | `https://bfk.no/politikk/moter-saker-og-vedtak/politisk-motekalender/` |
| Kaukus – Agder fylkeskommune (møtebehandling/votering) | fylke | ukjent | 5 | 🟡 testet | `https://app.kaukus.no/agder/` |
| Kommunal Rapport | kommune | skraping | 5 | 🟡 testet | `https://www.kommunal-rapport.no/sitemap.xml` |
| Holder de ord | nasjonalt | ukjent | 5 | 🟡 testet | — |
| Presseforbundet: 'Digitale møteportaler i norske kommuner' (kartlegging sept 2024) | tverrgaende | dataset | 5 | ✅ bekreftet | `https://presse.no/wp-content/uploads/2024/09/Digital-moteportaler-i-norske-kommuner-23.09.` |
| Plenumssaker per år (HTML-årssider) | nasjonalt | skraping | 5 | 🟡 testet | `https://sametinget.no/politikk/plenumssaker/ (årssider: plenumssaker-2026.45564.aspx, plen` |
