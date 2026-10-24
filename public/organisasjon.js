// Behandlingsansvarlig, verifisert i Enhetsregisteret (org.nr. 936 282 881).
// Skrivemåten er bekreftet som «Kulturvarsling AS». Registeret viser navnet i versaler.
// Samme tre verdier som supabase/functions/_shared/organisasjon.ts.
// Testen i samtykke.test.ts holder dem like. Endre begge steder.
export const behandlingsansvarlig = "Kulturvarsling AS";

export const orgnr = "936 282 881";
export const poststed = "Oslo";

const felter = { behandlingsansvarlig, orgnr, poststed };

if (typeof document !== "undefined") {
  const fyll = () => {
    for (const el of document.querySelectorAll("[data-org]")) {
      const nokkel = el.getAttribute("data-org");
      if (nokkel && felter[nokkel]) el.textContent = felter[nokkel];
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fyll);
  else fyll();
}
