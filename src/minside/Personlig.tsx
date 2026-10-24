import { Knapp } from "../ui.tsx";
import type { Forslag, ForslagSak, SnarveiId } from "./forslag.ts";
import "./minside.css";

export function PersonligFelt({
  forslag,
  her,
  kompakt = false,
  onGå,
  onVarsler,
  onÅpne,
  onFolg,
}: {
  forslag: Forslag;
  her: SnarveiId;
  kompakt?: boolean;
  onGå: (id: "forside" | "minside" | "mobiliser" | "kampanjer") => void;
  onVarsler: () => void;
  onÅpne?: (sakId: string | number, fane: "horingssvar" | "kampanje" | "mobiliser") => void;
  onFolg?: (sakId: string | number) => void;
}) {
  return (
    <section className="personlig" aria-labelledby="forslag-til-deg" data-personlig={her}>
      <div className="avis-wrap personlig-ark">
        <p className="kv-steg">Forslag til deg</p>
        <h2 id="forslag-til-deg">Tilpasset det du følger</h2>
        <p className="personlig-setning">{forslag.setning}</p>
        {forslag.folger.length > 0 ? (
          <ul className="personlig-chips" aria-label="Det du følger">
            {forslag.folger.map((navn) => <li key={navn}>{navn}</li>)}
          </ul>
        ) : null}
        <Snarveier forslag={forslag} her={her} onGå={onGå} onVarsler={onVarsler} />
        {!kompakt && forslag.saker.length > 0 ? (
          <ul className="personlig-saker">
            {forslag.saker.map((sak) => (
              <ForslagRad key={sak.id} sak={sak} onÅpne={onÅpne} onFolg={onFolg} />
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function Snarveier({
  forslag,
  her,
  onGå,
  onVarsler,
}: {
  forslag: Forslag;
  her: SnarveiId;
  onGå: (id: "forside" | "minside" | "mobiliser" | "kampanjer") => void;
  onVarsler: () => void;
}) {
  return (
    <nav className="personlig-snarveier" aria-label="Sammenhengen">
      {forslag.snarveier.map((s) => {
        const herNå = s.id === her;
        return (
          <Knapp
            key={s.id}
            variant={herNå ? "linje" : "stille"}
            aria-current={herNå ? "page" : undefined}
            onClick={() => {
              if (s.id === "varsler") onVarsler();
              else if (s.id === "innspill") onGå("kampanjer");
              else onGå(s.id);
            }}
          >
            {s.label}
          </Knapp>
        );
      })}
    </nav>
  );
}

function ForslagRad({
  sak,
  onÅpne,
  onFolg,
}: {
  sak: ForslagSak;
  onÅpne?: (sakId: string | number, fane: "horingssvar" | "kampanje" | "mobiliser") => void;
  onFolg?: (sakId: string | number) => void;
}) {
  return (
    <li className="personlig-sak">
      <p className="kv-steg">{sak.handling ? "▸ Du kan gjøre noe" : "– Til orientering"}</p>
      <h3>{sak.tittel}</h3>
      <p className="personlig-meta">{sak.instans}</p>
      {sak.kampanjeTittel ? <p className="personlig-meta">Felles innspill: {sak.kampanjeTittel}</p> : null}
      <div className="minside-rad">
        <Knapp onClick={() => onÅpne?.(sak.id, "horingssvar")}>Skriv innspill</Knapp>
        {sak.kampanjeTittel ? (
          <Knapp variant="linje" onClick={() => onÅpne?.(sak.id, "kampanje")}>Støtt innspill</Knapp>
        ) : null}
        {sak.handling ? (
          <Knapp variant="stille" onClick={() => onÅpne?.(sak.id, "mobiliser")}>Mobiliser</Knapp>
        ) : null}
        {onFolg ? (
          <Knapp variant="stille" onClick={() => onFolg(sak.id)}>Følg saken</Knapp>
        ) : null}
      </div>
    </li>
  );
}
