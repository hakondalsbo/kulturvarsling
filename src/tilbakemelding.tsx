import { useEffect, useState } from "react";
import { SUPABASE_ANON, SUPABASE_URL, sb } from "./klient.ts";
import { Dialog, Knapp, Tekstfelt } from "./ui.tsx";
import {
  COOLDOWN_MS,
  DEMO_TILBAKEMELDINGER,
  TEKST_MAKS,
  TILBAKEMELDING_STATUSER,
  TILBAKEMELDING_TYPER,
  filtrerRader,
  leverTilbakemelding,
  statusEtikett,
  typeEtikett,
  type TilbakemeldingRad,
  type TilbakemeldingStatus,
  type TilbakemeldingType,
} from "../supabase/functions/_shared/tilbakemelding.ts";

export type TilbakemeldingKontekst = {
  type?: TilbakemeldingType;
  sakTittel?: string | null;
  sakId?: string | null;
};

const SIST_NOKKEL = "kv-tilbakemelding-sist";
const apnere = new Set<(inn?: TilbakemeldingKontekst) => void>();

export function apneTilbakemelding(inn?: TilbakemeldingKontekst) {
  for (const fn of apnere) fn(inn);
}

function lesSist(): number | null {
  try {
    const tall = Number(sessionStorage.getItem(SIST_NOKKEL));
    return Number.isFinite(tall) && tall > 0 ? tall : null;
  } catch {
    return null;
  }
}

function skrivSist(nå: number) {
  try { sessionStorage.setItem(SIST_NOKKEL, String(nå)); } catch { /* privat vindu */ }
}

function sideNaa(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`.slice(0, 200);
}

async function lesSesjon(): Promise<{ token: string | null; brukerId: string | null }> {
  try {
    const { data } = await sb.auth.getSession();
    return {
      token: data.session?.access_token ?? null,
      brukerId: data.session?.user?.id ?? null,
    };
  } catch {
    return { token: null, brukerId: null };
  }
}

function Skjema({
  start,
  onClose,
}: {
  start: TilbakemeldingKontekst;
  onClose: () => void;
}) {
  const [type, setType] = useState<TilbakemeldingType>(start.type ?? "forslag");
  const [tekst, setTekst] = useState("");
  const [feil, setFeil] = useState("");
  const [laster, setLaster] = useState(false);
  const [sendt, setSendt] = useState(false);
  const side = sideNaa();

  async function send() {
    if (laster) return;
    setLaster(true);
    setFeil("");
    const sesjon = await lesSesjon();
    const utfall = await leverTilbakemelding({
      hent: (url, init) => fetch(url, init),
      supabaseUrl: SUPABASE_URL,
      anonNokkel: SUPABASE_ANON,
      token: sesjon.token,
      brukerId: sesjon.brukerId,
      sistSendt: lesSist(),
      innlegg: {
        type,
        tekst,
        side,
        sak_tittel: start.sakTittel ?? null,
        sak_id: start.sakId ?? null,
      },
    });
    setLaster(false);
    if (!utfall.ok) {
      setFeil(utfall.melding);
      return;
    }
    skrivSist(Date.now());
    setSendt(true);
  }

  return (
    <Dialog tittel={sendt ? "Tilbakemelding lagret" : "Gi tilbakemelding"} onClose={onClose} smal>
      {sendt ? (
        <div className="kv-stakk">
          <p className="kv-brod">Takk. Tilbakemeldingen er lagret og brukes til å justere tjenesten.</p>
          <Knapp variant="linje" onClick={onClose}>Lukk</Knapp>
        </div>
      ) : (
        <div className="kv-stakk">
          <p className="kv-meta">Side: {side}</p>
          {start.sakTittel ? <p className="kv-meta">Sak: {start.sakTittel}</p> : null}
          <div>
            <p className="kv-feltnavn">Hva gjelder det?</p>
            <div className="kv-valg" role="group" aria-label="Kategori">
              {TILBAKEMELDING_TYPER.map((valg) => (
                <button
                  type="button"
                  key={valg.id}
                  aria-pressed={type === valg.id}
                  onClick={() => setType(valg.id)}
                >
                  {valg.label}
                </button>
              ))}
            </div>
          </div>
          <Tekstfelt
            id="tilbakemelding-tekst"
            label="Hva bør justeres?"
            value={tekst}
            maxLength={TEKST_MAKS}
            rows={5}
            placeholder="Beskriv kort hva du så, og hva du forventet."
            onChange={(e) => setTekst(e.target.value)}
          />
          <p className="kv-meta">
            Ikke skriv sensitive personopplysninger. Trenger du svar, skriv til post@kulturvarsling.no.
          </p>
          {feil ? <p className="kv-feil" role="alert">{feil}</p> : null}
          <div className="kv-klynge">
            <Knapp className="vokse" disabled={laster || tekst.trim().length < 8} onClick={() => void send()}>
              {laster ? "Sender" : "Send tilbakemelding"}
            </Knapp>
            <Knapp variant="linje" onClick={onClose}>Avbryt</Knapp>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function TilbakemeldingLag() {
  const [apen, setApen] = useState<TilbakemeldingKontekst | null>(null);

  useEffect(() => {
    const fn = (inn?: TilbakemeldingKontekst) => setApen(inn ?? {});
    apnere.add(fn);
    const q = new URLSearchParams(window.location.search);
    if (q.get("tilbakemelding") === "apne") {
      setApen({});
      q.delete("tilbakemelding");
      const neste = q.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${neste ? `?${neste}` : ""}${window.location.hash}`);
    }
    return () => { apnere.delete(fn); };
  }, []);

  useEffect(() => {
    document.body.dataset.tilbakemelding = apen ? "apne" : "";
    if (!apen) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setApen(null);
    };
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.dataset.tilbakemelding = "";
    };
  }, [apen]);

  return (
    <>
      <button type="button" className="kv-tilbakemelding-knapp" onClick={() => setApen({})}>
        Gi tilbakemelding
      </button>
      {apen ? <Skjema start={apen} onClose={() => setApen(null)} /> : null}
    </>
  );
}

