import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { Rollemerke, type Sak } from "../avis.tsx";
import { Felt, Knapp } from "../ui.tsx";
import { kategorierForMeny } from "./kategorier.ts";
import { komiteNavn, KOMITEER } from "./komiteer.ts";
import {
  DEMO_DAG,
  DEMO_FULGTE,
  DEMO_SAKER,
  DEMO_SOK,
  DEMO_VALG,
  lesDemo,
} from "./demo.ts";
import {
  apentAbonnement,
  delMinSide,
  harAvgrensning,
  TOMT_VALG,
  type LagretSok,
  type MinSak,
  type MinValg,
} from "./filter.ts";
import { filtrerSteder, stedNavn } from "./steder.ts";
import "./minside.css";

export type MinSideProps = {
  user?: {
    id?: string;
    fagfelt?: string[] | null;
    geografisk?: string[] | null;
    organ?: string[] | null;
    komiteer?: string[] | null;
    varslerAktive?: boolean;
    minsideKlar?: boolean;
  } | null;
  varsler?: MinSak[];
  fulgte?: Array<string | number>;
  sok?: LagretSok[];
  sokLastet?: boolean;
  onLagreValg?: (valg: MinValg) => Promise<boolean> | boolean;
  onLagreSok?: (navn: string, sporretekst: string) => Promise<LagretSok | null> | LagretSok | null;
  onSlettSok?: (id: string) => Promise<boolean> | boolean;
  onToggleFolg?: (id: string | number) => void;
  onLogin?: () => void;
};

function valgFra(user: MinSideProps["user"]): MinValg {
  if (!user) return { ...TOMT_VALG };
  return {
    fagfelt: [...(user.fagfelt ?? [])],
    geografisk: [...(user.geografisk ?? [])],
    organ: [...(user.organ ?? [])],
    komiteer: [...(user.komiteer ?? [])],
    varslerAktive: !!user.varslerAktive,
  };
}

function medAktiv(valg: MinValg): MinValg {
  return { ...valg, varslerAktive: harAvgrensning(valg) };
}

function datoLang(iso?: string | null): string {
  if (!iso) return "Ingen frist";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "Ingen frist";
  return d.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });
}

function statusTekst(status?: string | null): string {
  const s = (status || "").toLowerCase();
  if (s === "høring" || s === "horing" || s === "åpen" || s === "apen" || s === "aktiv") return "Høring";
  if (s === "passert") return "Passert";
  if (s === "vedtak") return "Vedtak";
  if (s === "viktig") return "Viktig";
  if (!s || s === "normal") return "Åpen";
  return status || "Åpen";
}

function tilSak(sak: MinSak): Sak {
  return {
    id: sak.id,
    tittel: sak.tittel ?? undefined,
    sammendrag: sak.sammendrag ?? undefined,
    instans: sak.instans ?? undefined,
    kategori: sak.kategori ?? undefined,
    niva: sak.niva ?? undefined,
    sted: sak.sted ?? undefined,
    fylkesnr: sak.fylkesnr,
    kommunenr: sak.kommunenr,
    frist: sak.frist,
    status: sak.status ?? undefined,
    kilde: typeof sak.kilde === "string" ? sak.kilde : undefined,
    handling: sak.handling,
  };
}

function organNavn(id: string): string {
  if (id === "stortinget") return "Stortinget";
  if (id === "regjeringen") return "Regjeringen";
  return id;
}

