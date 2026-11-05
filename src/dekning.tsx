import { Fragment, useEffect } from "react";
import kilde from "./innhold/hva-vi-dekker.md?raw";
import { erTallavsnitt, parseDekning, type Blokk, type Inline } from "./innhold/hva-vi-dekker.ts";

const dok = parseDekning(kilde);

function InlineVis({ barn }: { barn: Inline[] }) {
  return barn.map((del, i) =>
    del.type === "tekst" ? (
      <Fragment key={i}>{del.tekst}</Fragment>
    ) : (
      <strong key={i}>
        <InlineVis barn={del.barn} />
      </strong>
    ),
  );
}

function Avsnitt({ b, innledning }: { b: Extract<Blokk, { type: "p" }>; innledning: boolean }) {
  const klasse = [
    innledning ? "dekning-innledning" : "",
    erTallavsnitt(b.barn) ? "dekning-tall" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <p className={klasse || undefined}>
      <InlineVis barn={b.barn} />
    </p>
  );
}

function Liste({ b }: { b: Extract<Blokk, { type: "ul" }> }) {
  return (
    <ul>
      {b.punkter.map((punkt, i) => (
        <li key={i}>
          <InlineVis barn={punkt} />
        </li>
      ))}
    </ul>
  );
}

export function DekningSide() {
  useEffect(() => {
    const forrige = document.title;
    document.title = "Hva vi dekker – Kulturvarsling";
    return () => {
      document.title = forrige;
    };
  }, []);

  const forsteAvsnitt = dok.findIndex((b) => b.type === "p");
  return (
    <article className="avis-wrap dekning">
      {dok.map((b, i) => {
        if (b.type === "h" && b.niva === 1) return <h1 key={i}>{b.tekst}</h1>;
        if (b.type === "h") return <h2 key={i}>{b.tekst}</h2>;
        if (b.type === "ul") return <Liste key={i} b={b} />;
        return <Avsnitt key={i} b={b} innledning={i === forsteAvsnitt} />;
      })}
    </article>
  );
}
