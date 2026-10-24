import { useId, useState, type ReactNode } from "react";
import {
  ORDLISTE,
  ORDLISTE_INNLEDNING,
  ORDLISTE_TITTEL,
  ordlisteAlfabetisk,
  type OrdlisteInnslag,
} from "./innhold/ordliste.ts";
import { type TekstDel } from "./innhold/treff.ts";

function innslag(id: string): OrdlisteInnslag | undefined {
  return ORDLISTE.find((o) => o.id === id);
}

function overskrift(o: OrdlisteInnslag): string {
  if (o.synonymer.length === 0) return o.begrep;
  return `${o.begrep} (${o.synonymer.join(", ")})`;
}

export function Ordforklaring({ id, tekst }: { id: string; tekst: string }) {
  const o = innslag(id);
  const panelId = useId();
  const [festet, setFestet] = useState(false);
  const [over, setOver] = useState(false);
  const apen = festet || over;
  if (!o) return <>{tekst}</>;
  return (
    <span
      className="ord"
      onMouseEnter={() => setOver(true)}
      onMouseLeave={() => setOver(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setFestet(false);
          setOver(false);
        }
      }}
    >
      <button
        type="button"
        className="ord-knapp"
        aria-expanded={apen}
        aria-controls={panelId}
        aria-describedby={apen ? panelId : undefined}
        onClick={() => setFestet((v) => !v)}
      >
        {tekst}
        <span className="sr">, forklaring</span>
      </button>
      {apen ? (
        <span id={panelId} role="note" className="ord-panel">
          {o.forklaring}
          {o.eksempel ? <> Eksempel: {o.eksempel}</> : null}{" "}
          <a href={`/ordliste#${o.id}`}>Se i ordlisten</a>
        </span>
      ) : null}
    </span>
  );
}

export function MerketTekst({ deler }: { deler: TekstDel[] }) {
  const noder: ReactNode[] = [];
  deler.forEach((d, i) => {
    if (d.type === "tekst") noder.push(<span key={i}>{d.tekst}</span>);
    else noder.push(<Ordforklaring key={i} id={d.id} tekst={d.tekst} />);
  });
  return <>{noder}</>;
}

function bokstav(begrep: string): string {
  const c = begrep.charAt(0).toLocaleUpperCase("nb");
  return c === "É" ? "E" : c;
}

export function OrdlisteSide() {
  const liste = ordlisteAlfabetisk();
  const bokstaver = [...new Set(liste.map((o) => bokstav(o.begrep)))];
  return (
    <article className="avis-wrap budsjett ordliste">
      <h1>{ORDLISTE_TITTEL}</h1>
      <p className="kv-ingress">{ORDLISTE_INNLEDNING}</p>
      <nav className="ordliste-nav" aria-label="Bokstaver">
        {bokstaver.map((b) => (
          <a key={b} href={`#bokstav-${b.toLocaleLowerCase("nb")}`}>{b}</a>
        ))}
      </nav>
      {bokstaver.map((b) => (
        <section key={b} id={`bokstav-${b.toLocaleLowerCase("nb")}`} aria-labelledby={`tittel-${b}`}>
          <h2 className="ordliste-bokstav" id={`tittel-${b}`}>{b}</h2>
          {liste.filter((o) => bokstav(o.begrep) === b).map((o) => (
            <article key={o.id} id={o.id} className="ordliste-innslag">
              <h3>{overskrift(o)}</h3>
              <p>{o.forklaring}</p>
              {o.eksempel ? <p className="kilde">Eksempel: {o.eksempel}</p> : null}
            </article>
          ))}
        </section>
      ))}
    </article>
  );
}
