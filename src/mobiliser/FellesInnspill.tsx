import { useState } from "react";
import { Felt, Knapp } from "../ui.tsx";
import { SAMTYKKE_VERSJON, fyllSamtykke, validerSignering } from "./kjerne.ts";
import { signaturKanSigneres } from "./miljo.ts";

export function InnspillStengt({ tittel }: { tittel?: string }) {
  return (
    <section className="mobiliser-kort" id="innspill" data-visning="stengt">
      <p className="mobiliser-merke orientering">Felles innspill</p>
      <h2>{tittel || "Felles innspill"}</h2>
      <p>Felles innspill åpner snart. Ingenting kan signeres ennå.</p>
    </section>
  );
}

export function FellesInnspillSkjema({
  innspillId,
  tittel,
  sakId,
  mottaker,
  dato,
  tekst,
}: {
  innspillId: string;
  tittel: string;
  sakId: string | null;
  mottaker: string;
  dato: string;
  tekst: string;
}) {
  const [navn, setNavn] = useState("");
  const [epost, setEpost] = useState("");
  const [rolle, setRolle] = useState("");
  const [organisasjon, setOrganisasjon] = useState("");
  const [kommune, setKommune] = useState("");
  const [honning, setHonning] = useState("");
  const [samtykke, setSamtykke] = useState(false);
  const [feil, setFeil] = useState("");
  const [sendt, setSendt] = useState(false);
  const vist = fyllSamtykke(mottaker, dato);
  const [foran, etter] = deltSamtykke(vist);
  if (!signaturKanSigneres()) return <InnspillStengt tittel={tittel} />;

  function send(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!samtykke) {
      setFeil("Du må krysse av for samtykke. Avkrysningen er ikke fylt ut på forhånd.");
      setSendt(false);
      return;
    }
    const resultat = validerSignering(
      {
        navn,
        epost,
        rolle,
        organisasjon,
        kommune,
        samtykke: true,
        samtykke_tekst_versjon: SAMTYKKE_VERSJON,
        kv_hp_felt: honning,
      },
      { mottaker, dato },
    );
    if (!resultat.ok) {
      setFeil(resultat.feil);
      setSendt(false);
      return;
    }
    setFeil("");
    setSendt(true);
  }

  return (
    <form className="mobiliser-skjema" id="innspill" data-lenkepunkt="felles-innspill" data-innspill={innspillId} data-sak={sakId ?? ""} onSubmit={send} noValidate>
      <p className="mobiliser-merke handling">Felles innspill</p>
      <h2>{tittel}</h2>
      <p>{tekst}</p>
      <p className="mobiliser-meta">Til {mottaker}. Planlagt rundt {dato}. På nettstedet vises bare antallet.</p>
      <Felt id="innspill-navn" label="Navn" value={navn} onChange={(e) => setNavn(e.target.value)} autoComplete="name" />
      <Felt id="innspill-epost" label="E-post" type="email" value={epost} onChange={(e) => setEpost(e.target.value)} autoComplete="email" />
      <Felt id="innspill-rolle" label="Rolle, hvis du vil" value={rolle} onChange={(e) => setRolle(e.target.value)} />
      <Felt id="innspill-organisasjon" label="Organisasjon, hvis du vil" value={organisasjon} onChange={(e) => setOrganisasjon(e.target.value)} />
      <Felt id="innspill-kommune" label="Kommune, hvis du vil" value={kommune} onChange={(e) => setKommune(e.target.value)} />
      <div className="mobiliser-honeypot" aria-hidden="true">
        <label htmlFor="kv_hp_felt">La feltet stå tomt</label>
        <input id="kv_hp_felt" name="kv_hp_felt" tabIndex={-1} autoComplete="off" value={honning} onChange={(e) => setHonning(e.target.value)} />
      </div>
      <label className="mobiliser-samtykke">
        <input
          type="checkbox"
          name="samtykke"
          checked={samtykke}
          onChange={(e) => setSamtykke(e.target.checked)}
        />
        <span>{foran}</span>
      </label>
      <p>
        <a href="/personvern">Les mer i personvernerklæringen</a>
        {etter}
      </p>
      {feil && <p className="kv-feil" role="alert">{feil}</p>}
      {sendt && (
        <p role="status">
          Dette er en forhåndsvisning. Ingenting er lagret hos oss eller sendt. Signaturen teller ikke før e-posten er bekreftet.
        </p>
      )}
      <div className="mobiliser-lenker">
        <Knapp type="submit">Signer innspillet</Knapp>
        <a className="kv-lenke" href="/mobiliser?vis=panel">Tilbake til saken</a>
        <a className="kv-lenke" href="/min-side#stottet" data-lenkepunkt="min-side" data-koble="mine-innspill">Innspill du har støttet</a>
        <a className="kv-lenke" href="/min-side#fulgte" data-lenkepunkt="min-side" data-koble="fulgte">Saker du følger</a>
      </div>
    </form>
  );
}

function deltSamtykke(tekst: string): [string, string] {
  const merke = "[Les mer i personvernerklæringen]";
  const indeks = tekst.indexOf(merke);
  if (indeks === -1) return [tekst, ""];
  return [tekst.slice(0, indeks).trimEnd(), tekst.slice(indeks + merke.length)];
}

export function InnspillBekreftet({ tittel }: { tittel: string }) {
  return (
    <section className="mobiliser-kort" id="innspill" data-visning="bekreftet">
      <p className="mobiliser-merke handling">Felles innspill</p>
      <h2>Signaturen er bekreftet</h2>
      <p>{tittel} teller med. Navnet ditt vises ikke på kulturvarsling.no.</p>
      <p className="mobiliser-note">Etter at innspillet er sendt, kan signaturen ikke hentes tilbake hos mottakeren. Ønsket om å si fra kan registreres. Ingen e-post sendes om det her.</p>
      <p><a className="kv-lenke" href="/min-side#stottet" data-lenkepunkt="min-side" data-koble="mine-innspill">Se det på Min side</a></p>
    </section>
  );
}

export function InnspillTrukket({ tittel }: { tittel: string }) {
  return (
    <section className="mobiliser-kort" id="innspill" data-visning="trukket">
      <p className="mobiliser-merke orientering">Felles innspill</p>
      <h2>Signaturen er trukket tilbake</h2>
      <p>{tittel} teller ikke lenger. Trekket skjedde før innspillet ble sendt.</p>
      <p><a className="kv-lenke" href="/min-side#stottet" data-lenkepunkt="min-side">Min side</a></p>
    </section>
  );
}
