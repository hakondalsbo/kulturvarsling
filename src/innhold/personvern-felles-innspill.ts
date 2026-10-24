import { PERSONVERN_EPOST } from "../../supabase/functions/_shared/mobilisering-kjerne.ts";

/**
 * UTKAST til tillegg på /personvern.
 * Ligger ikke i public/personvern.html.
 * Vises bare når visningen for MOBILISERING_SIGNATUR_AKTIV er på
 * (Vercel-preview eller VITE_MOBILISER_DEMO). Prod-teksten endres ikke.
 * Samme flagg som signeringen, ikke et eget flagg.
 */

export const PERSONVERN_FELLES_TITTEL = "Felles innspill og signaturer";

export const PERSONVERN_FELLES_AVSNITT = [
  "Når du signerer et felles innspill, lagrer vi navnet ditt, e-postadressen din og det du velger å oppgi om rolle, organisasjon og kommune. Vi lagrer også når du ga samtykke og hvilken tekst du godtok. Grunnlaget er ditt uttrykkelige samtykke (personvernforordningen art. 6 nr. 1 a og art. 9 nr. 2 a), fordi en signatur kan vise et politisk standpunkt.",
  "Hva vi deler: Innspillet og navn, rolle eller organisasjon og kommune sendes til mottakeren som står på kampanjen. Høringssvar og innspill blir ofte offentlige hos mottakeren. E-postadressen din deler vi aldri. På kulturvarsling.no viser vi bare hvor mange som har signert.",
  "Hvor lenge: E-post slettes 30 dager etter innsending. Navnelisten slettes 12 måneder etter innsending, og innspill som aldri blir sendt slettes 12 måneder etter at kampanjen er avsluttet.",
  `Dine rettigheter: Du kan trekke signaturen din helt til innspillet er sendt, og be om innsyn, retting eller sletting. Vi kan ikke slette det mottakeren allerede har fått, men vi kan sende dem beskjed om at du har trukket deg. Ansvarlig er Kulturvarsling AS (org.nr. 936 282 881), ${PERSONVERN_EPOST}. Du kan klage til Datatilsynet.`,
  "Alder: Du må være minst 16 år for å signere.",
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
