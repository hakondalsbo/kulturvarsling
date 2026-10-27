import { useState } from "react";
import { Rollemerke } from "./avis.tsx";
import { DEMO_MUNTLIG, DEMO_SAK, DEMO_SKRIFTLIG } from "./horing.ts";
import { HoringFristBlokker, HoringOmSak } from "./horing.tsx";
import { Felt, Knapp, Tekstfelt, Velger } from "./ui.tsx";

const NÅ = new Date("2026-10-24T12:00:00+02:00");

/**
 * Komponentoversikt på /design. Tilstandene hover, fokus og aktiv er
 * tegnet med egne klasser, så de synes uten musepeker. Ekte :hover,
 * :focus-visible og :active gjelder når noen bruker kontrollene.
 */
export function DesignSide() {
  const [fane, setFane] = useState("saken");
  const [filter, setFilter] = useState("alle");
  const [fag, setFag] = useState<string[]>(["musikk"]);
  const [frekvens, setFrekvens] = useState("ukentlig");
  return (
    <article className="avis-wrap kv-galleri">
      <h1>Komponenter</h1>
      <p className="kv-ingress">Kontrollene slik de brukes i avisen. Samme klasser som på sidene.</p>

      <section aria-labelledby="galleri-knapper">
        <h2 id="galleri-knapper" className="kv-undertittel">Knapper</h2>
        <p className="kv-meta">Vanlig, linje, stille og fare.</p>
        <div className="kv-klynge">
          <Knapp>Primær</Knapp>
          <Knapp variant="linje">Linje</Knapp>
          <Knapp variant="stille">Stille</Knapp>
          <Knapp variant="fare">Fare</Knapp>
        </div>
        <p className="kv-meta">Inaktiv, hover, fokus, aktiv og laster.</p>
        <div className="kv-klynge">
          <Knapp disabled>Inaktiv</Knapp>
          <Knapp className="vis-hover">Hover</Knapp>
          <Knapp className="vis-fokus">Fokus</Knapp>
          <Knapp className="vis-aktiv">Aktiv</Knapp>
          <button type="button" className="kv-knapp laster"><i aria-hidden="true" />Laster</button>
        </div>
      </section>

      <section aria-labelledby="galleri-lenker">
        <h2 id="galleri-lenker" className="kv-undertittel">Lenker</h2>
        <p>
          <a className="kv-lenke" href="/ordliste">Ordliste</a>
          {" · "}
          <a className="kv-lenke" href="/personvern">Personvern</a>
          {" · "}
          <a className="kv-lenke" href="/statsbudsjett">Statsbudsjettet</a>
        </p>
      </section>

      <section aria-labelledby="galleri-faner">
        <h2 id="galleri-faner" className="kv-undertittel">Faner og filtre</h2>
        <div className="kv-faner" role="tablist" aria-label="Eksempel på faner">
          {[
            ["saken", "Saken"],
            ["innspill", "Skriv innspill"],
            ["mobiliser", "Mobiliser"],
          ].map(([id, label]) => (
            <button type="button" role="tab" key={id} aria-selected={fane === id} onClick={() => setFane(id)}>{label}</button>
          ))}
        </div>
        <div className="kv-valg" aria-label="Filter">
          {[
            ["alle", "Alle fag"],
            ["musikk", "Musikk"],
            ["scene", "Scenekunst"],
          ].map(([id, label]) => (
            <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
      </section>

      <section aria-labelledby="galleri-merker">
        <h2 id="galleri-merker" className="kv-undertittel">Merker</h2>
        <p className="kv-meta">Tekst og tegn skiller sakstypene. Fargen er tillegg.</p>
        <Rollemerke sak={{ id: "h", handling: "handling_mulig", frist: "2026-10-28" }} nå={NÅ} />
        <Rollemerke sak={{ id: "o", handling: "bare_orientering" }} nå={NÅ} />
      </section>

      <section aria-labelledby="galleri-skjema">
        <h2 id="galleri-skjema" className="kv-undertittel">Skjema</h2>
        <Felt id="galleri-epost" label="E-postadresse" type="email" placeholder="E-postadresse" />
        <Tekstfelt id="galleri-tekst" label="Innspill" rows={4} placeholder="Skriv innspillet her" />
        <Velger id="galleri-fylke" label="Fylke" defaultValue="03">
          <option value="03">Oslo</option>
          <option value="46">Vestland</option>
        </Velger>
        <label className="kv-samtykke">
          <input type="checkbox" defaultChecked />
          <span>Jeg har lest personvernerklæringen.</span>
        </label>
        <p className="kv-feltnavn">Fagområde</p>
        <div className="kv-valg">
          {[
            ["musikk", "Musikk"],
            ["dans", "Dans"],
            ["film", "Film og TV"],
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-pressed={fag.includes(id)}
              onClick={() => setFag((nåværende) => nåværende.includes(id) ? nåværende.filter((x) => x !== id) : [...nåværende, id])}
            >{label}</button>
          ))}
        </div>
      </section>

      <section aria-labelledby="galleri-horing">
        <h2 id="galleri-horing" className="kv-undertittel">Komitéhøring</h2>
        <div className="kv-stakk">
          <Rollemerke sak={DEMO_SKRIFTLIG} nå={NÅ} />
          <HoringFristBlokker sak={DEMO_SKRIFTLIG} />
        </div>
        <div className="kv-stakk">
          <Rollemerke sak={DEMO_MUNTLIG} nå={NÅ} />
          <HoringFristBlokker sak={DEMO_MUNTLIG} />
        </div>
        <HoringOmSak sakId={DEMO_SAK.id} saker={[DEMO_SAK, DEMO_SKRIFTLIG]} />
      </section>

      <section aria-labelledby="galleri-widget">
        <h2 id="galleri-widget" className="kv-undertittel">Widgeter</h2>
        <p className="kv-feltnavn">Varselfrekvens</p>
        <div className="kv-valg">
          {[
            ["straks", "Straks"],
            ["daglig", "Daglig"],
            ["ukentlig", "Ukentlig"],
          ].map(([id, label]) => (
            <button type="button" key={id} aria-pressed={frekvens === id} onClick={() => setFrekvens(id)}>{label}</button>
          ))}
        </div>
        <div className="avis-sb-frist">
          <p className="avis-sb-dato" aria-hidden="true">28<small>okt</small></p>
          <div>
            <p className="avis-sb-status">Skriftlig innspill</p>
            <p><time dateTime="2026-10-28T12:00:00+01:00">Frist onsdag 28. oktober 2026 kl. 12.00</time></p>
          </div>
        </div>
        <p className="kv-klynge">
          <span className="kv-toast">Lagret</span>
          <span className="kv-toast feil">Kunne ikke lagre</span>
        </p>
        <p className="kv-tom">Ingen saker i dette utvalget.</p>
        <p className="kv-feil" role="alert">Forklaringen kunne ikke hentes.</p>
      </section>
    </article>
  );
}
