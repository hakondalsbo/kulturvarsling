// Fasit for konsekvens-eval. Datoen er låst til dagen den opprinnelige fasiten ble satt.
// FASIT_OPPRINNELIG er de 30 sakene fra stikkprøven. FASIT_HOLDOUT er nye saker,
// merket etter de samme kriteriene og holdt utenfor da prompten ble skrevet.
// fasit_begrunnelse sendes ikke til modellen. Utdrag er sitater fra kilden,
// ikke fasitens verdi.

export const FASIT_DATO = "2026-10-20";

export type FasitSett = "opprinnelig" | "holdt_utenfor";

export type FasitSak = {
  id: string;
  tittel: string;
  sammendrag: string;
  instans: string;
  frist: string | null;
  forventet: string;
  sikkerhet: string;
  kategori?: string | null;
  sakstype?: string | null;
  /** Råtekst eller kort utdrag. Tomt når sammendraget er kilden. */
  utdrag?: string | null;
  sett?: FasitSett;
  /** Hvorfor verdien er satt. Bare for Kildevakt, ikke for modellen. */
  fasit_begrunnelse?: string | null;
};

const FASIT_RÅ: FasitSak[] = [
  {
    "id": "80653f79-b471-49ed-b7c3-e98a118531af",
    "tittel": "Statsbudsjett 2027",
    "sammendrag": "Statsbudsjett 2027 er direkte relevant da det fastsetter all offentlig finansiering av kultursektor, inkludert kunstnerstipend, institusjoner, museer, scenekunst og kulturarrangementer. Dette er den viktigste dokumentet for kulturfeltet hvert år.",
    "instans": "Stortinget",
    "frist": null,
    "forventet": "ny_mulighet",
    "sikkerhet": "middels"
  },
  {
    "id": "e05a0843-c5bc-42d8-9a3d-4a5df3f25096",
    "tittel": "Redegjørelse av kultur- og likestillingsministeren om mediepolitikk og ytringsfrihet",
    "sammendrag": "Automatisk avvist av relevansfilteret",
    "instans": "Stortinget",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "middels"
  },
  {
    "id": "86b112f9-1a85-4fc3-a072-6351d415d401",
    "tittel": "Representantforslag fra stortingsrepresentantene Silje Hjemdal, Liv Gustavsen og Morgan Langfeldt om å tillate digitale lotterier for frivillige organisasjoner og idrettslag",
    "sammendrag": "Automatisk avvist av relevansfilteret",
    "instans": "Familie- og kulturkomiteen, Stortinget",
    "frist": null,
    "forventet": "stor_endring",
    "sikkerhet": "middels"
  },
  {
    "id": "97d844b6-5521-4032-ac98-4597a4cdd64c",
    "tittel": "Redegjørelse av barne- og familieministeren om status, gjennomførte tiltak og videre oppfølging av det som er avdekket om kriminelle aktører i barnevernet",
    "sammendrag": "Automatisk avvist av relevansfilteret",
    "instans": "Familie- og kulturkomiteen, Stortinget",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "høy"
  },
  {
    "id": "c8d165f2-7ea4-44f3-8a89-22ccbf6b0ee6",
    "tittel": "Varslet sak: Endringer i statsbudsjettet 2026 under Kultur- og likestillingsdepartementet",
    "sammendrag": "Statsbudsjettet 2026 under Kultur- og likestillingsdepartementet vil direkte påvirke finansieringen av kulturinstitusjoner, kunstnerstøtte og kulturprosjekter. Profesjonelle aktører bør følge proposisjonen for å vurdere konsekvenser for deres økonomiske rammer og virksomhet.",
    "instans": "Kultur- og likestillingsdepartementet",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "lav"
  },
  {
    "id": "3f54ce6f-c602-4b48-96e7-5330ee7c7dc6",
    "tittel": "Varslet sak: Endringer i helligdagsfredloven (åpningstid for kinoer)",
    "sammendrag": "Endringer i helligdagsfredloven som gjelder kinoers åpningstider påvirker direkte driften og inntektsmuligheter for filmkulturelle institusjoner. Saken berører økonomiske og operasjonelle forhold for kinoer som kulturaktører.",
    "instans": "Kultur- og likestillingsdepartementet",
    "frist": null,
    "forventet": "stor_endring",
    "sikkerhet": "middels"
  },
  {
    "id": "161fdeab-2271-46c6-b28d-2680208e627a",
    "tittel": "Prop. 1 S (2026–2027) - For budsjettåret 2027 under Kultur- og likestillingsdepartementet",
    "sammendrag": "Budsjettproposisjonen for Kultur- og likestillingsdepartementet 2027 er direkte relevant da den fastsetter finansiering og bevilgninger for alle kulturfelts kjerneaktiviteter. Saken er essentiell for all kultursektor da den definerer økonomiske rammer for institusjoner, kunstnerstøtte, kulturbygg og kulturfond for kommende år.",
    "instans": "Regjeringen – proposisjon",
    "frist": null,
    "forventet": "ny_mulighet",
    "sikkerhet": "middels"
  },
  {
    "id": "90a26730-e886-4a10-a1e5-a08aedaabd17",
    "tittel": "Høring av Lotteri- og stiftelsestilsynets utredning om regulering av pengespill-lignende elementer i dataspill",
    "sammendrag": "Automatisk avvist av relevansfilteret",
    "instans": "Regjeringen – høring",
    "frist": "2027-01-12",
    "forventet": "stor_endring",
    "sikkerhet": "høy"
  },
  {
    "id": "de0dc5a6-fb44-4d5c-aebd-76b9ea10c085",
    "tittel": "Sluttbehandling av reguleringsplan - 71480000 Bergenhus. Gnr. 165, Bnr. 556 m. fl., Kulturkvartalet Verftet",
    "sammendrag": "Bystyret i Bergen behandler reguleringsplanen for Kulturkvartalet Verftet 27. oktober 2026 (sak 319/26). Planen regulerer området rundt USF og Kjødehallene til kulturformål. Den legger til rette for videre drift av USF og for en arena med plass til 3 500–4 000 publikummere i Kjødehallene. Byrådet anbefaler at planen vedtas med noen endringer.",
    "instans": "Bergen bystyre, Bergen kommune",
    "frist": null,
    "forventet": "ny_mulighet",
    "sikkerhet": "middels"
  },
  {
    "id": "b2fce9f0-5b02-4234-8f61-aef4a2f47ab3",
    "tittel": "Overføring av landbruksoppgaver til myndighetsnivå 1 i Byrådsavdeling for næring, kultur og idrett",
    "sammendrag": "Automatisk avvist av relevansfilteret",
    "instans": "Bergen bystyre, Bergen kommune",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "høy"
  },
  {
    "id": "cc11ac17-70d4-4743-b509-19c1ce336511",
    "tittel": "Høring: Bydelsreformen - oppgaveoverføring - lokale kultur og idrettstilskudd",
    "sammendrag": "Saken gjelder oppgaveoverføring av lokale kultur- og idrettstilskudd i forbindelse med bydelsreformen, som direkte påvirker hvordan kulturfinansieringen organiseres og forvaltes på bydelsnivå i Oslo. Dette er relevant for kulturaktører som mottar eller søker om slike tilskudd fra Bydel Nordstrand.",
    "instans": "Bydel Nordstrand",
    "frist": null,
    "forventet": "stor_endring",
    "sikkerhet": "middels"
  },
  {
    "id": "215e0230-ee85-4a1c-8774-ca8b395dd72f",
    "tittel": "Oppgavefordeling - lokale kultur- og idrettstilskudd",
    "sammendrag": "Saken gjelder oppgavefordeling for lokale kultur- og idrettstilskudd i Bydel Bjerke, og er relevant for kulturorganisasjoner og kulturaktører som søker om lokale tilskudd. Dette berører direkte finansieringsordninger for profesjonelle og semi-profesjonelle kulturaktører på bydelsnivå.",
    "instans": "Bydel Bjerke",
    "frist": null,
    "forventet": "stor_endring",
    "sikkerhet": "middels"
  },
  {
    "id": "d10a6289-9c04-49d0-811c-0cce7c51d9ed",
    "tittel": "2026/39242 Svar på oversendelsesforslag fremmet i utvalg for kultur, idrett og samfunnsdialog 10.06.2026 i sak 50/26 – Mandat Temaplan for kunst og kultur 2027-2035",
    "sammendrag": "Sak om mandatet for kommunal temaplan for kunst og kultur 2027-2035 berører direkte kulturpolitiske prioriteringer og finansiering av kultursektor i Stavanger kommune. Dette er grunnlagsdokument for kulturinstitusjoner og kunstnere som søker støtte og ressurser.",
    "instans": "Stavanger kommune",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "middels"
  },
  {
    "id": "af75b1b4-557a-4fac-9175-60aad58e0aa5",
    "tittel": "Klostergarasjen - utbedring av søyler og dekke. Gjennomføringsvedtak",
    "sammendrag": "Klostergarasjen er en kulturell og historisk bygning i Bergen som brukes av kulturaktører. Vedlikehold og utbedring av bygningens infrastruktur (søyler og dekke) er relevant for sikker drift av kulturaktiviteter og langsiktig bevaring av kulturbygget.",
    "instans": "Utvalg for finans, kultur og næring, Bergen kommune",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "lav"
  },
  {
    "id": "86124a2b-31ee-4ebf-87f6-6ece87acab86",
    "tittel": "Representantforslag fra Ole-Ansger Nepomuk Martini (V) om meråpne bibliotek",
    "sammendrag": "Saken gjelder utvidelse av bibliotekåpningstider i Bergen kommune. Dette berører bibliotekdrift og tilgjengelighet som en kulturinstitusjon, men har begrenset direkte innvirkning på kunstner- og kulturproduksjon.",
    "instans": "Utvalg for finans, kultur og næring, Bergen kommune",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "middels"
  },
  {
    "id": "a3906774-c52b-45d2-955e-88811f0c3e75",
    "tittel": "Økonomiske perspektiver 2026",
    "sammendrag": "Økonomiske perspektiver for Bergen kommune 2026 berører budsjettplanlegging og finansiering av kommunale kulturinstitusjoner, museer, bibliotek og kulturvirksomhet. Saken er relevant for alle profesjonelle aktører som er avhengige av kommunal kulturfinansiering i Bergen.",
    "instans": "Utvalg for finans, kultur og næring, Bergen kommune",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "lav"
  },
  {
    "id": "54eee543-98dd-452c-9668-15640e8a7fe8",
    "tittel": "Søknader om økte faste driftstilskudd innen kultur-, kulturarv-, museums- og kulturminnesektoren fra 2027",
    "sammendrag": "Saken gjelder søknader om økte faste driftstilskudd til kultur-, kulturarv-, museums- og kulturminnesektoren fra 2027, som direkte påvirker finansiering og stabilitet for kulturinstitusjoner og museer i Agder fylke.",
    "instans": "Agder fylkeskommune",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "lav"
  },
  {
    "id": "390382e2-e405-4717-9d8d-3645e5138e13",
    "tittel": "Tilskuddsordninger kultur og idrett - orientering om tildelinger 2026",
    "sammendrag": "Saken gjelder orientering om tildelinger fra fylkeskommunens tilskuddsordninger for kultur og idrett i 2026, og er direkte relevant for kulturaktører som søker om driftsstøtte, prosjektfinansiering eller andre tilskudd fra Østfold fylkeskommune.",
    "instans": "Østfold fylkeskommune",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "høy"
  },
  {
    "id": "4333eb3a-c44e-45bd-bc5a-162019cb1471",
    "tittel": "Budsjettbehov 2027. Kultur og folkehelse, arkeologisk registrering",
    "sammendrag": "Budsjettbehandling hos Vestland fylkeskommune for 2027 som direkte berører finansiering av arkeologisk registrering og kulturarv-arbeid. Saken avgjør ressursallokeringen til arkeologisk arbeid under fylkeskommunens ansvar.",
    "instans": "Vestland fylkeskommune",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "lav"
  },
  {
    "id": "cdababbb-205d-44af-8723-1a4d91c432f9",
    "tittel": "Innspel til plan for profesjonell kunst og kultur i Bergen kommune",
    "sammendrag": "Saken gjelder en innspel til plan for profesjonell kunst og kultur i Bergen kommune, som direkte berører kulturpolitikk, finansiering og organisering av kunstnerisk virksomhet på kommunenivå. Dette er sentral kulturpolitisk planlegging som påvirker profesjonelle aktører i kultursektoren.",
    "instans": "Vestland fylkeskommune",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "middels"
  },
  {
    "id": "b70f9ea5-b8f2-4a1d-8c6a-2ccf1ec4bf8c",
    "tittel": "Innvilgede saker 12.10.26-18.10.26",
    "sammendrag": "Sametinget innvilget 18 tilskudd på til sammen 1 438 566 kroner i uken 12.–18. oktober 2026. Fem av dem, til sammen 224 000 kroner, gjelder musikk og kultur, blant annet Tromsø World Festival, Gába AS og Sahkkon AS.",
    "instans": "Sametinget",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "høy"
  },
  {
    "id": "6ed0668e-38f6-4279-815f-41e92ef9cdec",
    "tittel": "Innvilgede saker 05.10.26-11.10.26",
    "sammendrag": "Sametingets tilskuddsbevilgninger kan omfatte støtte til samisk kunst, kultur og kulturarv. Profesjonelle aktører i samisk kultursektor bør kontrollere hvilke kulturprosjekter som ble innvilget i denne perioden for potensial finansiering.",
    "instans": "Sametinget",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "høy"
  },
  {
    "id": "f104bc54-d6b0-4b8a-b785-e097bbb6fcf3",
    "tittel": "Innvilgede tilskudd 28.09.26-04.10.26",
    "sammendrag": "Sametinget bevilger tilskudd til kulturformål i perioden 28.09-04.10.26. Saken er relevant da Sametinget forvalter betydelige midler til samisk kultur, kunstnerskap og kulturinstitusjoner som er direkte av interesse for profesjonelle aktører i kulturfeltet.",
    "instans": "Sametinget",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "høy"
  },
  {
    "id": "948390be-2ce3-451a-a3e2-862b97858f4d",
    "tittel": "Statsbudsjettet 2027: – Svarer ikke på behovene i Sápmi",
    "sammendrag": "Sametingets budsjett påvirker direkte finansieringen av samisk kultur, kunst og kulturarv. Begrenset handlingsrom utover kompensasjon for pris- og lønnsvekst kan påvirke samiske kunstnere, kulturinstitusjoner og kulturprosjekter i Sápmi.",
    "instans": "Sametinget",
    "frist": null,
    "forventet": "kutt_innstramming",
    "sikkerhet": "middels"
  },
  {
    "id": "2d4ca72f-de10-4ab5-90a8-a3eb43d74562",
    "tittel": "Svært skuffet over regjeringen: – Et svik mot samisk kultur og naturen​",
    "sammendrag": "Saken berører vern av samisk kulturarv og tradisjonell kultur (reindrift), som er en kjernedel av kulturpolitikken. Regjeringens beslutning om vindkraft kan få direkte konsekvenser for samisk kulturutøvelse og kulturelle rettigheter.",
    "instans": "Sametinget",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "middels"
  },
  {
    "id": "1cf0dfd3-4fc8-4fc0-976f-d733db4b7aae",
    "tittel": "Høring: Behov for samiske tilbud, ordninger og tiltak i Sør-Norge valgkrets",
    "sammendrag": "Saken gjelder samisk kulturarv og reparering av fornorskingsskader, som er relevant for kulturinstitusjoner og aktører som arbeider med samisk kultur, språk og kulturuttrykk i Sør-Norge. Dette kan påvirke finansiering, ordninger og tiltak for samisk kulturell aktivitet og institusjoner.",
    "instans": "Sametinget",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "middels"
  },
  {
    "id": "1cbcddd8-8d9c-4732-b54c-f8956d7f022d",
    "tittel": "Tildeling: Fond for lyd og bilde — 19 søknader innvilget (FLB-MEDIA, runde 2026-09-03)",
    "sammendrag": "Fond for lyd og bilde tildeler 1,5 mill. kr til 19 musikk- og lydprosjekter, inkludert debutalbumkampanjer og lydkunstprosjekter. Dette er direkte finansiering av profesjonelle musikere og lydkunstnere gjennom en sentral norsk kulturfond.",
    "instans": "Fond for lyd og bilde",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "høy"
  },
  {
    "id": "19622766-7b5b-4395-ac2b-c69e2e3bdd5f",
    "tittel": "Tildeling: Kulturrådet — 372 søknader innvilget (NKF-IAV, runde 2026-10-15)",
    "sammendrag": "Kulturrådet har innvilget 372 søknader i NKF-IAV-ordningen, som er en sentral finansieringsordning for norsk film- og audiovisuell produksjon. Dette er direkte relevant for filmselskaper, produsenter og andre aktører i audiovisuell sektor som er avhengig av denne finansieringen.",
    "instans": "Kulturrådet",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "høy"
  },
  {
    "id": "bc017010-54b3-46ad-ada5-6db179fd5f86",
    "tittel": "Tildeling: Spillemidler — 40 søknader innvilget (KUL-IND, runde 2026-09-15)",
    "sammendrag": "Spillemidler tildeler 4,5 mill. kr til 40 kunstnerprosjekter, primært scenekunst og musikal. Dette er direkte finansiering av profesjonelle kulturaktørers produksjoner gjennom en etablert statlig kulturordning.",
    "instans": "Spillemidler",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "høy"
  },
  {
    "id": "cbce8da8-335b-4ca6-b8bd-df2dc0fbe861",
    "tittel": "Tildeling: Kulturrådet — 66 søknader innvilget (NKF-IOL, runde 2026-06-02)",
    "sammendrag": "Kulturrådet har innvilget 66 søknader i NKF-IOL-ordningen, som finansierer kulturprosjekter og kulturinstitusjoner. Dette er direkte relevant for alle søkere og aktører som søker statlig kulturfinansiering gjennom denne ordningen.",
    "instans": "Kulturrådet",
    "frist": null,
    "forventet": "til_orientering",
    "sikkerhet": "høy"
  }
];

