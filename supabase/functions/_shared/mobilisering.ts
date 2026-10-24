// Bekreftelsesbrev for felles innspill. Sender ingenting selv.
// UTSENDING_AKTIV og nyhetsbrev/send-bekreftelser røres ikke.

import { utsendingErAktiv } from "./samtykke.ts";
import {
  PERSONVERN_EPOST,
  signaturMottakAktiv,
} from "./mobilisering-kjerne.ts";

export type SignaturBrev = {
  emne: string;
  html: string;
  tekst: string;
  send: false | true;
};

function escapeHtml(verdi: string): string {
  return verdi
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Bygges alltid. send er true bare når både signaturmottaket og den
 * eksisterende utsendingen er slått på. Test og preview får send: false.
 */
export function byggSignaturBrev(input: {
  bekreftLenke: string;
  trekkLenke: string;
  mottaker: string;
  utsending: string | null | undefined;
  signatur: string | null | undefined;
}): SignaturBrev {
  const send = signaturMottakAktiv(input.signatur) && utsendingErAktiv(input.utsending);
  const bekreft = escapeHtml(input.bekreftLenke);
  const trekk = escapeHtml(input.trekkLenke);
  const hvem = escapeHtml(input.mottaker);
  const post = escapeHtml(PERSONVERN_EPOST);
  const emne = "Bekreft signaturen på felles innspill";
  const tekst = [
    `Bekreft at du vil signere innspillet til ${input.mottaker}.`,
    "Signaturen teller ikke før du har åpnet bekreftelseslenken.",
    input.bekreftLenke,
    "",
    "Du kan trekke signaturen helt til innspillet er sendt:",
    input.trekkLenke,
    "",
    "E-postadressen din deles aldri.",
    `Spørsmål om personvern: ${PERSONVERN_EPOST}`,
  ].join("\n");
  const html = `<!doctype html><html lang="no"><body style="font-family:Georgia,serif;background:#FBF8F2;color:#1C1B19;padding:32px;">
    <p>Bekreft at du vil signere innspillet til ${hvem}.</p>
    <p>Signaturen teller ikke før du har åpnet lenken.</p>
    <p><a href="${bekreft}">Bekreft signaturen</a></p>
    <p>Du kan trekke signaturen helt til innspillet er sendt.</p>
    <p><a href="${trekk}">Trekk signaturen</a></p>
    <p style="color:#6B665C;font-size:14px;">E-postadressen din deles aldri.</p>
    <p style="color:#6B665C;font-size:14px;">Spørsmål om personvern: <a href="mailto:${post}">${post}</a></p>
  </body></html>`;
  return { emne, html, tekst, send };
}
