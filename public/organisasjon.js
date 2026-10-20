// Behandlingsansvarlig, verifisert i Enhetsregisteret. Én linje å endre.
export const behandlingsansvarlig = "KULTURVARSLING AS";

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