export function MinSide({
  user = null,
  varsler = [],
  fulgte = [],
  sok = [],
  sokLastet = false,
  onLagreValg,
  onLagreSok,
  onSlettSok,
  onToggleFolg,
  onLogin,
}: MinSideProps) {
  const demo = lesDemo();
  const erDemo = demo.modus != null;
  const kanLagre = !!user?.id && !erDemo;
  const [valg, setValg] = useState<MinValg>(() => {
    if (demo.modus === "side") return DEMO_VALG;
    if (demo.modus === "tom" || demo.modus === "oppsett") return { ...TOMT_VALG };
    return valgFra(user);
  });
  const [sokListe, setSokListe] = useState<LagretSok[]>(() => (demo.modus === "side" ? DEMO_SOK : []));
  const [fulgt, setFulgt] = useState<string[]>(() => (demo.modus === "side" ? [...DEMO_FULGTE] : fulgte.map(String)));
  const [steg, setSteg] = useState<1 | 2 | 3>(demo.steg);
  const [visOppsett, setVisOppsett] = useState(() => {
    if (demo.modus === "oppsett") return true;
    if (demo.modus === "side" || demo.modus === "tom") return false;
    const start = valgFra(user);
    return !user?.minsideKlar && !harAvgrensning(start) && !user?.varslerAktive && fulgte.length === 0;
  });
  const [stedSok, setStedSok] = useState("");
  const [sokNavn, setSokNavn] = useState("");
  const [sokTekst, setSokTekst] = useState("");
  const [lagrer, setLagrer] = useState(false);
  const overskrift = useRef<HTMLHeadingElement>(null);
  const sokFeltId = useId();
  const stedFeltId = useId();
  const brukerId = user?.id ?? "";

  useEffect(() => {
    if (erDemo || !sokLastet) return;
    const neste = valgFra(user);
    setValg(neste);
    setSokListe(sok);
    setFulgt(fulgte.map(String));
    setVisOppsett(!user?.minsideKlar && !harAvgrensning(neste) && !neste.varslerAktive && fulgte.length === 0 && sok.length === 0);
  }, [erDemo, sokLastet, brukerId]);

  useEffect(() => {
    overskrift.current?.focus();
  }, [steg, visOppsett]);

  const saker = erDemo ? DEMO_SAKER : varsler;
  const nå = erDemo ? DEMO_DAG : new Date();
  const deler = useMemo(
    () => delMinSide(saker, valg, fulgt, sokListe, nå),
    [saker, valg, fulgt, sokListe, nå],
  );
  const steder = useMemo(() => filtrerSteder(stedSok), [stedSok]);
  const fag = kategorierForMeny();

  async function lagre(neste: MinValg, ferdig: boolean) {
    setValg(neste);
    if (!kanLagre || !onLagreValg) return;
    setLagrer(true);
    const ok = await onLagreValg({ ...neste, varslerAktive: neste.varslerAktive });
    setLagrer(false);
    if (!ok && ferdig) onLogin?.();
  }

  function hoppOver() {
    if (steg === 1) {
      setValg((v) => medAktiv({ ...v, geografisk: [], organ: [], komiteer: [] }));
      setSteg(2);
      return;
    }
    if (steg === 2) {
      setValg((v) => medAktiv({ ...v, fagfelt: [] }));
      setSteg(3);
      return;
    }
    void apne();
  }

  function neste() {
    if (steg === 1) setSteg(2);
    else if (steg === 2) setSteg(3);
    else void apne();
  }

  async function apne() {
    const nesteValg = medAktiv(valg);
    setVisOppsett(false);
    await lagre({ ...nesteValg, varslerAktive: harAvgrensning(nesteValg) }, true);
  }

  function toggleToken(tokens: string[], pa: boolean) {
    setValg((v) => {
      const geo = new Set(v.geografisk);
      for (const token of tokens) {
        if (pa) geo.add(token);
        else geo.delete(token);
      }
      return medAktiv({ ...v, geografisk: [...geo] });
    });
  }

  function toggleListe(nokkel: "organ" | "komiteer" | "fagfelt", id: string) {
    setValg((v) => {
      const har = v[nokkel].includes(id);
      const liste = har ? v[nokkel].filter((x) => x !== id) : [...v[nokkel], id];
      return medAktiv({ ...v, [nokkel]: liste });
    });
  }

  async function lagreSok() {
    const tekst = sokTekst.trim();
    const navn = (sokNavn.trim() || tekst).slice(0, 80);
    if (!tekst || !navn) return;
    if (erDemo || !kanLagre || !onLagreSok) {
      setSokListe((liste) => [{ id: `lokalt-${liste.length + 1}`, navn, sporretekst: tekst }, ...liste]);
      setSokNavn("");
      setSokTekst("");
      return;
    }
    const rad = await onLagreSok(navn, tekst);
    if (rad) {
      setSokListe((liste) => [rad, ...liste]);
      setSokNavn("");
      setSokTekst("");
    }
  }

  function folg(id: string | number) {
    setFulgt((liste) => liste.includes(String(id)) ? liste.filter((x) => x !== String(id)) : [...liste, String(id)]);
    if (!erDemo && kanLagre) onToggleFolg?.(id);
  }

  const valgteSteder = stedNavn(valg.geografisk);
  const valgteFag = fag.filter((k) => valg.fagfelt.includes(k.id)).map((k) => k.label);

  return (
    <div className="minside" data-minside={demo.modus ?? "konto"}>
      <div className="avis-wrap minside-ark">
        {erDemo ? (
          <p className="minside-forslag">Forslag til godkjenning. Eksemplene er ikke ekte saker, og ingenting lagres.</p>
        ) : null}
        <p className="kv-steg">Min side</p>
        <h1>Det du følger</h1>
        <p className="minside-innledning">
          Forsiden viser alt. Her ser du bare stedene, fagene, organene, komiteene, søkene og sakene du selv har krysset av for.
        </p>

        {visOppsett ? (
          <Oppsett
            steg={steg}
            valg={valg}
            steder={steder}
            stedSok={stedSok}
            stedFeltId={stedFeltId}
            fag={fag}
            overskrift={overskrift}
            lagrer={lagrer}
            valgteSteder={valgteSteder}
            valgteFag={valgteFag}
            onStedSok={setStedSok}
            onToggleToken={toggleToken}
            onToggleListe={toggleListe}
            onNeste={neste}
            onHoppOver={hoppOver}
          />
        ) : (
          <Dashboard
            deler={deler}
            sokListe={sokListe}
            fulgt={fulgt}
            nå={nå}
            sokFeltId={sokFeltId}
            sokNavn={sokNavn}
            sokTekst={sokTekst}
            kanLagre={kanLagre}
            apent={apentAbonnement(valg)}
            onSokNavn={setSokNavn}
            onSokTekst={setSokTekst}
            onLagreSok={() => void lagreSok()}
            onSlettSok={(id) => {
              setSokListe((liste) => liste.filter((s) => s.id !== id));
              if (kanLagre) void onSlettSok?.(id);
            }}
            onFolg={folg}
            onEndre={() => { setSteg(1); setVisOppsett(true); }}
            onLogin={erDemo ? undefined : onLogin}
          />
        )}
      </div>
    </div>
  );
}

