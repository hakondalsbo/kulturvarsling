import { eksportTilMottaker, lagEnkelPdf, lagListeTekst, tellerMed, type SignaturForEksport } from "./kjerne.ts";

export function EksportVisning({
  tittel,
  mottaker,
  signaturer,
}: {
  tittel: string;
  mottaker: string;
  signaturer: SignaturForEksport[];
}) {
  const antall = signaturer.filter(tellerMed).length;
  const eksport = eksportTilMottaker(signaturer);
  const tekst = lagListeTekst(tittel, eksport.totalt, eksport.linjer);

  function lastNed() {
    const pdf = lagEnkelPdf(tekst.split("\n"));
    const blob = new Blob([new Uint8Array(pdf)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "felles-innspill.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="mobiliser-kort" id="eksport" data-visning="eksport" data-lenkepunkt="felles-innspill-eksport">
      <p className="mobiliser-merke handling">Felles innspill</p>
      <h2>{tittel}</h2>
      <p className="mobiliser-tall">{antall}</p>
      <p>har signert. Navn vises ikke på kulturvarsling.no.</p>
      <h3>Til {mottaker}</h3>
      <p>Mottakeren får innspillet og denne listen. E-post er ikke med. Innspill med navn kan bli offentlige hos mottakeren.</p>
      <div className="mobiliser-tabell-ramme">
      <table className="mobiliser-tabell">
        <thead>
          <tr>
            <th>Navn</th>
            <th>Rolle</th>
            <th>Organisasjon</th>
            <th>Kommune</th>
          </tr>
        </thead>
        <tbody>
          {eksport.linjer.map((linje) => (
            <tr key={linje.navn}>
              <td>{linje.navn}</td>
              <td>{linje.rolle}</td>
              <td>{linje.organisasjon}</td>
              <td>{linje.kommune}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="mobiliser-note">E-post er ikke med.</p>
      <button type="button" className="kv-knapp linje" onClick={lastNed}>Last ned liste</button>
    </section>
  );
}
