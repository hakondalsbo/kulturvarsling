import { byggPanel, type SakGrunnlag } from "./kjerne.ts";
import { panelErSynlig } from "./miljo.ts";
import "./mobiliser.css";

const FØLGES = "Du følger denne saken.";
const FØLGES_IKKE = "Du følger ikke denne saken.";

export function MobiliserPanel({
  sak,
  folger = false,
  visFolg = false,
  onToggleFolger,
  dato = new Date(),
}: {
  sak: SakGrunnlag;
  folger?: boolean;
  visFolg?: boolean;
  onToggleFolger?: () => void;
  dato?: Date;
}) {
  if (!panelErSynlig()) return null;
  const panel = byggPanel(sak, dato);
  return (
    <section className="mobiliser-panel" id="mobiliser-na" aria-labelledby="mobiliser-na-tittel" data-lenkepunkt="mobiliser-na">
      <p className={panel.merke === "handling" ? "mobiliser-merke handling" : "mobiliser-merke orientering"}>
        {panel.merkeTekst}
      </p>
      <h2 id="mobiliser-na-tittel">Mobiliser nå</h2>
      {(visFolg || onToggleFolger) && <p>{folger ? FØLGES : FØLGES_IKKE}</p>}
      <p className="mobiliser-handling">{panel.handling}</p>
      <dl className="mobiliser-fakta">
        <div>
          <dt>Hvem som avgjør</dt>
          <dd>{panel.hvem}</dd>
        </div>
        <div>
          <dt>Frist</dt>
          <dd>{panel.frist ? <time dateTime={panel.fristIso ?? undefined}>{panel.frist}</time> : "Ingen frist står i saken."}</dd>
        </div>
      </dl>
      {panel.utkast && (
        <div>
          <h3>Utkast</h3>
          <pre className="mobiliser-utkast">{panel.utkast}</pre>
        </div>
      )}
      {panel.innsending && (
        <p><a className="kv-lenke" href={panel.innsending}>Gå til innsendingen</a></p>
      )}
      <p className="mobiliser-note">Kulturvarsling sender ikke inn utkastet.</p>
      <button type="button" className="kv-knapp" disabled>
        Kulturvarsling sender ikke inn
      </button>
      <div className="mobiliser-lenker">
        {onToggleFolger && (
          <button type="button" className="kv-knapp linje" onClick={onToggleFolger} data-lenkepunkt="folg-saken">
            {folger ? "Følger" : "Følg saken"}
          </button>
        )}
        <a className="kv-lenke" href="/min-side#fulgte" data-lenkepunkt="min-side" data-koble="fulgte">Saker du følger</a>
        <a className="kv-lenke" href="/min-side#stottet" data-lenkepunkt="min-side" data-koble="mine-innspill">Innspill du har støttet</a>
      </div>
    </section>
  );
}