function Oppsett({
  steg,
  valg,
  steder,
  stedSok,
  stedFeltId,
  fag,
  overskrift,
  lagrer,
  valgteSteder,
  valgteFag,
  onStedSok,
  onToggleToken,
  onToggleListe,
  onNeste,
  onHoppOver,
}: {
  steg: 1 | 2 | 3;
  valg: MinValg;
  steder: ReturnType<typeof filtrerSteder>;
  stedSok: string;
  stedFeltId: string;
  fag: { id: string; label: string }[];
  overskrift: RefObject<HTMLHeadingElement | null>;
  lagrer: boolean;
  valgteSteder: string[];
  valgteFag: string[];
  onStedSok: (v: string) => void;
  onToggleToken: (tokens: string[], pa: boolean) => void;
  onToggleListe: (nokkel: "organ" | "komiteer" | "fagfelt", id: string) => void;
  onNeste: () => void;
  onHoppOver: () => void;
}) {
  return (
    <section aria-labelledby="minside-steg">
      <p className="kv-steg">Steg {steg} av 3</p>
      <h2 id="minside-steg" tabIndex={-1} ref={overskrift}>
        {steg === 1 ? "Velg sted" : steg === 2 ? "Velg fagområde" : "Du er i gang"}
      </h2>
      {steg === 1 ? (
        <>
          <p className="minside-forklaring">
            Kryss av for kommuner og fylkeskommuner. Stortinget, regjeringen og komiteene ligger her også. Hopper du over, velger du det senere.
          </p>
          <div className="minside-gruppe">
            <p className="kv-feltnavn">Nasjonalt</p>
            <label className="kv-samtykke">
              <input type="checkbox" checked={valg.organ.includes("stortinget")} onChange={() => onToggleListe("organ", "stortinget")} />
              <span>Stortinget</span>
            </label>
            <label className="kv-samtykke">
              <input type="checkbox" checked={valg.organ.includes("regjeringen")} onChange={() => onToggleListe("organ", "regjeringen")} />
              <span>Regjeringen</span>
            </label>
          </div>
          <div className="minside-gruppe">
            <p className="kv-feltnavn">Komiteer og høringer</p>
            {KOMITEER.map((k) => (
              <label className="kv-samtykke" key={k.id}>
                <input type="checkbox" checked={valg.komiteer.includes(k.id)} onChange={() => onToggleListe("komiteer", k.id)} />
                <span>{k.navn}{k.id === "famkult" ? ", med høringer" : ""}</span>
              </label>
            ))}
          </div>
          <Felt id={stedFeltId} label="Søk etter sted" type="search" value={stedSok} onChange={(e) => onStedSok(e.target.value)} placeholder="For eksempel Oslo" />
          <div className="minside-liste" role="group" aria-label="Kommuner og fylkeskommuner">
            {steder.length === 0 ? <p className="minside-tom">Ingen treff. Prøv et annet navn.</p> : null}
            {steder.map((sted) => {
              const pa = sted.tokens.every((t) => valg.geografisk.includes(t));
              return (
                <label className="kv-samtykke" key={sted.id}>
                  <input type="checkbox" checked={pa} onChange={(e) => onToggleToken(sted.tokens, e.target.checked)} />
                  <span>{sted.navn}</span>
                </label>
              );
            })}
          </div>
        </>
      ) : null}
      {steg === 2 ? (
        <>
          <p className="minside-forklaring">
            Velg fagene du vil følge. Uten fag følger du alle fag innen stedene og organene du har krysset av for. Det er samme regel som for varslene.
          </p>
          <div className="minside-gruppe" role="group" aria-label="Fagområder">
            {fag.map((k) => (
              <label className="kv-samtykke" key={k.id}>
                <input type="checkbox" checked={valg.fagfelt.includes(k.id)} onChange={() => onToggleListe("fagfelt", k.id)} />
                <span>{k.label}</span>
              </label>
            ))}
          </div>
        </>
      ) : null}
      {steg === 3 ? (
        <>
          <p className="minside-forklaring">
            Valgene styrer også hvilke saker en senere e-post kan inneholde. Ingenting sendes før utsending blir skrudd på.
          </p>
          <Oppsummering steder={valgteSteder} fag={valgteFag} valg={valg} />
          {!harAvgrensning(valg) ? (
            <p className="minside-forklaring">Du har ikke krysset av for noe. Min side blir tom til du velger.</p>
          ) : null}
        </>
      ) : null}
      <div className="minside-rad">
        <Knapp onClick={onNeste} disabled={lagrer}>{steg === 3 ? "Åpne Min side" : "Neste"}</Knapp>
        <Knapp variant="stille" onClick={onHoppOver} disabled={lagrer}>Hopp over</Knapp>
      </div>
    </section>
  );
}

