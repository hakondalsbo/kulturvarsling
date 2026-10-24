import { synligeStotte, type StottetInnspill } from "./stotte.ts";
import "./mobiliser.css";

/**
 * Boks til Min side i PR #33. Denne PR-en rendrer ikke /min-side.
 * Monter den der #stottet skal lande:
 * <StottetInnspill innlogget={!!user} innspill={stotteFraSvar(svar)} />
 * Mens MOBILISERING_SIGNATUR_AKTIV er av, er mine-innspill en tom liste.
 */
export function StottetInnspill({
  innlogget,
  innspill,
  aapent = false,
}: {
  innlogget: boolean;
  innspill: StottetInnspill[];
  aapent?: boolean;
}) {
  const synlige = synligeStotte(innspill, innlogget);
  return (
    <section id="stottet" className="mobiliser-kort" data-koble="mine-innspill" data-lenkepunkt="stottet" aria-labelledby="stottet-tittel">
      <h2 id="stottet-tittel">Innspill du har støttet</h2>
      {!innlogget && <p>Listen vises når du er innlogget.</p>}
      {innlogget && !aapent && <p className="mobiliser-note">Felles innspill åpner snart. Ingenting kan signeres ennå.</p>}
      {innlogget && aapent && synlige.length === 0 && <p className="mobiliser-note">Du har ingen bekreftede innspill som fortsatt teller.</p>}
      {innlogget && aapent && synlige.length > 0 && (
        <ul className="kv-liste">
          {synlige.map((rad) => (
            <li key={rad.innspillId} className="kv-rad">
              <p>{rad.tittel}</p>
              <p className="mobiliser-note">Bekreftet. Navnet vises ikke her.</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export { stotteFraSvar } from "./stotte.ts";