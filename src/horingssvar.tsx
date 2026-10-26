import { useEffect, useState } from "react";
import { demoTillatt } from "./minside/demo.ts";
import { Felt, Knapp, Tekstfelt, Velger } from "./ui.tsx";

export type HoringSak = {
  id: string;
  tittel: string;
  instans?: string;
  kilde?: string;
  frist?: string;
  sammendrag?: string;
  nivå?: string;
};

export type HoringUtkast = {
  id: string;
  org: string;
  tekst: string;
  kilde_url?: string | null;
  kilde_hentet?: string | null;
  kilde_hash?: string | null;
  oppdatert?: string | null;
};

export type HoringForslag = {
  utkast: string;
  kilde_url?: string | null;
  kilde_hentet?: string | null;
  kilde_hash?: string | null;
  sjekk?: { tall?: { aar?: string[]; tall?: string[] }; sitater_fjernet?: number; punkter_mangler?: string[] };
};

type LagreRad = {
  id?: string;
  org: string;
  tekst: string;
  kilde_url?: string | null;
  kilde_hentet?: string | null;
  kilde_hash?: string | null;
};

const SYN = [
  { id: "støtter", label: "Støtter" },
  { id: "støtter med endringer", label: "Støtter med endringer" },
  { id: "er imot", label: "Er imot" },
  { id: "vet ikke", label: "Vet ikke ennå" },
];

function formatDato(verdi?: string | null) {
  if (!verdi) return "Udatert";
  const dato = new Date(verdi);
  if (Number.isNaN(dato.getTime())) return "Udatert";
  return dato.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });
}

