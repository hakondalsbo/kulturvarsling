import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { Blokk, Inline, Tabell } from "./innhold/statsbudsjett2027.ts";
import {
  INNSPILL_FRIST_ISO,
  finnInnspill,
  erIngressEtikett,
  h1Tekst,
  ingressTekst,
  innspillFristPassert,
  parseDokument,
  renInline,
} from "./innhold/statsbudsjett2027.ts";
import kilde from "./innhold/statsbudsjett2027.md?raw";
import "./statsbudsjett.css";

const dok = parseDokument(kilde);
const innspill = finnInnspill(dok);

let opprinneligMeta: { tittel: string; beskrivelse: string | null } | null = null;

export function settStatsbudsjettMeta() {
  const meta = document.querySelector('meta[name="description"]');
  if (!opprinneligMeta) {
    opprinneligMeta = {
      tittel: document.title,
      beskrivelse: meta?.getAttribute("content") ?? null,
    };
  }
  document.title = h1Tekst(dok);
  meta?.setAttribute("content", ingressTekst(dok));
}

function nullstillMeta() {
  if (!opprinneligMeta) return;
  document.title = opprinneligMeta.tittel;
  if (opprinneligMeta.beskrivelse != null) {
    document.querySelector('meta[name="description"]')?.setAttribute("content", opprinneligMeta.beskrivelse);
  }
}

function useNå() {
  const [nå, setNå] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNå(new Date()), 30_000);
    const vedSyn = () => {
      if (document.visibilityState === "visible") setNå(new Date());
    };
    document.addEventListener("visibilitychange", vedSyn);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", vedSyn);
    };
  }, []);
  return nå;
}

function InlineVis({ barn }: { barn: Inline[] }) {
  return barn.map((del, i) => {
    if (del.type === "tekst") return <Fragment key={i}>{del.tekst}</Fragment>;
    if (del.type === "strong") return <strong key={i}><InlineVis barn={del.barn} /></strong>;
    if (del.type === "em") return <em key={i}><InlineVis barn={del.barn} /></em>;
    return <a key={i} href={del.href}>{del.tekst}</a>;
  });
}

function erTallkolonne(navn: string) {
  return navn === "2026" || navn === "2027" || navn === "Endring";
}

function TabellVis({ tabell }: { tabell: Tabell }) {
  const ramme = useRef<HTMLDivElement>(null);
  const captionId = useId();
  const [ruller, setRuller] = useState(false);
  useEffect(() => {
    const el = ramme.current;
    if (!el) return;
    const mal = () => setRuller(el.scrollWidth > el.clientWidth + 1);
    mal();
    const obs = new ResizeObserver(mal);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  if (tabell.rader.length === 0) return null;
  const caption = renInline(tabell.caption);
  return (
    <div
      ref={ramme}
      className="sb-tabell-ramme"
      tabIndex={ruller ? 0 : undefined}
      role={ruller ? "region" : undefined}
      aria-labelledby={ruller ? captionId : undefined}
    >
      <table className={tabell.kolonner.length > 5 ? "sb-tabell bred" : "sb-tabell"}>
        <caption id={captionId}>
          {caption}
          {tabell.innledning ? <span className="sb-caption-inn"><InlineVis barn={tabell.innledning} /></span> : null}
        </caption>
        <thead>
          <tr>
            {tabell.kolonner.map((kol) => (
              <th key={kol} scope="col" className={erTallkolonne(kol) ? "tall" : undefined}>{kol}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabell.rader.map((rad) => (
            <tr key={rad.join("|")}>
              {rad.map((celle, ci) => (
                ci === 0
                  ? <th key={ci} scope="row">{celle}</th>
                  : <td key={ci} className={erTallkolonne(tabell.kolonner[ci] ?? "") ? "tall" : undefined}>{celle}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlokkVis({ b, ingress = false }: { b: Blokk; ingress?: boolean }) {
  if (b.type === "h") {
    if (b.niva === 1) return <h1><InlineVis barn={b.barn} /></h1>;
    if (b.niva === 2) return <h2><InlineVis barn={b.barn} /></h2>;
    if (b.niva === 3) return <h3><InlineVis barn={b.barn} /></h3>;
    return <h4><InlineVis barn={b.barn} /></h4>;
  }
  if (b.type === "p") return <p className={ingress ? "sb-ingress" : undefined}><InlineVis barn={b.barn} /></p>;
  if (b.type === "ul") {
    return (
      <ul>
        {b.punkter.map((punkt, i) => <li key={i}><InlineVis barn={punkt} /></li>)}
      </ul>
    );
  }
  return <TabellVis tabell={b} />;
}

export function FristMerke({ nå }: { nå: Date }) {
  const passert = innspillFristPassert(nå);
  return (
    <div className={passert ? "sb-frist er-passert" : "sb-frist"}>
      <p className="sb-frist-dato" aria-hidden="true">28<small>okt</small></p>
      <div>
        <p className="sb-frist-status">{passert ? "Fristen er passert" : "Skriftlig innspill"}</p>
        <p className="sb-frist-tekst">
          <time dateTime={INNSPILL_FRIST_ISO}>{innspill.ledetekst}</time>
        </p>
        {passert ? null : (
          <a className="avis-btn sb-frist-knapp" href={innspill.href}>{innspill.lenkeTekst}</a>
        )}
      </div>
    </div>
  );
}

export function StatsbudsjettInngang() {
  const nå = useNå();
  return (
    <section className="sb-inngang" aria-labelledby="sb-inngang-tittel">
      <div className="avis-wrap sb-inngang-rad">
        <div>
          <h2 id="sb-inngang-tittel">
            <a href="/statsbudsjett">{h1Tekst(dok)}</a>
          </h2>
          <p>{ingressTekst(dok)}</p>
        </div>
        <FristMerke nå={nå} />
      </div>
    </section>
  );
}

export function StatsbudsjettSide() {
  const nå = useNå();
  useEffect(() => {
    settStatsbudsjettMeta();
    return () => nullstillMeta();
  }, []);
  return (
    <div className="avis sb">
      <header className="avis-mast">
        <a className="avis-tittel sb-logo" href="/app">Kultur<span>varsling</span></a>
        <p className="avis-under">Kulturpolitikken, før den er vedtatt.</p>
      </header>
      <main className="avis-wrap sb-main">
        <p className="sb-tilbake"><a href="/app">Til forsiden</a></p>
        {dok.blokker.map((b, i) => {
          if (erIngressEtikett(b)) return null;
          const ingress = b.type === "p" && i > 0 && erIngressEtikett(dok.blokker[i - 1]);
          return (
            <Fragment key={i}>
              <BlokkVis b={b} ingress={ingress} />
              {ingress ? <FristMerke nå={nå} /> : null}
            </Fragment>
          );
        })}
      </main>
      <footer className="avis-fot">
        <div className="avis-wrap avis-fot-rad">
          <div>© {new Date().getFullYear()} Åndsverkstedet AS</div>
          <div><a href="/personvern">Personvern</a></div>
        </div>
      </footer>
    </div>
  );
}