/**
 * Utdrag som det lagrede sammendraget ikke har.
 * Statsbudsjett-utdraget er totalrammen i Prop. 1 S (2026–2027), side 12,
 * slik den er gjengitt i src/innhold/statsbudsjett2027.md. Hele kutt-tabellen
 * er ikke tatt med. Sametinget-utdraget er faktaavsnittet i artikkelen.
 * Lotteri og helligdagsfredloven er statuslinjen på stortinget.no.
 */
const BERIKELSE: Record<string, Partial<FasitSak>> = {
  "80653f79-b471-49ed-b7c3-e98a118531af": {
    kategori: "kulturpolitikk",
    frist: "2026-10-28",
    utdrag: "Fra Prop. 1 S (2026–2027) for Kultur- og likestillingsdepartementet, side 12: Forslaget for departementets område, som også dekker idrett og likestilling, er på 28,1 milliarder kroner. Det er om lag 946 millioner kroner mer enn i budsjettet for 2026, en økning på 3,5 prosent. Proposisjonen sier ikke hvor mye av økningen som går med til å dekke at priser og lønninger stiger. Ifølge departementet videreføres de fleste bevilgningene omtrent som før. I proposisjonen styrkes filmfeltet med 45 millioner kroner, hvorav 5 millioner til en ny ordning for å oppgradere digitalt kinoutstyr.",
  },
  "e05a0843-c5bc-42d8-9a3d-4a5df3f25096": {
    kategori: "kulturpolitikk",
    sammendrag: "Kulturminister Lubna Jaffery skal holde en redegjørelse for Stortinget om mediepolitikk og ytringsfrihet. En redegjørelse er en orientering fra en statsråd, og den følges av en debatt i Stortinget. Datoen er ikke kjent ennå.",
  },
  "86b112f9-1a85-4fc3-a072-6351d415d401": {
    kategori: "kulturpolitikk",
    sakstype: "forslag",
    frist: "2026-10-28",
    utdrag: "Stortinget.no, sak 200367: Representantforslag om å tillate digitale lotterier for frivillige organisasjoner og idrettslag. Dokument 8:316 S (2025–2026). Status: Forslaget er til behandling i familie- og kulturkomiteen. Forslag fra Liv Gustavsen, Morgan Langfeldt og Silje Hjemdal.",
  },
  "97d844b6-5521-4032-ac98-4597a4cdd64c": {
    kategori: "kulturpolitikk",
  },
  "3f54ce6f-c602-4b48-96e7-5330ee7c7dc6": {
    kategori: "film",
    utdrag: "Stortinget.no: Endringer i helligdagsfredloven (åpningstid for kinoer). Status: Regjeringen har meldt at lovforslaget skal legges frem for Stortinget. Saksgangen er lovforslag, komitébehandling, første behandling, andre behandling og lov.",
  },
  "161fdeab-2271-46c6-b28d-2680208e627a": {
    kategori: "kulturarv",
    utdrag: "Fra Prop. 1 S (2026–2027) for Kultur- og likestillingsdepartementet, side 12: Forslaget for departementets område, som også dekker idrett og likestilling, er på 28,1 milliarder kroner. Det er om lag 946 millioner kroner mer enn i budsjettet for 2026, en økning på 3,5 prosent. Proposisjonen sier ikke hvor mye av økningen som går med til å dekke at priser og lønninger stiger. Ifølge departementet videreføres de fleste bevilgningene omtrent som før. I proposisjonen styrkes filmfeltet med 45 millioner kroner, hvorav 5 millioner til en ny ordning for å oppgradere digitalt kinoutstyr.",
  },
  "90a26730-e886-4a10-a1e5-a08aedaabd17": {
    kategori: "spill",
    sakstype: "horing",
    sammendrag: "Kultur- og likestillingsdepartementet har sendt på høring Lotteri- og stiftelsestilsynets utredning om pengespill-lignende elementer i dataspill, blant annet lootbokser. Høringsfristen er 12. januar 2027.",
  },
  "cc11ac17-70d4-4743-b509-19c1ce336511": { kategori: "kulturarv" },
  "215e0230-ee85-4a1c-8774-ca8b395dd72f": { kategori: "kulturarv" },
  "948390be-2ce3-451a-a3e2-862b97858f4d": {
    kategori: "kulturarv",
    sakstype: "nyhet",
    utdrag: "Fra Sametingets artikkel, fakta om budsjettforslaget for 2027: Regjeringen foreslår å øke bevilgningen til Sametinget over kap. 560 Samiske formål, post 50 Samisk språk, kultur og samfunnsliv, fra saldert budsjett 2026 til 2027. Korrigert for en teknisk rammeoverføring er økningen om lag 3,2 %. Regjeringen anslår konsumprisveksten (KPI) til 2,7 % og årslønnsveksten til 4,0 % i 2027. Den korrigerte bevilgningsveksten på 3,2 % ligger over anslått KPI, men under anslått årslønnsvekst. Den er også lavere enn den anslåtte prisveksten i statsbudsjettets utgifter på 3,4 %.",
  },
  "1cf0dfd3-4fc8-4fc0-976f-d733db4b7aae": { kategori: "kulturarv", frist: "2026-11-23" },
  "de0dc5a6-fb44-4d5c-aebd-76b9ea10c085": { kategori: "kulturarv" },
  "c8d165f2-7ea4-44f3-8a89-22ccbf6b0ee6": { kategori: "kulturarv" },
  "86124a2b-31ee-4ebf-87f6-6ece87acab86": { kategori: "museer" },
  "b70f9ea5-b8f2-4a1d-8c6a-2ccf1ec4bf8c": { sakstype: "tildeling", kategori: "kulturpolitikk" },
  "6ed0668e-38f6-4279-815f-41e92ef9cdec": { sakstype: "tildeling", kategori: "kulturpolitikk" },
  "1cbcddd8-8d9c-4732-b54c-f8956d7f022d": { sakstype: "tildeling", kategori: "musikk" },
  "19622766-7b5b-4395-ac2b-c69e2e3bdd5f": { sakstype: "tildeling", kategori: "litteratur" },
  "bc017010-54b3-46ad-ada5-6db179fd5f86": { sakstype: "tildeling", kategori: "scenekunst" },
  "cbce8da8-335b-4ca6-b8bd-df2dc0fbe861": { sakstype: "tildeling", kategori: "litteratur" },
};