function lastNed(tekst: string, tittel: string) {
  const blob = new Blob([tekst], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${tittel.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "horingssvar"}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export function HoringssvarSkjema({
  sak,
  user,
  hjelpAktiv = false,
  onInnlogging,
  hent,
  lagre,
  foreslaa,
  start = [],
}: {
  sak: HoringSak;
  user: { id?: string; org?: string; navn?: string } | null;
  hjelpAktiv?: boolean;
  onInnlogging?: () => void;
  hent?: (sakId: string) => Promise<HoringUtkast[]>;
  lagre?: (rad: LagreRad) => Promise<HoringUtkast>;
  foreslaa?: (body: Record<string, unknown>) => Promise<HoringForslag>;
  start?: HoringUtkast[];
}) {
  const [rader, setRader] = useState<HoringUtkast[]>(start);
  const [aktivId, setAktivId] = useState<string | null>(start[0]?.id ?? null);
  const [org, setOrg] = useState(start[0]?.org || user?.org || "");
  const [tekst, setTekst] = useState(start[0]?.tekst || "");
  const [kildeUrl, setKildeUrl] = useState<string | null>(start[0]?.kilde_url ?? sak.kilde ?? null);
  const [kildeHentet, setKildeHentet] = useState<string | null>(start[0]?.kilde_hentet ?? null);
  const [kildeHash, setKildeHash] = useState<string | null>(start[0]?.kilde_hash ?? null);
  const [beskrivelse, setBeskrivelse] = useState("");
  const [punkt, setPunkt] = useState("");
  const [syn, setSyn] = useState("støtter");
  const [hvorfor, setHvorfor] = useState("");
  const [erfaringer, setErfaringer] = useState("");
  const [notat, setNotat] = useState("");
  const [melding, setMelding] = useState("");
  const [feil, setFeil] = useState("");
  const [sjekk, setSjekk] = useState("");
  const [lagrer, setLagrer] = useState(false);
  const [foreslar, setForeslar] = useState(false);
  const [kopiert, setKopiert] = useState(false);

  useEffect(() => {
    if (!hent || !user?.id || user.id === "forhands") return;
    let aktiv = true;
    hent(sak.id).then((funnet) => {
      if (!aktiv || !funnet.length) return;
      setRader(funnet);
      setAktivId(funnet[0].id);
      setOrg(funnet[0].org || user.org || "");
      setTekst(funnet[0].tekst);
      setKildeUrl(funnet[0].kilde_url ?? sak.kilde ?? null);
      setKildeHentet(funnet[0].kilde_hentet ?? null);
      setKildeHash(funnet[0].kilde_hash ?? null);
    }).catch(() => {
      if (aktiv) setFeil("Kunne ikke hente utkastene.");
    });
    return () => { aktiv = false; };
    // hent lages på nytt for hvert render. Hentingen følger sak og bruker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sak.id, user?.id]);

  function velg(rad: HoringUtkast) {
    setAktivId(rad.id);
    setOrg(rad.org);
    setTekst(rad.tekst);
    setKildeUrl(rad.kilde_url ?? sak.kilde ?? null);
    setKildeHentet(rad.kilde_hentet ?? null);
    setKildeHash(rad.kilde_hash ?? null);
    setMelding("");
    setFeil("");
  }

  function nyttUtkast() {
    setAktivId(null);
    setTekst("");
    setMelding("");
    setFeil("");
    setSjekk("");
  }

  async function onLagre() {
    if (!org.trim() || !tekst.trim()) return;
    setLagrer(true);
    setFeil("");
    setMelding("");
    const rad: LagreRad = {
      id: aktivId ?? undefined,
      org: org.trim(),
      tekst,
      kilde_url: kildeUrl,
      kilde_hentet: kildeHentet,
      kilde_hash: kildeHash,
    };
    try {
      const lagret = lagre
        ? await lagre(rad)
        : { ...rad, id: aktivId ?? crypto.randomUUID(), oppdatert: new Date().toISOString() };
      setRader((liste) => [lagret, ...liste.filter((x) => x.id !== lagret.id)]);
      setAktivId(lagret.id);
      setMelding("Utkastet er lagret hos deg. Det er ikke sendt inn.");
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre utkastet.");
    } finally {
      setLagrer(false);
    }
  }

  async function onForeslaa() {
    if (!hjelpAktiv || !foreslaa || !org.trim() || !beskrivelse.trim()) return;
    setForeslar(true);
    setFeil("");
    setSjekk("");
    try {
      const svar = await foreslaa({
        varsel_id: sak.id,
        organisasjon: org.trim(),
        beskrivelse,
        punkter: punkt.trim() ? [{ nr: punkt.trim(), syn, hvorfor }] : [],
        erfaringer,
        kildetekst: notat,
      });
      setTekst(svar.utkast);
      setKildeUrl(svar.kilde_url ?? sak.kilde ?? null);
      setKildeHentet(svar.kilde_hentet ?? null);
      setKildeHash(svar.kilde_hash ?? null);
      setAktivId(null);
      const tall = [...(svar.sjekk?.tall?.aar ?? []), ...(svar.sjekk?.tall?.tall ?? [])];
      const deler = [];
      if (tall.length) deler.push("Noen tall er merket [SJEKK]. De står ikke i kilden eller i det dere skrev.");
      if ((svar.sjekk?.sitater_fjernet ?? 0) > 0) deler.push("Et sitat ble ikke funnet ordrett i kilden.");
      if ((svar.sjekk?.punkter_mangler ?? []).length) deler.push("Et punktnummer finnes ikke i notatet.");
      setSjekk(deler.join(" "));
      setMelding("Forslaget er lagt i utkastet. Les det og endre det før dere sender det inn selv.");
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Utkastet kunne ikke lages.");
    } finally {
      setForeslar(false);
    }
  }

  if (!user) {
    return (
      <div className="kv-stakk">
        <p className="kv-brod">Logg inn for å skrive, lagre og se dine egne utkast.</p>
        {onInnlogging && <Knapp onClick={onInnlogging}>Logg inn</Knapp>}
      </div>
    );
  }

  const kanForeslaa = hjelpAktiv && !!org.trim() && !!beskrivelse.trim() && !foreslar;
  const innlevering = sak.kilde || "";

  return (
    <div className="kv-stakk">
      <p className="kv-brod">Kulturvarsling sender ikke inn svaret. Kopier eller last ned teksten, og send den inn selv.</p>
      <p className="kv-meta">Høringssvar blir normalt offentlige.</p>
      {innlevering ? (
        <p><a className="kv-lenke" href={innlevering} target="_blank" rel="noreferrer">Offisiell innsending hos {sak.instans || "avsenderen"}</a></p>
      ) : (
        <p className="kv-meta">Saken har ingen lenke til innsending. Sjekk hos {sak.instans || "avsenderen"}.</p>
      )}

      <div>
        <p className="kv-feltnavn">Mine utkast</p>
        {rader.length === 0 && <p className="kv-tom">Ingen lagrede utkast på denne saken.</p>}
        {rader.length > 0 && (
          <div className="kv-valg" aria-label="Lagrede utkast">
            {rader.map((rad) => (
              <button type="button" key={rad.id} aria-pressed={rad.id === aktivId} onClick={() => velg(rad)}>
                {formatDato(rad.oppdatert)}
              </button>
            ))}
          </div>
        )}
      </div>

      <Felt id={`horing-org-${sak.id}`} label="Organisasjon" value={org} onChange={(e) => setOrg(e.target.value)} />
      <label className="kv-felt" htmlFor={`horing-tekst-${sak.id}`}>
        <span>Utkast</span>
        <textarea id={`horing-tekst-${sak.id}`} className="kv-input kv-utkast" rows={16} value={tekst} onChange={(e) => setTekst(e.target.value)} />
      </label>
      <div className="kv-klynge">
        <Knapp onClick={onLagre} disabled={lagrer || !org.trim() || !tekst.trim()}>{lagrer ? "Lagrer" : "Lagre utkast"}</Knapp>
        <Knapp variant="linje" onClick={() => { navigator.clipboard?.writeText(tekst); setKopiert(true); window.setTimeout(() => setKopiert(false), 2000); }} disabled={!tekst.trim()}>
          {kopiert ? "Kopiert" : "Kopier"}
        </Knapp>
        <Knapp variant="linje" onClick={() => lastNed(tekst, sak.tittel)} disabled={!tekst.trim()}>Last ned</Knapp>
        <Knapp variant="stille" onClick={nyttUtkast}>Nytt utkast</Knapp>
      </div>
      {melding && <p className="kv-brod">{melding}</p>}
      {feil && <p className="kv-feil" role="alert">{feil}</p>}
      {sjekk && <p className="kv-brod">{sjekk}</p>}

      {hjelpAktiv && (
        <section className="kv-kort" aria-labelledby={`hjelp-${sak.id}`}>
          <h2 id={`hjelp-${sak.id}`} className="kv-undertittel">Forslag til utkast</h2>
          <p className="kv-brod">Forslaget bruker høringsnotatet og det dere selv skriver. Det er et startpunkt, ikke et ferdig svar.</p>
          <Tekstfelt id={`hjelp-hvem-${sak.id}`} label="Hvem dere er" value={beskrivelse} onChange={(e) => setBeskrivelse(e.target.value)} rows={3} />
          <div className="kv-rutenett">
            <Felt id={`hjelp-punkt-${sak.id}`} label="Punkt i notatet" value={punkt} onChange={(e) => setPunkt(e.target.value)} placeholder="3.2.4" />
            <Velger id={`hjelp-syn-${sak.id}`} label="Syn" value={syn} onChange={(e) => setSyn(e.target.value)}>
              {SYN.map((valg) => <option key={valg.id} value={valg.id}>{valg.label}</option>)}
            </Velger>
          </div>
          <Tekstfelt id={`hjelp-hvorfor-${sak.id}`} label="Hvorfor, med egne ord" value={hvorfor} onChange={(e) => setHvorfor(e.target.value)} rows={3} />
          <Tekstfelt id={`hjelp-erfaring-${sak.id}`} label="Egne erfaringer eller tall" value={erfaringer} onChange={(e) => setErfaringer(e.target.value)} rows={3} />
          <Tekstfelt id={`hjelp-notat-${sak.id}`} label="Høringsnotat, hvis du limer det inn" value={notat} onChange={(e) => setNotat(e.target.value)} rows={5} />
          <Knapp onClick={onForeslaa} disabled={!kanForeslaa}>{foreslar ? "Lager utkast" : "Foreslå utkast"}</Knapp>
          {!kanForeslaa && !foreslar && <p className="kv-meta">Skriv hvem dere er før du ber om et forslag.</p>}
        </section>
      )}
    </div>
  );
}

const FORHANDS_TEKST = `UTKAST – må gjennomgås og eventuelt endres av Eksempelorganisasjon før innsending

Til: Kultur- og likestillingsdepartementet
Høring: Forslag til endringer i kringkastingsforskriften (https://www.regjeringen.no/no/dokumenter/horing-forslag-til-endringer-i-kringkastingsforskriften/id3173432/)
Høringsfrist: 12. november 2026
Fra: Eksempelorganisasjon
Dato: 24. oktober 2026

1. Hvem vi er
Eksempelorganisasjon er en forening for lokalradio.

2. Hva vi mener, kort fortalt
- Vi støtter forslaget om at sendingene kan fortsette uten opphold.

3. Merknader til de enkelte punktene
Til punkt 3.2.4 § 7-4 første ledd
Departementet foreslår at det kan gis ny senderanleggskonsesjon dersom en annen aktør får frekvenstillatelse. Eksempelorganisasjon støtter dette.

4. Avslutning
Takk for muligheten til å svare.

UTKAST – må gjennomgås og eventuelt endres av Eksempelorganisasjon før innsending`;

export function HoringForhandsvisning() {
  if (!demoTillatt()) return null;
  return (
    <article className="avis-wrap avis-annet">
      <p className="kv-steg">Høring</p>
      <h1>Forslag til endringer i kringkastingsforskriften</h1>
      <p className="kv-meta">Kultur- og likestillingsdepartementet · Frist 12. november 2026</p>
      <HoringssvarSkjema
        sak={{
          id: "11111111-1111-4111-8111-111111111111",
          tittel: "Forslag til endringer i kringkastingsforskriften",
          instans: "Kultur- og likestillingsdepartementet",
          kilde: "https://www.regjeringen.no/no/dokumenter/horing-forslag-til-endringer-i-kringkastingsforskriften/id3173432/",
          frist: "2026-11-12",
          nivå: "nasjonalt",
        }}
        user={{ id: "forhands", org: "Eksempelorganisasjon", navn: "Eksempel" }}
        hjelpAktiv
        start={[{
          id: "22222222-2222-4222-8222-222222222222",
          org: "Eksempelorganisasjon",
          tekst: FORHANDS_TEKST,
          oppdatert: "2026-10-24T10:00:00+02:00",
          kilde_url: "https://www.regjeringen.no/no/dokumenter/horing-forslag-til-endringer-i-kringkastingsforskriften/id3173432/",
        }]}
      />
    </article>
  );
}
