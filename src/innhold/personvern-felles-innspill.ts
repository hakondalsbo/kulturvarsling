import { PERSONVERN_EPOST } from "../../supabase/functions/_shared/mobilisering-kjerne.ts";

/**
 * Tekst for felles innspill. Samme regler står i public/personvern.html.
 * Vite-pluginen injiserer HTML-en bare når id="felles-innspill" mangler,
 * så prodfilen ikke får avsnittet to ganger.
 */

export const PERSONVERN_FELLES_TITTEL = "Felles innspill og signaturer";

export const PERSONVERN_FELLES_AVSNITT = [
  "Når du signerer et felles innspill, lagrer vi navnet ditt, e-postadressen din og det du velger å oppgi om rolle, organisasjon og kommune. Vi lagrer også når du ga samtykke og hvilken tekst du godtok. Grunnlaget er ditt uttrykkelige samtykke (personvernforordningen art. 6 nr. 1 a og art. 9 nr. 2 a), fordi en signatur kan vise et politisk standpunkt.",
  "Hva vi deler: Innspillet og navn, rolle eller organisasjon og kommune sendes til mottakeren som står på kampanjen. Høringssvar og innspill blir ofte offentlige hos mottakeren. E-postadressen din deler vi aldri. På kulturvarsling.no viser vi bare hvor mange som har signert.",
  "Hvor lenge: E-post skal bort 30 dager etter innsending. Navnelisten skal bort 12 måneder etter innsending. Et innspill som verken blir sendt eller merket avsluttet, får begge fristene 12 måneder etter at signaturen ble opprettet. Er det avsluttet uten å bli sendt, er fristen 12 måneder etter avslutningen. Nattjobben teller. Den sletter ikke før tellingen er sjekket.",
  `Dine rettigheter: Trekker du signaturen, sletter vi med en gang navn, e-post og det du har skrevet om deg selv, i vår kopi. Er innspillet allerede sendt, kan vi ikke slette det mottakeren har fått. Ansvarlig er Kulturvarsling AS (org.nr. 936 282 881), ${PERSONVERN_EPOST}. Du kan klage til Datatilsynet.`,
  "Alder: Du bekrefter selv at du er minst 16 år. Vi sjekker ikke alderen.",
] as const;

export function personvernTilleggHtml(): string {
  const avsnitt = PERSONVERN_FELLES_AVSNITT.map((tekst) => {
    const medPost = tekst.replaceAll(
      PERSONVERN_EPOST,
      `<a href="mailto:${PERSONVERN_EPOST}">${PERSONVERN_EPOST}</a>`,
    );
    return `    <p>${medPost}</p>`;
  }).join("\n");
  return `    <section id="felles-innspill" class="org">
    <p class="versal">Utkast – ikke i produksjon</p>
    <h2>${PERSONVERN_FELLES_TITTEL}</h2>
${avsnitt}
    </section>`;
}
