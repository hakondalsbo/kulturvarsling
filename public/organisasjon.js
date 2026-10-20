// Én linje. Bytt ut plassholderen med Åndsverkstedet AS eller Kulturvarsling AS.
export const behandlingsansvarlig = "[PLASSHOLDER – fyll inn juridisk navn]";

export const orgnr = "[PLASSHOLDER – fyll inn org.nr.]";

const felter = { behandlingsansvarlig, orgnr };

if (typeof document !== "undefined") {
  const fyll = () => {
    for (const el of document.querySelectorAll("[data-org]")) {
      const nokkel = el.getAttribute("data-org");
      if (nokkel && felter[nokkel]) el.textContent = felter[nokkel];
    }
    const erPlassholder = behandlingsansvarlig.includes("PLASSHOLDER")
      || orgnr.includes("PLASSHOLDER");
    const varsel = document.querySelector("#org-varsel");
    if (varsel) varsel.hidden = !erPlassholder;
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fyll);
  else fyll();
}
