import { useEffect, useState } from "react";
import { demoTillatt } from "./minside/demo.ts";
import { Felt, Knapp, Tekstfelt, Velger } from "./ui.tsx";

export type KommunalHoring = {
  id: string;
  tittel: string;
  frist?: string | null;
};

export function KommuneInnspillSkjema({
  user,
  horinger,
  lastHoringer,
  lagre,
  onInnlogging,
  startOrg = "",
  startTekst = "",
}: {
  user: { id?: string; org?: string } | null;
  horinger?: KommunalHoring[];
  lastHoringer?: () => Promise<KommunalHoring[]>;
  lagre?: (rad: { horing_id: string; org: string; tekst: string }) => Promise<void>;
  onInnlogging?: () => void;
  startOrg?: string;
  startTekst?: string;
}) {
  const [liste, setListe] = useState<KommunalHoring[]>(horinger ?? []);
  const [horingId, setHoringId] = useState(horinger?.[0]?.id ?? "");
  const [org, setOrg] = useState(startOrg || user?.org || "");
  const [tekst, setTekst] = useState(startTekst);
  const [feil, setFeil] = useState("");
  const [lagret, setLagret] = useState(false);
  const [laster, setLaster] = useState(false);
  const [henter, setHenter] = useState(!horinger);

  useEffect(() => {
    if (horinger || !lastHoringer) return;
    let aktiv = true;
    lastHoringer().then((funnet) => {
      if (!aktiv) return;
      setListe(funnet);
      setHoringId(funnet[0]?.id ?? "");
    }).catch(() => {
      if (aktiv) setFeil("Kunne ikke hente de kommunale høringene.");
    }).finally(() => {
      if (aktiv) setHenter(false);
    });
    return () => { aktiv = false; };
    // lastHoringer lages på nytt for hvert render. Hentingen skal skje én gang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send() {
    if (!user?.id) { onInnlogging?.(); return; }
    if (!horingId || !org.trim() || !tekst.trim()) return;
    setLaster(true);
    setFeil("");
    try {
      if (lagre) await lagre({ horing_id: horingId, org: org.trim(), tekst: tekst.trim() });
      setLagret(true);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre innspillet.");
    } finally {
      setLaster(false);
    }
  }

  if (!user) {
    return (
      <section className="kv-kort">
        <h2 className="kv-undertittel">Innspill til kommunen</h2>
        <p className="kv-brod">Logg inn for å sende et innspill til en kommunal høring.</p>
        {onInnlogging && <Knapp onClick={onInnlogging}>Logg inn</Knapp>}
      </section>
    );
  }

  if (lagret) {
    return (
      <section className="kv-kort">
        <h2 className="kv-undertittel">Innspill til kommunen</h2>
        <p className="kv-brod">Innspillet er lagret. Det kan ikke endres herfra, og det er ikke sendt på e-post.</p>
      </section>
    );
  }

  const kanLagre = !!horingId && !!org.trim() && !!tekst.trim() && !laster;

  return (
    <section className="kv-kort" aria-labelledby="kommune-innspill">
      <h2 id="kommune-innspill" className="kv-undertittel">Innspill til kommunen</h2>
      <p className="kv-brod">Innspillet lagres på kontoen din. Du kan ikke endre eller slette det etterpå.</p>
      {henter && <p className="kv-meta">Henter høringer</p>}
      {!henter && liste.length === 0 && <p className="kv-tom">Ingen kommunale høringer er publisert ennå.</p>}
      {liste.length > 0 && (
        <>
          <Velger id="innspill-horing" label="Høring" value={horingId} onChange={(e) => setHoringId(e.target.value)}>
            {liste.map((horing) => (
              <option key={horing.id} value={horing.id}>
                {horing.tittel}{horing.frist ? ` · frist ${horing.frist}` : ""}
              </option>
            ))}
          </Velger>
          <Felt id="innspill-org" label="Organisasjon" value={org} onChange={(e) => setOrg(e.target.value)} />
          <Tekstfelt id="innspill-tekst" label="Innspill" value={tekst} onChange={(e) => setTekst(e.target.value)} rows={6} />
          <Knapp onClick={send} disabled={!kanLagre}>{laster ? "Lagrer" : "Lagre innspill"}</Knapp>
        </>
      )}
      {feil && <p className="kv-feil" role="alert">{feil}</p>}
    </section>
  );
}

export function InnspillForhandsvisning() {
  if (!demoTillatt()) return null;
  return (
    <article className="avis-wrap avis-annet">
      <p className="kv-steg">Kommune</p>
      <h1>Innspill til kommunen</h1>
      <p className="kv-ingress">Et kort innspill til en publisert kommunal høring.</p>
      <KommuneInnspillSkjema
        user={{ id: "forhands", org: "Eksempelorganisasjon" }}
        horinger={[{
          id: "33333333-3333-4333-8333-333333333333",
          tittel: "Revisjon av tilskudd til lokale kulturlokaler",
          frist: "2026-11-20",
        }]}
        startOrg="Eksempelorganisasjon"
        startTekst="Vi ber om at tilskuddet til lokale kulturlokaler videreføres, slik at øvingslokaler i bydelen kan holdes åpne."
      />
    </article>
  );
}
