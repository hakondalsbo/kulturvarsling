import { DEMO_ALLEREDE_STOTTET, DEMO_BRUKER, DEMO_DATO, DEMO_HORING, DEMO_INNSPILL_HORING, DEMO_ORIENTERING, DEMO_SIGNATURER } from "./demo.ts";
import { EksportVisning } from "./EksportVisning.tsx";
import { FellesInnspillSkjema, InnspillBekreftet, InnspillTrukket } from "./FellesInnspill.tsx";
import { MobiliserPanel } from "./MobiliserPanel.tsx";
import { signaturErSynlig } from "./miljo.ts";
import { StottetInnspill } from "./StottetInnspill.tsx";
import "./mobiliser.css";

const VISNINGER = ["panel", "uten-fase", "samtykke", "bekreftet", "trukket", "eksport"] as const;
type Vis = (typeof VISNINGER)[number];

function lesVis(): Vis {
  const vis = new URLSearchParams(window.location.search).get("vis");
  if (vis && (VISNINGER as readonly string[]).includes(vis)) return vis as Vis;
  return "panel";
}

export function MobiliserSide() {
  const vis = lesVis();
  const apen = signaturErSynlig();

  return (
    <div className="avis mobiliser">
      <main className="mobiliser-wrap" data-vis={vis}>
        <div className="mobiliser-topp">
          <a href="/">Kulturvarsling</a>
          <a href="/min-side#fulgte" data-lenkepunkt="min-side" data-koble="fulgte">Saker du følger</a>
        </div>
        {apen ? (
          <>
            <p className="mobiliser-banner">Forhåndsvisning med demodata. Ingenting lagres eller sendes. Serverflagget er av.</p>
            <nav className="mobiliser-demo-lenker" aria-label="Demolenker">
              <a href="/mobiliser?vis=panel">Med fase</a>
              <a href="/mobiliser?vis=uten-fase">Uten fase</a>
              <a href="/mobiliser?vis=samtykke">Skjema</a>
              <a href="/mobiliser?vis=bekreftet">Bekreftet</a>
              <a href="/mobiliser?vis=trukket">Trukket</a>
              <a href="/mobiliser?vis=eksport">Eksport</a>
              <a href="/personvern#felles-innspill">Personvern</a>
            </nav>
            <p className="mobiliser-meta">Du er inne som {DEMO_BRUKER}.</p>
            {vis === "panel" && (
              <>
                <MobiliserPanel sak={DEMO_HORING} folger visFolg dato={DEMO_DATO} />
                <p><a className="kv-lenke" href="/mobiliser?vis=samtykke#innspill">Åpne felles innspill</a></p>
              </>
            )}
            {vis === "uten-fase" && (
              <MobiliserPanel sak={DEMO_ORIENTERING} dato={DEMO_DATO} />
            )}
            {vis === "samtykke" && (
              <FellesInnspillSkjema
                innspillId={DEMO_INNSPILL_HORING.id}
                tittel={DEMO_INNSPILL_HORING.tittel}
                sakId={DEMO_INNSPILL_HORING.sakId}
                mottaker={DEMO_INNSPILL_HORING.mottaker}
                dato={DEMO_INNSPILL_HORING.dato}
                tekst={DEMO_INNSPILL_HORING.tekst}
              />
            )}
            {vis === "bekreftet" && (
              <>
                <InnspillBekreftet tittel={DEMO_INNSPILL_HORING.tittel} />
                <StottetInnspill innlogget innspill={[
                  ...DEMO_ALLEREDE_STOTTET,
                  {
                    innspillId: DEMO_INNSPILL_HORING.id,
                    tittel: DEMO_INNSPILL_HORING.tittel,
                    sakId: DEMO_INNSPILL_HORING.sakId,
                    bekreftet: true,
                    trukket: false,
                  },
                ]} />
              </>
            )}
            {vis === "trukket" && <InnspillTrukket tittel={DEMO_INNSPILL_HORING.tittel} />}
            {vis === "eksport" && (
              <EksportVisning
                tittel={DEMO_INNSPILL_HORING.tittel}
                mottaker={DEMO_INNSPILL_HORING.mottaker}
                signaturer={DEMO_SIGNATURER}
              />
            )}
          </>
        ) : (
          <>
            <h1>Mobiliser nå</h1>
            <p>Visningen er ikke åpnet. Ingenting lagres her.</p>
          </>
        )}
      </main>
    </div>
  );
}
