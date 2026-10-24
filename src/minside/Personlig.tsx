import type { BoksLinje } from "./forslag.ts";
import "./minside.css";

function datoKort(iso: string | null): string {
  if (!iso) return "Ingen frist";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "Ingen frist";
  return d.toLocaleDateString("nb-NO", { day: "numeric", month: "long" });
}

/** Én avgrenset boks over avisen. Avisen under røres ikke. */
export function FolgeBoks({
  linjer,
  onMinSide,
  onÅpne,
}: {
  linjer: BoksLinje[];
  onMinSide: () => void;
  onÅpne: (id: string | number) => void;
}) {
  return (
    <section className="folge-boks" aria-labelledby="saker-du-folger" data-personlig="forside">
      <h2 id="saker-du-folger">Saker du følger</h2>
      {linjer.length === 0 ? (
        <p className="folge-tom">Ingenting er valgt ennå.</p>
      ) : (
        <ul className="folge-liste">
          {linjer.map((linje) => (
            <li key={linje.id}>
              <button type="button" className="folge-linje" onClick={() => onÅpne(linje.id)}>
                <span className="folge-tittel">{linje.tittel}</span>
                <span className="folge-meta">
                  <span className="frist">{datoKort(linje.frist)}</span>
                  <span>{linje.rolle === "handling" ? "Du kan gjøre noe" : "Til orientering"}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="kv-lenke folge-alt" onClick={onMinSide}>Se alt på Min side</button>
    </section>
  );
}
