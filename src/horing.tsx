import { useEffect, useState } from "react";
import {
  erStortingetHoring,
  folgKomiteAktiv,
  horingerOmSaken,
  horingKnappLenke,
  komiteIdFraInstans,
  komiteNavn,
  lesHoringLinjer,
} from "./horing.ts";

export function HoringFristBlokker({ sak }: {
  sak: { kilde?: string | null; sammendrag?: string | null };
}) {
  const linjer = lesHoringLinjer(sak.sammendrag);
  const lenke = horingKnappLenke(sak.kilde, sak.sammendrag);
  if (!linjer.length && !lenke) return null;
  return (
    <section className="kv-horing" aria-label="Høringsfrister">
      {linjer.map((linje, i) => (
        <p key={`${i}-${linje}`} className="kv-brod">{linje}</p>
      ))}
      <p className="kv-meta">Hovedregelen er at kun landsomfattende organisasjoner inviteres.</p>
      {lenke && (
        <a className="kv-knapp" href={lenke} target="_blank" rel="noreferrer">
          Søk om å delta / send innspill på stortinget.no
        </a>
      )}
    </section>
  );
}

export function HoringOmSak({ sakId, saker }: {
  sakId?: string | null;
  saker: Array<{ id?: string; hovedsak_id?: string | null; tittel?: string | null }>;
}) {
  const horinger = horingerOmSaken(sakId, saker);
  if (!horinger.length) return null;
  return <p className="kv-brod">Det er høring i denne saken.</p>;
}

export function FolgKomiteStyring({
  komiteId,
  brukerId,
  les,
  skriv,
}: {
  komiteId: string;
  brukerId?: string | null;
  les: (brukerId: string) => Promise<string[]>;
  skriv: (brukerId: string, komiteId: string, skalFolge: boolean) => Promise<boolean>;
}) {
  const aktiv = folgKomiteAktiv();
  const [folger, setFolger] = useState(false);
  useEffect(() => {
    if (!aktiv || !brukerId) return;
    let levende = true;
    les(brukerId).then((ids) => {
      if (levende) setFolger(ids.includes(komiteId));
    });
    return () => { levende = false; };
  }, [aktiv, brukerId, komiteId, les]);
  if (!aktiv || !brukerId) return null;
  return (
    <button
      type="button"
      className="kv-knapp linje"
      onClick={() => {
        const neste = !folger;
        setFolger(neste);
        skriv(brukerId, komiteId, neste).then((ok) => {
          if (!ok) setFolger(!neste);
        });
      }}
    >
      {folger ? "Slutt å følge komiteen" : "Følg komiteen"}
    </button>
  );
}

type HoringSak = {
  id?: string;
  tittel?: string | null;
  instans?: string | null;
  kilde?: string | null;
  sammendrag?: string | null;
  sakstype?: string | null;
  dager?: number | null;
  frist?: string | null;
};

export function MineKomiteer({
  saker,
  brukerId,
  les,
}: {
  saker: HoringSak[];
  brukerId?: string | null;
  les: (brukerId: string) => Promise<string[]>;
}) {
  const aktiv = folgKomiteAktiv();
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    if (!aktiv || !brukerId) return;
    let levende = true;
    les(brukerId).then((liste) => {
      if (levende) setIds(liste);
    });
    return () => { levende = false; };
  }, [aktiv, brukerId, les]);
  if (!aktiv) return null;
  const åpne = saker.filter((sak) => {
    if (!erStortingetHoring(sak)) return false;
    const komite = komiteIdFraInstans(sak.instans);
    if (!komite || !ids.includes(komite)) return false;
    return sak.dager == null || sak.dager >= 0;
  });
  return (
    <section className="kv-kort" aria-labelledby="mine-komiteer">
      <h2 id="mine-komiteer" className="kv-undertittel">Mine komiteer</h2>
      <p className="kv-meta">Åpne høringer i komiteene du følger.</p>
      {åpne.length === 0 && <p className="kv-tom">Ingen åpne høringer i komiteene du følger.</p>}
      <ul className="kv-liste">
        {åpne.map((sak) => (
          <li key={sak.id} className="kv-rad">
            <h3 className="kv-undertittel">{sak.tittel}</h3>
            <p className="kv-meta">{sak.instans}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function KomiteSide({
  komiteId,
  saker,
  brukerId,
  les,
  skriv,
}: {
  komiteId: string;
  saker: HoringSak[];
  brukerId?: string | null;
  les: (brukerId: string) => Promise<string[]>;
  skriv: (brukerId: string, komiteId: string, skalFolge: boolean) => Promise<boolean>;
}) {
  if (!folgKomiteAktiv()) return null;
  const navn = komiteNavn(komiteId);
  const horinger = saker.filter((sak) => erStortingetHoring(sak) && komiteIdFraInstans(sak.instans) === komiteId);
  return (
    <article className="avis-wrap kv-stakk">
      <h1>{navn}</h1>
      <p className="kv-brod">Kommende høringer i komiteen.</p>
      <FolgKomiteStyring komiteId={komiteId} brukerId={brukerId} les={les} skriv={skriv} />
      {horinger.length === 0 && <p className="kv-tom">Ingen høringer er registrert for komiteen.</p>}
      <ul className="kv-liste">
        {horinger.map((sak) => (
          <li key={sak.id} className="kv-rad">
            <h2 className="kv-undertittel">{sak.tittel}</h2>
            <HoringFristBlokker sak={sak} />
          </li>
        ))}
      </ul>
    </article>
  );
}