export const FASIT_OPPRINNELIG: FasitSak[] = FASIT_RÅ.map((sak) => ({
  ...sak,
  sett: "opprinnelig" as const,
  ...BERIKELSE[sak.id],
}));

/**
 * Tolv saker som ikke var med i stikkprøven. Verdien er satt fra det lagrede
 * sammendraget og kriteriene, før modellen har sett dem. Begrunnelsen er til
 * Kildevakt. Der det lagrede sammendraget selv sa «til orientering», er den
 * setningen tatt ut av teksten modellen får.
 */
export const FASIT_HOLDOUT: FasitSak[] = [
  {
    id: "d3938f34-b18d-4a66-aea8-ab21f18fdc91",
    tittel: "Høring - forslag til endringer i pengespillforskriften",
    sammendrag: "Kulturdepartementet foreslår at Norsk Tipping skal få lov til å tilby poker på nett. De største spillselskapene skal også måtte melde fra når noe går galt, og noen regler for utbetaling av såkalte Belago-midler fra bingo endres. Fristen for høringssvar er 29. november 2026, litt kortere enn vanlig fordi departementet vil at reglene skal gjelde raskt.",
    instans: "KUD – høring",
    frist: "2026-11-29",
    kategori: "spill",
    sakstype: "horing",
    forventet: "stor_endring",
    sikkerhet: "høy",
    sett: "holdt_utenfor",
    fasit_begrunnelse: "Høring av et forslag som endrer pengespillforskriften: Norsk Tipping kan få tilby poker på nett, og reglene for Belago-midler endres. Det er en forskriftsendring for bransjen, ikke en tildeling og ikke et kutt. Fristen 29.11.2026 ligger i det lagrede sammendraget.",
  },
  {
    id: "73099e8c-5675-4adc-ae49-cdb58a132586",
    tittel: "Høring - forslag til endringer i kringkastingsforskriften",
    sammendrag: "Kulturdepartementet foreslår endringer i kringkastingsforskriften, slik at lokalradioer på FM kan få forlenget tillatelsene sine til å sende fram til utgangen av 2031. Medietilsynet får også klarere rett til å sette vilkår for tillatelsene, og til å gi sendertillatelse til en ny aktør hvis en annen enn dagens får frekvensen. Fristen for høringssvar er 12. november 2026.",
    instans: "KUD – høring",
    frist: "2026-11-12",
    kategori: "kulturpolitikk",
    sakstype: "horing",
    forventet: "stor_endring",
    sikkerhet: "høy",
    sett: "holdt_utenfor",
    fasit_begrunnelse: "Forslaget endrer kringkastingsforskriften og dermed hvor lenge lokalradioer kan sende, og hvem som kan få tillatelsen. Det er rammevilkår for en bransje. Teksten nevner ingen bevilgning som kuttes eller økes.",
  },
  {
    id: "7f4cece1-f089-4dcc-9395-473d4ebafc96",
    tittel: "Byrådssak 136 av 25.06.2026 - Forskrift om utlån og utleie av kommunale lokaler til frivillig aktivitet i Oslo kommune",
    sammendrag: "Saken gjelder forskrift for utlån og utleie av kommunale lokaler til frivillig aktivitet i Oslo kommune. For kulturorganisasjoner og kunstnersamfunn er dette relevant fordi det regulerer tilgangen til kommunale kulturhus, scener og andre lokaler som er sentrale for kulturaktiviteter.",
    instans: "Bystyrets sekretariat",
    frist: null,
    kategori: "kulturpolitikk",
    sakstype: null,
    forventet: "stor_endring",
    sikkerhet: "middels",
    sett: "holdt_utenfor",
    fasit_begrunnelse: "Tittelen er en forskrift om utlån og utleie av kommunale lokaler, og sammendraget sier at den regulerer tilgangen til kulturhus og scener. Det er en regelendring for dem som bruker lokalene. Teksten gjengir ikke selve paragrafene, derfor middels sikkerhet. Det er ikke en åpen søknadsrunde.",
  },
  {
    id: "104b8405-2dba-4771-ba85-ee4d4dd461f5",
    tittel: "Innspill til kvotefordelingen av kunstnerstipendmidlene for 2027",
    sammendrag: "Utvalget for Statens kunstnerstipend har lagt fram et forslag til hvordan stipendpengene for 2027 skal deles mellom kunstnergruppene. Departementet har sendt forslaget til kunstnerorganisasjonene, men også andre kan si sin mening. Innspill sendes på e-post til postmottak@kud.dep.no med kopi til postmottak@kulturdirektoratet.no innen 20. november 2026.",
    instans: "KUD – nyhet",
    frist: "2026-11-20",
    kategori: "kulturpolitikk",
    sakstype: "horing",
    forventet: "stor_endring",
    sikkerhet: "middels",
    sett: "holdt_utenfor",
    fasit_begrunnelse: "Saken gjelder hvordan stipendpotten fordeles mellom kunstnergruppene. Det er en endring i fordelingsnøkkel, ikke en ny ordning og ikke et navngitt kutt. Innspillsfristen er 20.11.2026. Beløpene i fordelingen står ikke i sammendraget, derfor middels.",
  },
  {
    id: "ea1876a7-48b3-430b-84b5-85c933109caa",
    tittel: "Retningslinjer - Tilskudd fra Kultur- og likestillingsdepartementet til nasjonale kulturbygg for 2028",
    sammendrag: "Kulturdepartementet har lagt ut reglene for å søke om penger til bygg fra ordningen Nasjonale kulturbygg i statsbudsjettet for 2028. Ordningen gir tilskudd til bygg og lokaler for kulturinstitusjoner som har en nasjonal oppgave eller en viktig rolle i en landsdel, og staten dekker som hovedregel høyst en tredjedel av kostnaden. Søknaden må være kommet fram til departementet innen 1. desember 2026.",
    instans: "KUD – tilskudd",
    frist: "2026-12-01",
    kategori: "kulturpolitikk",
    sakstype: "tilskudd",
    forventet: "ny_mulighet",
    sikkerhet: "høy",
    sett: "holdt_utenfor",
    fasit_begrunnelse: "Det er en åpen søknadsrunde med frist 1. desember 2026. Ordningen finnes fra før, men teksten åpner en søknadsmulighet leserne kan bruke. Den oppgir ikke et kutt i årets bevilgning.",
  },
  {
    id: "8808a110-b21f-4e55-b606-4616392d0096",
    tittel: "Statsbudsjettet 2027: Arbeidarparti-regjeringa styrker filmfeltet med 75 millionar kroner",
    sammendrag: "Regjeringen foreslår å styrke filmfeltet med 45 millioner kroner: 25 millioner til Filmfondet, 15 millioner til insentivordningen for film- og serieproduksjon og 5 millioner til en ny ordning for digitalt kinoutstyr. Når prisjustering og andre endringer er regnet med, øker bevilgningene til film og dataspill med om lag 75 millioner kroner. Filmfondet får totalt 740 millioner kroner, 47 millioner mer enn i 2026. Regjeringen vil også lage en ny stortingsmelding om film og kreve at NRK bidrar til norsk spillefilm, drama og dokumentar.",
    instans: "KUD – nyhet",
    frist: null,
    kategori: "film",
    sakstype: "nyhet",
    forventet: "ny_mulighet",
    sikkerhet: "høy",
    sett: "holdt_utenfor",
    fasit_begrunnelse: "Teksten navngir økninger: 25 millioner til Filmfondet, 15 millioner til insentivordningen og 5 millioner til en ny ordning for digitalt kinoutstyr. Økt bevilgning og en ny ordning er ny_mulighet. En stortingsmelding er varslet, men pengene er det saken handler om.",
  },
  {
    id: "3dbc0fc1-8299-4dd3-8e16-6f9876c347ac",
    tittel: "Statsbudsjettet 2027: Meir til kunstnarane i Statens kunstnarstipend",
    sammendrag: "Regjeringen foreslår fem flere arbeidsstipend i Statens kunstnerstipend i 2027, og at beløpet for et arbeidsstipend økes fra 342 193 til 354 801 kroner. Etableringsstipendet for unge kunstnere kan nå gis til alle kunstnergrupper, og potten økes fra 22,1 til 25,9 millioner kroner. En ny forskrift for Statens kunstnerstipend trådte i kraft 1. juli 2026, og stipendene for 2027 tildeles etter den.",
    instans: "KUD – nyhet",
    frist: null,
    kategori: "kulturpolitikk",
    sakstype: "nyhet",
    forventet: "ny_mulighet",
    sikkerhet: "middels",
    sett: "holdt_utenfor",
    fasit_begrunnelse: "Antallet arbeidsstipend øker med fem, beløpet øker fra 342 193 til 354 801 kroner, og etableringsstipendet utvides til alle kunstnergrupper. Det er økte bevilgninger. Forskriften trådte i kraft 1. juli 2026 og er ikke den endringen saken varsler. Hadde forskriften vært selve forslaget, ville stor_endring ligget nærmere.",
  },
  {
    id: "9d97fa17-782f-49d6-97c5-41d8458b38f4",
    tittel: "Høring: Forslag om å skrive norsk som nasjonalt hovedspråk inn i Grunnloven (ny § 120 b)",
    sammendrag: "Kontroll- og konstitusjonskomiteen på Stortinget har en skriftlig høring om et forslag til ny § 120 b i Grunnloven. Forslaget lyder: «Norsk er det nasjonale hovedspråket i Norge. Bokmål og nynorsk er likestilte og likeverdige norske skriftspråk.» I dag står det i språkloven § 4 at norsk er det nasjonale hovedspråket, og at bokmål og nynorsk er likestilte skriftspråk i det offentlige. Forslagsstillerne skriver at forslaget ikke tar sikte på å endre språklige rettigheter eller plikter som følger av språkloven eller annen lovgivning. Samiske språk, kvensk, romani, romanes og norsk tegnspråk er ikke med i forslaget, og forslaget tar ikke sikte på å endre statusen deres. Frist for skriftlige innspill er 17. november 2026 kl. 23.59.",
    instans: "Kontroll- og konstitusjonskomiteen, Stortinget",
    frist: "2026-11-17",
    kategori: "kulturpolitikk",
    sakstype: "horing",
    forventet: "til_orientering",
    sikkerhet: "middels",
    sett: "holdt_utenfor",
    fasit_begrunnelse: "Det er en høring om en grunnlovsparagraf, men forslagsstillerne skriver at den ikke tar sikte på å endre språklige rettigheter eller plikter. Innholdet står allerede i språkloven § 4. Høringen krever innspill, men endrer ikke rammevilkår for en bransje. Derfor til_orientering, ikke stor_endring.",
  },
  {
    id: "0dbea5c7-2a00-4ee0-804f-5454b98624fc",
    tittel: "Tildeling: Fond for lyd og bilde — 66 søknader innvilget (FLB-CINE, runde 2026-09-03)",
    sammendrag: "Fond for lyd og bilde tildeler 8,7 millioner kroner til 66 filmprosjekter, som er direkte finansiering av profesjonelle aktører i norsk filmsektor. Dette er en sentral ordning for produksjon av norske audiovisuelle verk.",
    instans: "Fond for lyd og bilde",
    frist: null,
    kategori: "film",
    sakstype: "tildeling",
    forventet: "til_orientering",
    sikkerhet: "høy",
    sett: "holdt_utenfor",
    fasit_begrunnelse: "Tittelen sier at 66 søknader er innvilget i en avsluttet runde 2026-09-03. Midlene er allerede tildelt. Det er ingen åpen frist og ingen ny ordning.",
  },
  {
    id: "574ab18c-935c-4341-b944-15263d48458c",
    tittel: "Kulturrådet kjøper inn 8 tegneserier til bibliotekene (søknadsfrist 2. juni 2026)",
    sammendrag: "Kulturrådet har vedtatt å kjøpe inn 8 titler gjennom innkjøpsordningen for nye norske tegneserier. 17 titler var meldt på i runden med søknadsfrist 2. juni 2026. Bøkene sendes til folkebibliotek i hele landet. Titler for barn og unge sendes også til enkelte skolebibliotek. Hver tittel sendes i 2020 eksemplarer hvis den er for barn og unge, og 703 hvis den er for voksne. Bibliotekene skal ha bøkene tilgjengelig i minst fem år. Ordningen er selektiv: et vurderingsutvalg vurderer kvaliteten og velger titler innenfor en budsjettramme som er bestemt på forhånd. I praksis betyr innkjøpet at forlaget får betalt for eksemplarene.",
    instans: "Kulturrådet",
    frist: null,
    kategori: "litteratur",
    sakstype: "tildeling",
    forventet: "til_orientering",
    sikkerhet: "høy",
    sett: "holdt_utenfor",
    fasit_begrunnelse: "Innkjøpet er vedtatt, og søknadsfristen 2. juni 2026 var passert 20.10.2026. Det er en liste over titler som allerede er kjøpt inn, ikke en åpen runde. Den lagrede teksten sluttet med «Saken er til orientering og har ingen frist». Den setningen er tatt ut, slik at modellen ikke kan lese fasiten av sammendraget.",
  },
  {
    id: "dcf1fc90-9dd0-4a4b-8664-721dc72dae62",
    tittel: "Statsbudsjettet 2027: Æresløn til Mari Boine",
    sammendrag: "Regjeringen foreslår at musikeren Mari Boine får statens æreslønn fra 2027. Æreslønnen gis bare til én kunstner om gangen, er på 200 000 kroner i året og varer livet ut. Forrige mottaker var forfatteren Dag Solstad, som hadde den fra 2011 til 2025.",
    instans: "KUD – nyhet",
    frist: null,
    kategori: "musikk",
    sakstype: "nyhet",
    forventet: "til_orientering",
    sikkerhet: "middels",
    sett: "holdt_utenfor",
    fasit_begrunnelse: "Det er et forslag om æreslønn til én navngitt kunstner, 200 000 kroner. Ordningen finnes fra før, og saken endrer ikke rammevilkår eller åpner en søknad for andre. Derfor ikke ny_mulighet og ikke stor_endring.",
  },
  {
    id: "6b95bdfb-59bb-4186-8643-f9b27671959d",
    tittel: "Kulturrådet: 60 musikkutgivelser får publiseringstilskudd (behandlingsrunde 18. juni 2026)",
    sammendrag: "Kulturrådet gir tilskudd til 60 nye musikkutgivelser gjennom ordningen musikk – publisering, til sammen 5,4 millioner kroner. 130 søknader ble behandlet. Hver utgivelse får 90 000 kroner. Tilskuddet gis etter at musikken er gitt ut, og skal dekke kostnader til innspilling, utgivelse og formidling. Ordningen har løpende søknadsfrist, og utgiveren må søke senest seks måneder etter utgivelsen.",
    instans: "Kulturrådet",
    frist: null,
    kategori: "musikk",
    sakstype: "tildeling",
    forventet: "til_orientering",
    sikkerhet: "middels",
    sett: "holdt_utenfor",
    fasit_begrunnelse: "Behandlingsrunden 18. juni 2026 er avsluttet: 60 utgivelser har fått 90 000 kroner hver. Det er en tildelingsliste. Ordningen har løpende søknadsfrist, men denne saken er ikke en ny runde. Den lagrede teksten sluttet med «Saken er til orientering». Den setningen er tatt ut.",
  },
];

export const FASIT_SAKER: FasitSak[] = [...FASIT_OPPRINNELIG, ...FASIT_HOLDOUT];