function formatDato(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("nb-NO", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function TilbakemeldingOversikt({ eksempel = false }: { eksempel?: boolean }) {
  const [status, setStatus] = useState<TilbakemeldingStatus | "">("");
  const [type, setType] = useState<TilbakemeldingType | "">("");
  const [rader, setRader] = useState<TilbakemeldingRad[]>(eksempel ? DEMO_TILBAKEMELDINGER : []);
  const [lastet, setLastet] = useState(eksempel);
  const [feil, setFeil] = useState("");
  const [lagrer, setLagrer] = useState<string | null>(null);

  useEffect(() => {
    if (!eksempel) return;
    setRader(DEMO_TILBAKEMELDINGER);
    setLastet(true);
    setFeil("");
  }, [eksempel]);

  useEffect(() => {
    if (eksempel) return;
    let aktiv = true;
    setLastet(false);
    setFeil("");
    void (async () => {
      const sesjon = await lesSesjon();
      if (!sesjon.token) {
        if (aktiv) {
          setFeil("Logg inn med en teamkonto for å se oversikten.");
          setRader([]);
          setLastet(true);
        }
        return;
      }
      let res: Response;
      try {
        res = await fetch(`${SUPABASE_URL}/functions/v1/tilbakemeldinger`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_ANON,
            Authorization: `Bearer ${sesjon.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ handling: "list", status: status || null, type: type || null }),
        });
      } catch {
        if (aktiv) {
          setFeil("Kunne ikke nå oversikten. Prøv igjen.");
          setLastet(true);
        }
        return;
      }
      let body: { ok?: boolean; feil?: string; rader?: TilbakemeldingRad[] } = {};
      try { body = await res.json(); } catch { body = {}; }
      if (!aktiv) return;
      if (res.status === 404) {
        setFeil("Oversikten er ikke koblet på ennå.");
        setRader([]);
      } else if (!res.ok || !body.ok) {
        setFeil(body.feil || "Kunne ikke hente tilbakemeldingene.");
        setRader([]);
      } else {
        setRader(body.rader ?? []);
      }
      setLastet(true);
    })();
    return () => { aktiv = false; };
  }, [eksempel, status, type]);

  async function settStatus(id: string, neste: TilbakemeldingStatus) {
    if (eksempel) {
      setRader((liste) => liste.map((rad) => rad.id === id ? { ...rad, status: neste } : rad));
      return;
    }
    setLagrer(id);
    setFeil("");
    const sesjon = await lesSesjon();
    if (!sesjon.token) {
      setFeil("Logg inn med en teamkonto for å oppdatere status.");
      setLagrer(null);
      return;
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/tilbakemeldinger`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${sesjon.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ handling: "status", id, status: neste }),
      });
      const body = await res.json().catch(() => ({})) as { ok?: boolean; feil?: string };
      if (!res.ok || !body.ok) {
        setFeil(body.feil || "Kunne ikke oppdatere statusen.");
      } else {
        setRader((liste) => liste.map((rad) => rad.id === id ? { ...rad, status: neste } : rad));
      }
    } catch {
      setFeil("Kunne ikke nå oversikten. Prøv igjen.");
    }
    setLagrer(null);
  }

  const synlige = filtrerRader(rader, { status, type });

  return (
    <div className="kv-stakk" data-eksempel={eksempel ? "ja" : "nei"}>
      {eksempel ? (
        <p className="kv-meta">Eksempel. Ingenting er hentet fra databasen, og ingenting lagres.</p>
      ) : (
        <p className="kv-brod">Tilbakemeldinger fra prøvedriften. Bare teamkontoer som er satt på serveren, kan lese listen.</p>
      )}
      <div>
        <p className="kv-feltnavn">Status</p>
        <div className="kv-valg" role="group" aria-label="Filtrer status">
          <button type="button" aria-pressed={status === ""} onClick={() => setStatus("")}>Alle</button>
          {TILBAKEMELDING_STATUSER.map((valg) => (
            <button type="button" key={valg.id} aria-pressed={status === valg.id} onClick={() => setStatus(valg.id)}>{valg.label}</button>
          ))}
        </div>
      </div>
      <div>
        <p className="kv-feltnavn">Type</p>
        <div className="kv-valg" role="group" aria-label="Filtrer type">
          <button type="button" aria-pressed={type === ""} onClick={() => setType("")}>Alle</button>
          {TILBAKEMELDING_TYPER.map((valg) => (
            <button type="button" key={valg.id} aria-pressed={type === valg.id} onClick={() => setType(valg.id)}>{valg.label}</button>
          ))}
        </div>
      </div>
      {feil ? <p className="kv-feil" role="alert">{feil}</p> : null}
      {!lastet ? <p className="kv-meta">Henter</p> : null}
      {lastet && synlige.length === 0 && !feil ? <p className="kv-tom">Ingen tilbakemeldinger i utvalget.</p> : null}
      <ul className="kv-liste">
        {synlige.map((rad) => (
          <li key={rad.id} className="kv-rad">
            <p className="kv-meta">
              {typeEtikett(rad.type)} · {statusEtikett(rad.status)} · {formatDato(rad.opprettet)}
              {rad.bruker_id ? " · innlogget" : " · ikke innlogget"}
            </p>
            <p>{rad.tekst}</p>
            <p className="kv-meta">
              {rad.side ? `Side: ${rad.side}` : "Side ikke oppgitt"}
              {rad.sak_tittel ? ` · Sak: ${rad.sak_tittel}` : ""}
              {rad.sak_id ? ` · ${rad.sak_id}` : ""}
            </p>
            <label className="kv-felt" htmlFor={`status-${rad.id}`}>
              <span>Status</span>
              <select
                id={`status-${rad.id}`}
                className="kv-input"
                value={rad.status}
                disabled={lagrer === rad.id}
                onChange={(e) => void settStatus(rad.id, e.target.value as TilbakemeldingStatus)}
              >
                {TILBAKEMELDING_STATUSER.map((valg) => (
                  <option key={valg.id} value={valg.id}>{valg.label}</option>
                ))}
              </select>
            </label>
          </li>
        ))}
      </ul>
      <p className="kv-meta">Ventetid mellom sendinger i skjemaet er {Math.round(COOLDOWN_MS / 1000)} sekunder. Listen leses ikke av vanlige brukere.</p>
    </div>
  );
}