function Oppsummering({ steder, fag, valg }: { steder: string[]; fag: string[]; valg: MinValg }) {
  const linjer = [
    steder.length ? steder.join(", ") : null,
    valg.organ.map(organNavn).join(", ") || null,
    valg.komiteer.map(komiteNavn).join(", ") || null,
    fag.length ? fag.join(", ") : (harAvgrensning(valg) ? "Alle fagområder" : null),
  ].filter(Boolean);
  if (linjer.length === 0) return null;
  return (
    <ul className="minside-lagret">
      {linjer.map((linje) => <li key={linje}><span>{linje}</span></li>)}
    </ul>
  );
}

function Dashboard({
  deler,
  sokListe,
  fulgt,
  nå,
  sokFeltId,
  sokNavn,
  sokTekst,
  kanLagre,
  apent,
  onSokNavn,
  onSokTekst,
  onLagreSok,
  onSlettSok,
  onFolg,
  onEndre,
  onLogin,
}: {
  deler: ReturnType<typeof delMinSide>;
  sokListe: LagretSok[];
  fulgt: string[];
  nå: Date;
  sokFeltId: string;
  sokNavn: string;
  sokTekst: string;
  kanLagre: boolean;
  apent: boolean;
  onSokNavn: (v: string) => void;
  onSokTekst: (v: string) => void;
  onLagreSok: () => void;
  onSlettSok: (id: string) => void;
  onFolg: (id: string | number) => void;
  onEndre: () => void;
  onLogin?: () => void;
}) {
  const tom = deler.alle.length === 0;
  return (
    <>
      <div className="minside-rad">
        <Knapp variant="linje" onClick={onEndre}>Endre valg</Knapp>
        {!kanLagre && onLogin ? <Knapp variant="stille" onClick={onLogin}>Logg inn for å lagre</Knapp> : null}
      </div>
      {apent ? (
        <p className="minside-forklaring">Varslene dine er på uten avgrensning. Min side viser da alle fag i hele landet, samme regel som e-posten vil bruke.</p>
      ) : null}

      {tom ? (
        <section aria-labelledby="minside-tom">
          <h2 id="minside-tom">Ingenting å vise ennå</h2>
          <p className="minside-forklaring">
            Kryss av for et sted eller et fag, følg en sak, eller lagre et søk. Forsiden viser fortsatt alt.
          </p>
          <Knapp onClick={onEndre}>Velg hva du vil følge</Knapp>
        </section>
      ) : (
        <>
          <Seksjon id="mobiliser" tittel="Mobiliser nå" tom="Ingen saker å mobilisere på nå." saker={deler.mobiliser} nå={nå} fulgt={fulgt} onFolg={onFolg} />
          <Seksjon id="handling" tittel="Du kan gjøre noe" tom="Ingen andre saker med handling mulig." saker={deler.handling} nå={nå} fulgt={fulgt} onFolg={onFolg} />
          <Seksjon id="frister" tittel="Kommende frister" tom="Ingen flere frister i det du følger." saker={deler.frister} nå={nå} fulgt={fulgt} onFolg={onFolg} />
          <Seksjon id="strom" tittel="Strømmen" tom="Strømmen er tom. Alt som haster, ligger over." saker={deler.strom} nå={nå} fulgt={fulgt} onFolg={onFolg} />
          <section aria-labelledby="minside-fulgte">
            <h2 id="minside-fulgte">Saker du følger</h2>
            {deler.fulgte.length === 0 ? <p className="minside-tom">Du følger ingen enkeltsaker.</p> : (
              <ul className="minside-lagret">
                {deler.fulgte.map((sak) => (
                  <li key={sak.id}>
                    <span>
                      <Rollemerke sak={tilSak(sak)} nå={nå} medDetalj={false} />
                      {sak.tittel}
                    </span>
                    <span className="minside-status">{statusTekst(sak.status)} · {datoLang(sak.frist)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section aria-labelledby="minside-sok">
        <h2 id="minside-sok">Lagrede søk</h2>
        <p className="minside-forklaring">Et lagret søk viser saker der ordene finnes i tittel, sammendrag eller instans. Det virker sammen med sakene du følger.</p>
        <div className="minside-sok">
          <Felt id={`${sokFeltId}-navn`} label="Navn" type="text" value={sokNavn} onChange={(e) => onSokNavn(e.target.value)} />
          <Felt id={sokFeltId} label="Søk" type="search" value={sokTekst} onChange={(e) => onSokTekst(e.target.value)} />
          <Knapp onClick={onLagreSok} disabled={!sokTekst.trim()}>Lagre søk</Knapp>
        </div>
        {sokListe.length === 0 ? <p className="minside-tom">Du har ingen lagrede søk.</p> : (
          <ul className="minside-lagret">
            {sokListe.map((s) => (
              <li key={s.id}>
                <span>{s.navn}: {s.sporretekst}</span>
                <Knapp variant="stille" onClick={() => onSlettSok(s.id)}>Fjern</Knapp>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Seksjon({
  id,
  tittel,
  tom,
  saker,
  nå,
  fulgt,
  onFolg,
}: {
  id: string;
  tittel: string;
  tom: string;
  saker: MinSak[];
  nå: Date;
  fulgt: string[];
  onFolg: (id: string | number) => void;
}) {
  return (
    <section aria-labelledby={`minside-${id}`}>
      <h2 id={`minside-${id}`}>{tittel}</h2>
      {saker.length === 0 ? <p className="minside-tom">{tom}</p> : saker.map((sak) => (
        <SakKort key={sak.id} sak={sak} nå={nå} folger={fulgt.includes(String(sak.id))} onFolg={onFolg} />
      ))}
    </section>
  );
}

function SakKort({
  sak,
  nå,
  folger,
  onFolg,
}: {
  sak: MinSak;
  nå: Date;
  folger: boolean;
  onFolg: (id: string | number) => void;
}) {
  const handling = sak.handling === "handling_mulig";
  const kilde = typeof sak.kilde === "string" && sak.kilde.startsWith("http") ? sak.kilde : null;
  return (
    <article className={handling ? "minside-sak handling" : "minside-sak orientering"}>
      <Rollemerke sak={tilSak(sak)} nå={nå} />
      <h3>{sak.tittel}</h3>
      {sak.sammendrag ? <p>{sak.sammendrag}</p> : null}
      <p className="minside-meta">
        {sak.instans || "Ukjent instans"}
        {" · "}
        <span className={sak.frist ? "frist" : undefined}>{datoLang(sak.frist)}</span>
      </p>
      <div className="minside-rad">
        <Knapp variant={folger ? "linje" : "stille"} aria-pressed={folger} onClick={() => onFolg(sak.id)}>
          {folger ? "Følger" : "Følg saken"}
        </Knapp>
        {kilde ? <a className="kv-lenke" href={kilde}>Kilden</a> : null}
      </div>
    </article>
  );
}
