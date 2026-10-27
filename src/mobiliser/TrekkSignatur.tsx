import { useEffect, useRef, useState } from "react";
import { PERSONVERN_EPOST } from "./kjerne.ts";
import {
  kallTrekk,
  skalKalleTrekk,
  trekkTekst,
  trekkToken,
  type TrekkHent,
  type TrekkTilstand,
} from "./trekk.ts";

export function TrekkSignatur({
  soke = window.location.search,
  kall = kallTrekk,
}: {
  soke?: string;
  kall?: (token: string, hent?: TrekkHent) => Promise<TrekkTilstand>;
} = {}) {
  const [tilstand, setTilstand] = useState<TrekkTilstand>(trekkToken(soke) ? "bekreft" : "ugyldig");
  const tekst = trekkTekst(tilstand);
  const trekkKnapp = useRef<HTMLButtonElement>(null);
  const proveKnapp = useRef<HTMLButtonElement>(null);
  const overskrift = useRef<HTMLHeadingElement>(null);
  const opptatt = useRef(false);
  const start = useRef(tilstand);

  useEffect(() => {
    const forrigeTittel = document.title;
    document.title = "Trekk signaturen – Kulturvarsling";
    const finnes = document.querySelector('meta[name="referrer"]');
    const meta = finnes ?? document.createElement("meta");
    const laget = finnes == null;
    if (laget) {
      meta.setAttribute("name", "referrer");
      document.head.appendChild(meta);
    }
    const forrigeReferer = meta.getAttribute("content");
    meta.setAttribute("content", "no-referrer");
    return () => {
      document.title = forrigeTittel;
      if (laget) meta.remove();
      else if (forrigeReferer == null) meta.removeAttribute("content");
      else meta.setAttribute("content", forrigeReferer);
    };
  }, []);

  useEffect(() => {
    if (tilstand === "sender") return;
    if (tilstand === start.current && tilstand === "bekreft") {
      trekkKnapp.current?.focus();
      return;
    }
    if (tilstand !== start.current && trekkTekst(tilstand).visProveIgjen) {
      proveKnapp.current?.focus();
      return;
    }
    overskrift.current?.focus();
  }, [tilstand]);

  async function trekk() {
    const token = trekkToken(soke);
    if (token == null || !skalKalleTrekk(token, tilstand) || opptatt.current) return;
    opptatt.current = true;
    setTilstand("sender");
    try {
      setTilstand(await kall(token));
    } catch {
      setTilstand("nett");
    } finally {
      opptatt.current = false;
    }
  }

  return (
    <section className="mobiliser-kort mobiliser-trekk" aria-busy={tilstand === "sender"} aria-labelledby="trekk-overskrift">
      <p className="mobiliser-merke orientering">Felles innspill</p>
      <h1 id="trekk-overskrift" tabIndex={-1} ref={overskrift}>{tekst.overskrift}</h1>
      <p id="trekk-status" className="mobiliser-trekk-status" role="status" aria-live="polite" aria-atomic="true" data-tilstand={tekst.slag}>
        {tekstMedEpost(tekst.status)}
      </p>
      <div className="mobiliser-lenker">
        {tekst.visTrekk && (
          <button
            type="button"
            className="kv-knapp"
            ref={trekkKnapp}
            autoFocus
            onClick={trekk}
            disabled={tilstand === "sender"}
            aria-describedby="trekk-status"
          >
            {tilstand === "sender" ? "Trekker signaturen" : "Trekk signaturen"}
          </button>
        )}
        {tekst.visProveIgjen && (
          <button type="button" className="kv-knapp" ref={proveKnapp} onClick={trekk}>
            Prøv igjen
          </button>
        )}
        <a href="/personvern" rel="noreferrer">Personvernerklæringen</a>
      </div>
    </section>
  );
}

function tekstMedEpost(tekst: string) {
  const biter = tekst.split(PERSONVERN_EPOST);
  if (biter.length === 1) return tekst;
  return biter.map((bit, i) => (
    <span key={i}>
      {bit}
      {i < biter.length - 1 && (
        <a href={`mailto:${PERSONVERN_EPOST}`} rel="noreferrer">{PERSONVERN_EPOST}</a>
      )}
    </span>
  ));
}
