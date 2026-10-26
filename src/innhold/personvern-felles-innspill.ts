import { PERSONVERN_EPOST, SAMTYKKE_MAL } from "../../supabase/functions/_shared/mobilisering-kjerne.ts";

/**
 * Tekst for felles innspill. Samme regler står i public/personvern.html.
 * Vite-pluginen injiserer HTML-en bare når id="felles-innspill" mangler,
 * så prodfilen ikke får avsnittet to ganger.
 */

export const PERSONVERN_FELLES_TITTEL = "Felles innspill og signaturer";

export const PERSONVERN_FELLES_AVSNITT = [
  "Felles innspill tas imot av funksjonen signer-innspill. Appen skriver ikke signaturen rett i databasen, og signering av kampanjer i appen er ikke åpen. Mottaket er stengt. Når det er åpent, lagrer vi navnet ditt, e-postadressen din og det du velger å oppgi om rolle, organisasjon og kommune, og når du ga samtykke. Grunnlaget er ditt uttrykkelige samtykke (personvernforordningen art. 6 nr. 1 a og art. 9 nr. 2 a), fordi en signatur kan vise et politisk standpunkt.",
  SAMTYKKE_MAL,
  "Hva vi deler: Innspillet og navn, rolle eller organisasjon og kommune sendes til mottakeren som står på innspillet. Høringssvar og innspill blir ofte offentlige hos mottakeren. E-postadressen din deler vi aldri. På kulturvarsling.no viser vi bare hvor mange som har signert.",
  "Hvor lenge: E-postadressen slettes 30 dager etter innsending, og navnet 12 måneder etter innsending. Blir innspillet ikke sendt, slettes alt 12 måneder etter at det ble avsluttet, eller 12 måneder etter at du signerte hvis det aldri avsluttes. Sletting etter fristen er ikke slått på. Tellingen, når den kjører, skriver bare antall.",
  `Dine rettigheter: Lenken i e-posten trekker signaturen, også når nye signaturer er stengt. Den sletter navn, e-post, det du har skrevet om deg selv, og koblingen til kontoen, i vår kopi. Er innspillet allerede sendt, kan det ikke hentes tilbake fra mottakeren. Ansvarlig er Kulturvarsling AS (org.nr. 936 282 881), ${PERSONVERN_EPOST}. Du kan klage til Datatilsynet.`,
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
