import type { SakGrunnlag, SignaturForEksport, StottetInnspill } from "./kjerne.ts";

export const DEMO_SAK_ID = "demo-horing";
export const DEMO_ORIENTERING_ID = "demo-orientering";

/** Høringslisten på regjeringen.no. Lenken er http(s), så innsending kan vises. */
export const DEMO_KILDE =
  "https://www.regjeringen.no/no/dokument/id2000006/?documenttype=dokumenter/h%C3%B8ringer";

export const DEMO_KUD = "https://www.regjeringen.no/no/dep/kud/id545/";

export type DemoSak = SakGrunnlag & { id: string };

export const DEMO_HORING: DemoSak = {
  id: DEMO_SAK_ID,
  tittel: "Høring om forslag til endringer i kulturloven",
  sammendrag: "Kultur- og likestillingsdepartementet har sendt forslaget på høring. Svar sendes digitalt.",
  instans: "Kultur- og likestillingsdepartementet",
  frist: "2026-11-12",
  kilde: DEMO_KILDE,
  fase: "utredning_horing",
};

export const DEMO_ORIENTERING: DemoSak = {
  id: DEMO_ORIENTERING_ID,
  tittel: "Orientering fra Kultur- og likestillingsdepartementet",
  sammendrag: "Saken er omtalt. Ingen fase er satt.",
  instans: "Kultur- og likestillingsdepartementet",
  frist: null,
  kilde: DEMO_KUD,
  fase: null,
};

export const DEMO_SAKER: DemoSak[] = [DEMO_HORING, DEMO_ORIENTERING];

export const DEMO_FULGTE = [DEMO_SAK_ID, DEMO_ORIENTERING_ID];

export type DemoInnspill = {
  id: string;
  sakId: string;
  tittel: string;
  mottaker: string;
  dato: string;
  tekst: string;
};

export const DEMO_INNSPILL_HORING: DemoInnspill = {
  id: "demo-innspill-horing",
  sakId: DEMO_SAK_ID,
  tittel: "Felles innspill til høringen om kulturloven",
  mottaker: "Kultur- og likestillingsdepartementet",
  dato: "10. november 2026",
  tekst: "Innspillet gjelder høringen. Svaret skal sendes digitalt.",
};

export const DEMO_INNSPILL_STOTTET: DemoInnspill = {
  id: "demo-innspill-stottet",
  sakId: DEMO_ORIENTERING_ID,
  tittel: "Kort merknad til orienteringssaken",
  mottaker: "Kultur- og likestillingsdepartementet",
  dato: "1. desember 2026",
  tekst: "Merknaden er støttet i forhåndsvisningen.",
};

export const DEMO_INNSPILL: DemoInnspill[] = [DEMO_INNSPILL_HORING, DEMO_INNSPILL_STOTTET];

export const DEMO_ALLEREDE_STOTTET: StottetInnspill[] = [
  {
    innspillId: DEMO_INNSPILL_STOTTET.id,
    tittel: DEMO_INNSPILL_STOTTET.tittel,
    sakId: DEMO_INNSPILL_STOTTET.sakId,
    bekreftet: true,
    trukket: false,
  },
];

/**
 * E-post finnes på objektene slik at eksporten kan testes.
 * Visningen skal bruke eksportTilMottaker, som ikke tar med e-post.
 */
export const DEMO_SIGNATURER: SignaturForEksport[] = [
  {
    navn: "Demo Berg",
    epost: "berg@example.test",
    rolle: "Daglig leder",
    organisasjonsnavn: "Eksempelteateret",
    kommune: "Bergen",
    samtykkeGittTid: "2026-10-24T10:00:00Z",
    bekreftetTid: "2026-10-24T10:05:00Z",
    trukketTid: null,
    trekkForespurtTid: null,
  },
  {
    navn: "Demo Lie",
    epost: "lie@example.test",
    rolle: null,
    organisasjonsnavn: null,
    kommune: "Oslo",
    samtykkeGittTid: "2026-10-24T11:00:00Z",
    bekreftetTid: "2026-10-24T11:04:00Z",
    trukketTid: null,
    trekkForespurtTid: null,
  },
  {
    navn: "Demo Aasen",
    epost: "aasen@example.test",
    rolle: null,
    organisasjonsnavn: null,
    kommune: "Trondheim",
    samtykkeGittTid: "2026-10-24T12:00:00Z",
    bekreftetTid: null,
    trukketTid: null,
    trekkForespurtTid: null,
  },
];

export const DEMO_DATO = new Date("2026-10-24T12:00:00+02:00");

export const DEMO_BRUKER = "Demo Berg";
