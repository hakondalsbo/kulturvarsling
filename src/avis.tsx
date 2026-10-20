import { useEffect, useMemo, useRef, useState } from "react";
import { utvalgErDekket } from "./preferanser.ts";

/**
 * Presentasjon for Kulturavisen v2.
 * Ingen datahenting: flatene får saker inn og kaller tilbake når noen trykker.
 */

export type Sak = {
  id: string | number;
  tittel?: string;
  sammendrag?: string;
  instans?: string;
  kategori?: string;
  nivå?: string;
  niva?: string;
  sted?: string;
  fylkesnr?: string | number | null;
  kommunenr?: string | number | null;
  frist?: string | null;
  status?: string;
  opprettet?: string;
  kilde?: string;
};

export type Fylke = { nr: string; navn: string };

export type KildeRad = {
  navn?: string;
  niva?: string;
  organ?: string;
  sist_hentet?: string | null;
  sist_status?: string | null;
};

export type SakFane = "info" | "horingssvar" | "del";

type Geo =
  | { type: "alle" }
  | { type: "nasjonalt" }
  | { type: "fylke"; nr: string; navn: string }
  | { type: "kommune"; sted: string; fylkesnr: string | null };

type FagValg = { id: string; label: string; n: number };

const FAGOMRADER: FagValg[] = [
  { id: "scenekunst", label: "Scenekunst", n: 0 },
  { id: "musikk", label: "Musikk", n: 0 },
  { id: "dans", label: "Dans", n: 0 },
  { id: "opera", label: "Opera", n: 0 },
  { id: "litteratur", label: "Litteratur", n: 0 },
  { id: "film", label: "Film & TV", n: 0 },
  { id: "visuell", label: "Visuell kunst", n: 0 },
  { id: "museer", label: "Museer", n: 0 },
  { id: "spill", label: "Spill", n: 0 },
  { id: "kulturarv", label: "Kulturarv & bygg", n: 0 },
];

const NIVAA_NAVN: Record<string, string> = {
  nasjonalt: "Nasjonalt",
  fylke: "Fylkeskommunalt",
  kommune: "Kommunalt",
  tverrgaende: "Tverrgående",
};

export function tolkKildeStatus(status: string | null | undefined) {
  const s = status || "";
  if (s === "ok" || s === "ok_nye") return { frisk: true, tone: "ok" as const, tekst: "Frisk" };
  if (s === "ok_ingen_nye") return { frisk: true, tone: "tom" as const, tekst: "Ingen nye sist" };
  if (s === "tom") return { frisk: true, tone: "tom" as const, tekst: "Tomt svar" };
  if (s === "feil_tomt_svar") return { frisk: false, tone: "feil" as const, tekst: "Alarm: tomt svar" };
  if (s === "delvis") return { frisk: false, tone: "tom" as const, tekst: "Delvis" };
  if (!s) return { frisk: false, tone: "feil" as const, tekst: "Ukjent" };
  return { frisk: false, tone: "feil" as const, tekst: "Feil" };
}

function nivaa(s: Sak) {
  return s.nivå || s.niva || "";
}

function fagLabel(id?: string) {
  if (!id) return "Uten fagområde";
  return FAGOMRADER.find((f) => f.id === id)?.label ?? id.charAt(0).toUpperCase() + id.slice(1);
}

function nivaaTekst(s: Sak) {
  const n = nivaa(s);
  if (n === "nasjonalt") return "Nasjonalt";
  if (n === "fylke") return "Fylke";
  if (n === "kommune") return "Kommune";
  return s.sted || "Ukjent nivå";
}

function dagStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function dagerTil(frist: string, nå: Date) {
  const a = dagStart(new Date(`${frist}T12:00:00`));
  const b = dagStart(nå);
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function mandag(nå: Date) {
  const x = dagStart(nå);
  const avvik = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - avvik);
  return x;
}

function isoUke(nå: Date) {
  const x = new Date(Date.UTC(nå.getFullYear(), nå.getMonth(), nå.getDate()));
  const dag = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dag);
  const start = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x.getTime() - start.getTime()) / 86400000 + 1) / 7);
}

export function datoMeta(antall: number | null, nå = new Date()) {
  const rå = new Intl.DateTimeFormat("nb-NO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(nå);
  const pen = rå.charAt(0).toUpperCase() + rå.slice(1);
  const saker = antall == null ? "" : ` · ${antall} ${antall === 1 ? "sak" : "saker"}`;
  return `${pen} · uke ${isoUke(nå)}${saker}`;
}

function erHaster(s: Sak, nå: Date) {
  if (!s.frist || s.status === "passert") return false;
  const d = dagerTil(s.frist, nå);
  return d >= 0 && d <= 7;
}

function erSnart(s: Sak, nå: Date) {
  if (!s.frist || erHaster(s, nå)) return false;
  const d = dagerTil(s.frist, nå);
  return d > 7 && d <= 21;
}

function erNy(s: Sak, nå: Date) {
  if (!s.opprettet) return false;
  return nå.getTime() - new Date(s.opprettet).getTime() < 7 * 86400000;
}

function datoDeler(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const mnd = d.toLocaleDateString("nb-NO", { month: "short" }).replace(".", "");
  return { dag: d.getDate(), mnd };
}

function omDager(s: Sak, nå: Date) {
  if (!s.frist) return "ingen frist";
  const d = dagerTil(s.frist, nå);
  if (d < 0) return "frist passert";
  if (d === 0) return "i dag";
  if (d === 1) return "i morgen";
  return `om ${d} dager`;
}

function fristLinje(s: Sak, nå: Date) {
  if (!s.frist) return "Ingen frist er satt";
  const d = new Date(`${s.frist}T12:00:00`);
  const ukedag = d.toLocaleDateString("nb-NO", { weekday: "long" });
  const lang = d.toLocaleDateString("nb-NO", { day: "numeric", month: "long" });
  return `Frist ${ukedag} ${lang} – ${omDager(s, nå)}`;
}

function kortDato(iso?: string | null) {
  if (!iso) return "";
  const { dag, mnd } = datoDeler(iso);
  return `${dag}. ${mnd}`;
}

type UkeNokkel = "denne" | "neste" | "senere" | "passert" | "uten";

function erPassert(s: Sak, nå: Date) {
  if (s.status === "passert" && !s.frist) return true;
  if (!s.frist) return false;
  return dagerTil(s.frist, nå) < 0 || s.status === "passert";
}

function ukeNokkel(s: Sak, nå: Date): UkeNokkel {
  if (erPassert(s, nå)) return "passert";
  if (!s.frist) return "uten";
  const frist = dagStart(new Date(`${s.frist}T12:00:00`));
  const start = mandag(nå);
  const neste = new Date(start);
  neste.setDate(start.getDate() + 7);
  const etter = new Date(start);
  etter.setDate(start.getDate() + 14);
  if (frist < neste) return "denne";
  if (frist < etter) return "neste";
  return "senere";
}

function ukeTekst(nokkel: UkeNokkel, nå: Date) {
  const start = mandag(nå);
  const slutt = new Date(start);
  slutt.setDate(start.getDate() + 6);
  const neste = new Date(start);
  neste.setDate(start.getDate() + 7);
  const nesteSlutt = new Date(start);
  nesteSlutt.setDate(start.getDate() + 13);
  const fmt = (d: Date) => d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" }).replace(".", "");
  if (nokkel === "denne") return { tittel: "Denne uka", under: `${fmt(start)}–${fmt(slutt)}` };
  if (nokkel === "neste") return { tittel: "Neste uke", under: `${fmt(neste)} – ${fmt(nesteSlutt)}` };
  if (nokkel === "senere") return { tittel: "Senere", under: "frister lenger fram" };
  if (nokkel === "passert") return { tittel: "Passert", under: "frist eller møte er ute" };
  return { tittel: "Uten frist", under: "nyeste først" };
}

function osloDeler(iso: string) {
  const deler = new Intl.DateTimeFormat("nb-NO", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hent = (t: string) => deler.find((d) => d.type === t)?.value ?? "";
  return { dato: `${hent("year")}-${hent("month")}-${hent("day")}`, time: Number(hent("hour")), kl: `${hent("hour")}.${hent("minute")}` };
}

function tidsord(iso: string, nå: Date) {
  const da = osloDeler(iso);
  const nu = osloDeler(nå.toISOString());
  if (da.dato !== nu.dato) {
    const diff = (Date.parse(nu.dato) - Date.parse(da.dato)) / 86400000;
    if (diff === 1) return "i går";
    return new Date(`${da.dato}T12:00:00`).toLocaleDateString("nb-NO", { day: "numeric", month: "long" });
  }
  if (da.time < 5) return "i natt";
  if (da.time < 10) return "i morges";
  if (da.time < 17) return "i dag";
  return "i kveld";
}

function kortKildenavn(navn?: string) {
  if (!navn) return "En kilde";
  const kutt = navn.split("–")[0]?.split("—")[0]?.trim() || navn;
  return kutt.length > 48 ? `${kutt.slice(0, 45)}…` : kutt;
}

export function oppsummerKilder(kilder: KildeRad[], nå = new Date()) {
  const trege = kilder.filter((k) => !tolkKildeStatus(k.sist_status).frisk);
  const friske = kilder.length - trege.length;
  const sist = kilder.map((k) => k.sist_hentet).filter((x): x is string => !!x).sort().at(-1);
  const når = sist ? tidsord(sist, nå) : "sist";
  const kl = sist ? osloDeler(sist).kl : "";
  let setning: string;
  if (trege.length === 0) setning = `Alle kilder sjekket ${når}${kl ? ` kl. ${kl}` : ""}.`;
  else if (trege.length === 1) setning = `${friske} av ${kilder.length} kilder sjekket ${når} – ${kortKildenavn(trege[0]?.navn)} er forsinket.`;
  else setning = `${friske} av ${kilder.length} kilder sjekket ${når} – ${trege.length} kilder er forsinket.`;
  return { setning, forsinket: trege.length > 0 };
}

export function KildeSetning({ kilder, onÅpne }: { kilder: KildeRad[] | null; onÅpne: () => void }) {
  if (!kilder || kilder.length === 0) return null;
  const s = oppsummerKilder(kilder);
  return (
    <span className="avis-kildelinje">
      <i className={s.forsinket ? "er-oker" : undefined} aria-hidden="true" />
      <span>
        {s.setning}{" "}
        <button type="button" onClick={onÅpne}>Se kildene</button>
      </span>
    </span>
  );
}

export function KildeDetaljer({ kilder, lastet }: { kilder: KildeRad[]; lastet: boolean }) {
  const oppsummert = kilder.length ? oppsummerKilder(kilder) : null;
  const grupper = ["nasjonalt", "fylke", "kommune", "tverrgaende"]
    .map((n) => [n, kilder.filter((k) => k.niva === n)] as const)
    .filter(([, ks]) => ks.length > 0);
  return (
    <div className="avis-kildevisning">
      <h1>Kildene</h1>
      <p className="innledning">
        {oppsummert ? oppsummert.setning : "Kulturvarsling henter saker fra offentlige kilder."}{" "}
        Under ligger hver kilde, med det siste vi fikk vite.
      </p>
      {!lastet ? (
        <div className="avis-skjelett" aria-hidden="true"><i /><i /><i /></div>
      ) : (
        grupper.map(([nivå, ks]) => (
          <div key={nivå} className="avis-kildegruppe">
            <span className="avis-versal">{NIVAA_NAVN[nivå] || nivå}</span>
            <ul className="avis-kildeliste">
              {ks.map((k, i) => {
                const vis = tolkKildeStatus(k.sist_status);
                const tone = vis.tone === "ok" ? "" : vis.tone === "tom" ? "tom" : "feil";
                return (
                  <li key={`${k.navn ?? "kilde"}-${i}`}>
                    <div className="navn">
                      {k.navn || "Uten navn"}
                      {k.organ ? <small>{k.organ}</small> : null}
                    </div>
                    <div className={`status ${tone}`}>
                      <b>{vis.tekst}</b>
                      {k.sist_hentet ? osloDeler(k.sist_hentet).kl : "ikke ennå"}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
      <p className="forklaring">
        «Ingen nye sist» betyr at kilden svarte med treff, men ingenting nytt ble lagt inn etter filter og dedup.
        «Tomt svar» er et ekte 0 fra en kilde som kan være tom. «Alarm: tomt svar» er en kilde som vanligvis har treff, og som svarte 0 rå – det er ikke «ingen nye».
        «Delvis» betyr at noe svarte og noe feilet. «Feil» er et kall som feilet. En kilde som svikter tre netter på rad flagges automatisk.
      </p>
    </div>
  );
}

function velgHovedsak(saker: Sak[], nå: Date) {
  const medFrist = saker
    .filter((s) => s.frist && dagerTil(s.frist, nå) >= 0)
    .sort((a, b) => dagerTil(a.frist as string, nå) - dagerTil(b.frist as string, nå));
  const haster = medFrist.find((s) => erHaster(s, nå));
  if (haster) return haster;
  if (medFrist[0]) return medFrist[0];
  return [...saker].sort((a, b) => {
    const rang = (s: Sak) => (s.status === "kritisk" ? 0 : s.status === "viktig" ? 1 : 2);
    const diff = rang(a) - rang(b);
    if (diff !== 0) return diff;
    return (b.opprettet || "").localeCompare(a.opprettet || "");
  })[0] ?? null;
}

function ogsaaDenneUka(saker: Sak[], lead: Sak | null, nå: Date) {
  const resten = saker.filter((s) => s.id !== lead?.id);
  const uke = mandag(nå);
  const grense = new Date(uke);
  grense.setDate(uke.getDate() + 7);
  const medFrist = resten.filter((s) => {
    if (!s.frist) return false;
    const f = dagStart(new Date(`${s.frist}T12:00:00`));
    return f >= uke && f < grense;
  });
  if (medFrist.length > 0) return { tittel: "Også denne uka", saker: medFrist.slice(0, 3) };
  const syvDager = nå.getTime() - 7 * 86400000;
  const iUka = resten
    .filter((s) => s.opprettet && new Date(s.opprettet).getTime() >= syvDager)
    .sort((a, b) => (b.opprettet || "").localeCompare(a.opprettet || ""));
  if (iUka.length > 0) return { tittel: "Også denne uka", saker: iUka.slice(0, 3) };
  const siste = [...resten].sort((a, b) => (b.opprettet || "").localeCompare(a.opprettet || ""));
  return { tittel: "Andre saker", saker: siste.slice(0, 3) };
}

export function ForsideAvis({
  saker,
  lastet,
  fulgte,
  onToggleFølg,
  onÅpne,
  onAlle,
  kampanjeAntall,
  onKampanjer,
}: {
  saker: Sak[];
  lastet: boolean;
  fulgte: Array<string | number>;
  onToggleFølg: (id: string | number) => void;
  onÅpne: (sak: Sak, fane: SakFane) => void;
  onAlle: () => void;
  kampanjeAntall: number;
  onKampanjer: () => void;
}) {
  const nå = new Date();
  const lead = velgHovedsak(saker, nå);
  const side = ogsaaDenneUka(saker, lead, nå);
  const følger = lead ? fulgte.includes(lead.id) : false;
  return (
    <>
      <section className="avis-forside avis-wrap">
        <article className="avis-lead">
          {!lastet ? (
            <div className="avis-skjelett" aria-hidden="true"><i /><i /><i /></div>
          ) : !lead ? (
            <div>
              <h1>Ingen åpne saker akkurat nå</h1>
              <p className="avis-ingress">Vi følger kildene og legger saker her så snart de er inne.</p>
            </div>
          ) : (
            <>
              <div className="avis-kicker avis-versal">
                {erHaster(lead, nå) ? <b>Haster</b> : erSnart(lead, nå) ? <b className="snart">Snart</b> : null}
                {(erHaster(lead, nå) || erSnart(lead, nå)) ? " · " : null}
                {fagLabel(lead.kategori)} · {nivaaTekst(lead)}
              </div>
              <h1>{lead.tittel}</h1>
              {lead.sammendrag ? <p className="avis-ingress">{lead.sammendrag}</p> : null}
              <div className="avis-frist">
                {lead.frist ? (
                  <div className={erSnart(lead, nå) && !erHaster(lead, nå) ? "dag snart" : "dag"}>
                    {datoDeler(lead.frist).dag}
                    <small>{datoDeler(lead.frist).mnd}</small>
                  </div>
                ) : null}
                <p>
                  <strong>{fristLinje(lead, nå)}</strong>
                  {lead.instans || lead.sted || "Kilde ikke oppgitt"}
                </p>
              </div>
              <div className="avis-handlinger">
                <button type="button" className="avis-btn" onClick={() => onÅpne(lead, "horingssvar")}>Skriv innspill</button>
                <button type="button" className={følger ? "avis-stille folger" : "avis-stille"} onClick={() => onToggleFølg(lead.id)}>
                  {følger ? "Følger" : "Følg saken"}
                </button>
                <button type="button" className="avis-stille" onClick={() => onÅpne(lead, "del")}>Del</button>
                <button type="button" className="avis-stille" onClick={() => onÅpne(lead, "info")}>Hva betyr dette</button>
              </div>
            </>
          )}
        </article>
        <aside className="avis-spalte">
          <span className="avis-versal">{side.tittel}</span>
          <ul className="avis-uka">
            {side.saker.map((s) => (
              <li key={s.id}>
                <button type="button" className="saklenke" onClick={() => onÅpne(s, "info")}>
                  <div className="d">
                    <b className={s.frist && erHaster(s, nå) ? undefined : "rolig"}>{kortDato(s.frist || s.opprettet)}</b>
                    {s.instans ? ` · ${s.instans}` : ""}
                  </div>
                  <h3>{s.tittel}</h3>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="avis-uka-alle" onClick={onAlle}>Alle frister</button>
          {kampanjeAntall > 0 ? (
            <p className="avis-kampanjehint">
              {kampanjeAntall} {kampanjeAntall === 1 ? "kampanje" : "kampanjer"} pågår.{" "}
              <button type="button" onClick={onKampanjer}>Se kampanjene</button>
            </p>
          ) : null}
        </aside>
      </section>
      <section className="avis-metode" id="metode">
        <div className="avis-wrap">
          <span className="avis-versal">Slik jobber vi</span>
          <div className="avis-steg">
            <div>
              <h3><span>1</span>Vi følger kildene</h3>
              <p>Stortinget, departementene, Kulturrådet, fylker og kommuner – kontrollert hver natt.</p>
            </div>
            <div>
              <h3><span>2</span>Vi sorterer for deg</h3>
              <p>Hver sak får fagområde, sted og frist, og et kort sammendrag.</p>
            </div>
            <div>
              <h3><span>3</span>Du får vite i tide</h3>
              <p>Velg fagområdene dine, så sier vi fra før fristen – med lenke til originaldokumentet.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function synligeFag(saker: Sak[], valgt: string, prioritet: string[]) {
  const kjente = new Set(FAGOMRADER.map((f) => f.id));
  const ekstra = [...new Set(saker.map((s) => s.kategori).filter((id): id is string => !!id && !kjente.has(id)))];
  const alleIder = [...FAGOMRADER.map((f) => f.id), ...ekstra];
  const medTall: FagValg[] = alleIder.map((id) => ({
    id,
    label: fagLabel(id),
    n: saker.filter((s) => s.kategori === id).length,
  }));
  const pri = prioritet.filter((id) => alleIder.includes(id));
  const resten = medTall
    .filter((f) => !pri.includes(f.id))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "nb"));
  const rekkefolge = [...pri.map((id) => medTall.find((f) => f.id === id)!), ...resten];
  let rad = rekkefolge.filter((f) => f.n > 0).slice(0, 4);
  if (valgt !== "alle" && !rad.some((f) => f.id === valgt)) {
    const valgtFag = medTall.find((f) => f.id === valgt);
    if (valgtFag) rad = [...rad.slice(0, 3), valgtFag];
  }
  const iRad = new Set(rad.map((f) => f.id));
  return { rad, flere: rekkefolge.filter((f) => !iRad.has(f.id)) };
}

function geoErLik(a: Geo, b: Geo) {
  if (a.type !== b.type) return false;
  if (a.type === "fylke" && b.type === "fylke") return a.nr === b.nr;
  if (a.type === "kommune" && b.type === "kommune") return a.sted === b.sted;
  return true;
}

function matcherGeo(s: Sak, g: Geo) {
  if (g.type === "alle") return true;
  const n = nivaa(s);
  if (g.type === "nasjonalt") return n === "nasjonalt";
  if (g.type === "fylke") return String(s.fylkesnr ?? "") === g.nr;
  const sted = (s.sted || "").toLowerCase();
  const instans = (s.instans || "").toLowerCase();
  const navn = g.sted.toLowerCase();
  const kommunen = n === "kommune" && (sted === navn || sted.startsWith(`${navn} `) || instans.includes(navn));
  const fylket = n === "fylke" && !!g.fylkesnr && String(s.fylkesnr ?? "") === g.fylkesnr;
  return kommunen || fylket;
}

function geoKnappTekst(g: Geo) {
  if (g.type === "alle") return "Hele landet";
  if (g.type === "nasjonalt") return "Bare nasjonale";
  if (g.type === "fylke") return g.navn;
  return g.sted;
}

type GeoValg = { id: string; label: string; n: number | null; geo: Geo | null };

function byggGeoValg(saker: Sak[], fylker: Fylke[], minFylke: string | null, sok: string, alleFylker: boolean): GeoValg[] {
  const q = sok.trim().toLowerCase();
  const antall = (pred: (s: Sak) => boolean) => saker.filter(pred).length;
  const liste: GeoValg[] = [
    { id: "alle", label: "Hele landet", n: saker.length, geo: { type: "alle" } },
    { id: "nas", label: "Bare nasjonale saker", n: antall((s) => nivaa(s) === "nasjonalt"), geo: { type: "nasjonalt" } },
  ];
  if (minFylke) {
    const mitt = fylker.find((f) => f.nr === minFylke);
    if (mitt) {
      liste.push({
        id: "mitt",
        label: `Mitt fylke · ${mitt.navn}`,
        n: antall((s) => String(s.fylkesnr ?? "") === mitt.nr),
        geo: { type: "fylke", nr: mitt.nr, navn: mitt.navn },
      });
    }
  }
  const fylkeRader = fylker
    .map((f) => ({ f, n: antall((s) => String(s.fylkesnr ?? "") === f.nr) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.f.navn.localeCompare(b.f.navn, "nb"));
  const vist = alleFylker || q ? fylkeRader : fylkeRader.slice(0, 5);
  for (const x of vist) {
    if (liste.some((v) => v.geo?.type === "fylke" && v.geo.nr === x.f.nr)) continue;
    liste.push({ id: `f-${x.f.nr}`, label: x.f.navn, n: x.n, geo: { type: "fylke", nr: x.f.nr, navn: x.f.navn } });
  }
  if (!alleFylker && !q && fylkeRader.length > 5) {
    liste.push({ id: "flere-fylker", label: "Alle fylker …", n: null, geo: null });
  }
  const kommuner = new Map<string, { sted: string; fylkesnr: string | null; n: number }>();
  for (const s of saker) {
    if (nivaa(s) !== "kommune" || !s.sted) continue;
    const cur = kommuner.get(s.sted) ?? { sted: s.sted, fylkesnr: s.fylkesnr ? String(s.fylkesnr) : null, n: 0 };
    cur.n += 1;
    kommuner.set(s.sted, cur);
  }
  if (q.length >= 2) {
    for (const k of [...kommuner.values()].sort((a, b) => a.sted.localeCompare(b.sted, "nb"))) {
      if (!k.sted.toLowerCase().includes(q)) continue;
      liste.push({
        id: `k-${k.sted}`,
        label: k.sted,
        n: k.n,
        geo: { type: "kommune", sted: k.sted, fylkesnr: k.fylkesnr },
      });
    }
  }
  if (!q) return liste;
  return liste.filter((v) => v.id === "alle" || v.id === "nas" || v.label.toLowerCase().includes(q) || v.geo?.type === "kommune");
}

function Handling({
  sak,
  fulgte,
  nå,
  onToggleFølg,
  onÅpne,
}: {
  sak: Sak;
  fulgte: Array<string | number>;
  nå: Date;
  onToggleFølg: (id: string | number) => void;
  onÅpne: (sak: Sak, fane: SakFane) => void;
}) {
  const følger = fulgte.includes(sak.id);
  if (erHaster(sak, nå)) {
    return <button type="button" className="avis-gjor prim" onClick={() => onÅpne(sak, "horingssvar")}>Skriv innspill</button>;
  }
  if (følger) {
    return <button type="button" className="avis-gjor folger" onClick={() => onToggleFølg(sak.id)}>Følger</button>;
  }
  return <button type="button" className="avis-gjor" onClick={() => onToggleFølg(sak.id)}>Følg</button>;
}

export function VarselArkiv({
  saker,
  fulgte,
  onToggleFølg,
  onÅpne,
  minFylke,
  fylker,
  prioriterteFag,
  varslerAktive = false,
  geografisk = [],
  onToggleVarsler,
}: {
  saker: Sak[];
  fulgte: Array<string | number>;
  onToggleFølg: (id: string | number) => void;
  onÅpne: (sak: Sak, fane: SakFane) => void;
  minFylke: string | null;
  fylker: Fylke[];
  prioriterteFag: string[];
  varslerAktive?: boolean;
  geografisk?: string[];
  onToggleVarsler?: (kat: string, geo: Geo) => void;
}) {
  const nå = new Date();
  const [kat, setKat] = useState("alle");
  const [geo, setGeo] = useState<Geo>({ type: "alle" });
  const [visning, setVisning] = useState<"notiser" | "tabell">("notiser");
  const [søk, setSøk] = useState("");
  const [bareFulgte, setBareFulgte] = useState(false);
  const [flereÅpen, setFlereÅpen] = useState(false);
  const [geoÅpen, setGeoÅpen] = useState(false);
  const [geoSok, setGeoSok] = useState("");
  const [alleFylker, setAlleFylker] = useState(false);
  const [utvidet, setUtvidet] = useState(false);
  const geoWrap = useRef<HTMLDivElement>(null);
  const geoSokRef = useRef<HTMLInputElement>(null);
  const geoKnapp = useRef<HTMLButtonElement>(null);
  const geoPanel = useRef<HTMLDivElement>(null);

  const { rad, flere } = useMemo(() => synligeFag(saker, kat, prioriterteFag), [saker, kat, prioriterteFag]);
  const iFag = useMemo(() => saker.filter((s) => kat === "alle" || s.kategori === kat), [saker, kat]);
  const geoValg = useMemo(
    () => byggGeoValg(iFag, fylker, minFylke, geoSok, alleFylker),
    [iFag, fylker, minFylke, geoSok, alleFylker],
  );
  const filtrert = useMemo(() => {
    const q = søk.trim().toLowerCase();
    return iFag.filter((s) => {
      if (!matcherGeo(s, geo)) return false;
      if (bareFulgte && !fulgte.includes(s.id)) return false;
      if (!q) return true;
      const hay = `${s.tittel ?? ""} ${s.sammendrag ?? ""} ${s.instans ?? ""} ${s.sted ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [iFag, geo, bareFulgte, fulgte, søk]);

  const fagNavn = kat === "alle" ? "" : fagLabel(kat).toLowerCase();
  const setning = filtrert.length === 1 ? "1 sak" : `${filtrert.length} saker`;

  useEffect(() => {
    if (!geoÅpen) return;
    const t = window.setTimeout(() => geoSokRef.current?.focus(), 0);
    const ute = (e: MouseEvent) => {
      if (!geoWrap.current?.contains(e.target as Node)) setGeoÅpen(false);
    };
    document.addEventListener("mousedown", ute);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", ute);
    };
  }, [geoÅpen]);

  function velgGeo(valg: GeoValg) {
    if (!valg.geo) {
      setAlleFylker(true);
      return;
    }
    setGeo(valg.geo);
    setGeoÅpen(false);
    setGeoSok("");
    geoKnapp.current?.focus();
  }

  function geoTaster(e: React.KeyboardEvent<HTMLDivElement>) {
    const panel = geoPanel.current;
    if (!panel) return;
    const opts = [...panel.querySelectorAll<HTMLButtonElement>("[data-geo]")];
    const i = opts.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      opts[Math.min(opts.length - 1, i < 0 ? 0 : i + 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (i <= 0) geoSokRef.current?.focus();
      else opts[i - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setGeoÅpen(false);
      geoKnapp.current?.focus();
    }
  }

  function fagTaster(e: React.KeyboardEvent<HTMLDivElement>) {
    const ids = ["alle", ...rad.map((f) => f.id)];
    const i = Math.max(0, ids.indexOf(kat));
    let n = i;
    if (e.key === "ArrowRight") n = (i + 1) % ids.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + ids.length) % ids.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = ids.length - 1;
    else return;
    e.preventDefault();
    setKat(ids[n] ?? "alle");
    document.getElementById(`fag-${ids[n]}`)?.focus();
  }

  function visTaster(e: React.KeyboardEvent<HTMLDivElement>) {
    const ids: Array<"notiser" | "tabell"> = ["notiser", "tabell"];
    const i = ids.indexOf(visning);
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = e.key === "ArrowRight" ? (i + 1) % ids.length : (i - 1 + ids.length) % ids.length;
    setVisning(ids[n] ?? "notiser");
    document.getElementById(`vis-${ids[n]}`)?.focus();
  }

  const grupper: UkeNokkel[] = ["denne", "neste", "senere", "passert", "uten"];
  const bucket = new Map<UkeNokkel, Sak[]>();
  for (const n of grupper) bucket.set(n, []);
  const sortert = [...filtrert].sort((a, b) => {
    if (a.frist && b.frist) return a.frist.localeCompare(b.frist);
    if (a.frist) return -1;
    if (b.frist) return 1;
    return (b.opprettet || "").localeCompare(a.opprettet || "");
  });
  for (const s of sortert) bucket.get(ukeNokkel(s, nå))!.push(s);
  const skjulte = grupper.reduce((sum, n) => sum + Math.max(0, (bucket.get(n)?.length ?? 0) - (utvidet ? 10000 : 4)), 0);

  function nullstill() {
    setKat("alle");
    setGeo({ type: "alle" });
    setSøk("");
    setBareFulgte(false);
  }

  const aktivFagId = kat === "alle" ? "fag-alle" : `fag-${kat}`;
  const varslerDekket = utvalgErDekket(varslerAktive, prioriterteFag, geografisk, kat, geo);

  return (
    <section className="avis-varsler" id="varsler">
      <div className="avis-wrap">
        <div className="avis-varsler-hode">
          <h2>Varsler</h2>
          <div className="avis-varsler-status">
            <p>sortert etter frist</p>
            {onToggleVarsler ? (
              <button
                type="button"
                className={varslerDekket ? "avis-varselknapp aktiv" : "avis-varselknapp"}
                aria-pressed={varslerDekket}
                onClick={() => onToggleVarsler(kat, geo)}
              >
                {varslerDekket ? "Varsler aktive" : "Slå på varsler"}
              </button>
            ) : null}
            <span className="avis-varsel-omfang">{kat === "alle" ? "Alle fag" : fagLabel(kat)} · {geoKnappTekst(geo)}</span>
          </div>
        </div>

        <div className="avis-fagfest">
          <div className="avis-fagrad" role="tablist" aria-label="Fagområde" onKeyDown={fagTaster}>
            <button
              type="button"
              role="tab"
              id="fag-alle"
              aria-selected={kat === "alle"}
              tabIndex={kat === "alle" ? 0 : -1}
              className={kat === "alle" ? "aktiv" : undefined}
              onClick={() => setKat("alle")}
            >
              Alle<sup>{saker.length}</sup>
            </button>
            {rad.map((f) => (
              <button
                type="button"
                role="tab"
                id={`fag-${f.id}`}
                key={f.id}
                aria-selected={kat === f.id}
                tabIndex={kat === f.id ? 0 : -1}
                className={kat === f.id ? "aktiv" : undefined}
                onClick={() => setKat(f.id)}
              >
                {f.label}<sup>{f.n}</sup>
              </button>
            ))}
            {flere.length > 0 ? (
              <button
                type="button"
                className="flere"
                aria-expanded={flereÅpen}
                onClick={() => setFlereÅpen((v) => !v)}
              >
                {flere.some((f) => f.id === kat) ? fagLabel(kat) : "Flere fagområder"} ▾
              </button>
            ) : null}
          </div>
          {flereÅpen && flere.length > 0 ? (
            <div className="avis-flere-panel" role="group" aria-label="Flere fagområder">
              {flere.map((f) => (
                <button
                  type="button"
                  key={f.id}
                  className={kat === f.id ? "aktiv" : undefined}
                  onClick={() => { setKat(f.id); setFlereÅpen(false); }}
                >
                  {f.label}<sup>{f.n}</sup>
                </button>
              ))}
            </div>
          ) : null}

          <div className="avis-setning">
            <div className="avis-setning-tekst">
              <strong>{setning}</strong>
              {fagNavn ? ` i ${fagNavn}` : ""}
              <span className="avis-geo" ref={geoWrap}>
                <button
                  type="button"
                  className="avis-geoknapp"
                  ref={geoKnapp}
                  aria-expanded={geoÅpen}
                  aria-haspopup="dialog"
                  onClick={() => setGeoÅpen((v) => !v)}
                >
                  {geoKnappTekst(geo)} <span aria-hidden="true">▾</span>
                </button>
                {geoÅpen ? (
                  <>
                    <div className="avis-geo-bak" onClick={() => setGeoÅpen(false)} />
                    <div
                      className="avis-geo-panel"
                      role="dialog"
                      aria-label="Hvor?"
                      ref={geoPanel}
                      onKeyDown={geoTaster}
                    >
                      <h3>Hvor?</h3>
                      <div className="avis-geo-innen">
                        Innenfor <b>{kat === "alle" ? "alle fagområder" : fagLabel(kat).toLowerCase()}</b>
                      </div>
                      <input
                        ref={geoSokRef}
                        value={geoSok}
                        onChange={(e) => setGeoSok(e.target.value)}
                        placeholder="Skriv fylke eller kommune …"
                        aria-label="Søk etter sted"
                      />
                      <ul className="avis-valg">
                        {geoValg.map((v) => (
                          <li key={v.id}>
                            <button
                              type="button"
                              data-geo={v.id}
                              className={v.geo && geoErLik(geo, v.geo) ? "aktiv" : undefined}
                              aria-selected={v.geo ? geoErLik(geo, v.geo) : undefined}
                              onClick={() => velgGeo(v)}
                            >
                              {v.label}
                              {v.n != null ? <span>{v.n}</span> : <span />}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                ) : null}
              </span>
            </div>
            <div className="avis-bytte" role="tablist" aria-label="Visning" onKeyDown={visTaster}>
              <button type="button" role="tab" id="vis-notiser" aria-selected={visning === "notiser"} tabIndex={visning === "notiser" ? 0 : -1} className={visning === "notiser" ? "aktiv" : undefined} onClick={() => setVisning("notiser")}>Notiser</button>
              <button type="button" role="tab" id="vis-tabell" aria-selected={visning === "tabell"} tabIndex={visning === "tabell" ? 0 : -1} className={visning === "tabell" ? "aktiv" : undefined} onClick={() => setVisning("tabell")}>Alle frister</button>
              {fulgte.length > 0 ? (
                <button type="button" aria-pressed={bareFulgte} className={bareFulgte ? "aktiv" : undefined} onClick={() => setBareFulgte((v) => !v)}>Fulgte</button>
              ) : null}
            </div>
          </div>
          <div className="avis-sok">
            <input
              value={søk}
              onChange={(e) => setSøk(e.target.value)}
              placeholder="Søk i tittel, instans eller sted"
              aria-label="Søk i saker"
            />
          </div>
        </div>

        <div role="tabpanel" aria-labelledby={aktivFagId}>
          {filtrert.length === 0 ? (
            <div className="avis-tom">
              Ingen saker i dette utvalget.
              <div><button type="button" onClick={nullstill}>Nullstill</button></div>
            </div>
          ) : visning === "tabell" ? (
            <table className="avis-tabell">
              <thead>
                <tr>
                  <th>Frist</th>
                  <th>Sak</th>
                  <th>Instans</th>
                  <th>Handling</th>
                </tr>
              </thead>
              <tbody>
                {(utvidet ? sortert : sortert.slice(0, 12)).map((s) => (
                  <tr key={s.id}>
                    <td className={`f${erHaster(s, nå) ? " haster" : ""}${erSnart(s, nå) ? " snart" : ""}${erPassert(s, nå) ? " passert" : ""}`}>
                      {s.frist ? <>{kortDato(s.frist)}{erPassert(s, nå) ? <span className="avis-frist-uten"> Passert</span> : null}</> : <><span className="avis-frist-strek">–</span><span className="avis-frist-uten">Uten frist</span></>}
                    </td>
                    <td className="t">
                      <button type="button" onClick={() => onÅpne(s, "info")}>
                        {erNy(s, nå) ? <span className="avis-ny">Ny </span> : null}
                        {s.tittel}
                      </button>
                    </td>
                    <td className="i">{s.instans || s.sted || ""}</td>
                    <td className="h"><Handling sak={s} fulgte={fulgte} nå={nå} onToggleFølg={onToggleFølg} onÅpne={onÅpne} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            grupper.map((n) => {
              const liste = bucket.get(n) ?? [];
              if (liste.length === 0) return null;
              const vist = utvidet ? liste : liste.slice(0, 4);
              const tekst = ukeTekst(n, nå);
              const haster = n !== "uten" && n !== "passert" && liste.some((s) => erHaster(s, nå));
              return (
                <div key={n} className={haster ? "avis-uke haster" : n === "passert" ? "avis-uke passert" : "avis-uke"}>
                  <h3>{tekst.tittel}<small>{tekst.under}</small></h3>
                  <div>
                    {vist.map((s) => (
                      <article key={s.id} className={`avis-sak${erHaster(s, nå) ? " haster" : ""}${erSnart(s, nå) ? " snart" : ""}${erPassert(s, nå) ? " passert" : ""}`}>
                        <div className={`dato${erHaster(s, nå) ? " haster" : ""}${erSnart(s, nå) ? " snart" : ""}`}>
                          {s.frist ? kortDato(s.frist) : "–"}
                          <small>{omDager(s, nå)}</small>
                        </div>
                        <div>
                          <h4>
                            <button type="button" onClick={() => onÅpne(s, "info")}>
                              {erNy(s, nå) ? <span className="avis-ny">Ny</span> : null}
                              {s.tittel}
                            </button>
                          </h4>
                          <div className="avis-instans">{s.instans || s.sted}</div>
                        </div>
                        <Handling sak={s} fulgte={fulgte} nå={nå} onToggleFølg={onToggleFølg} onÅpne={onÅpne} />
                      </article>
                    ))}
                  </div>
                </div>
              );
            })
          )}
          {filtrert.length > 0 && skjulte > 0 && visning === "notiser" ? (
            <div className="avis-mer-saker">
              <button type="button" onClick={() => setUtvidet(true)}>Vis alle {filtrert.length} saker</button>
            </div>
          ) : null}
          {filtrert.length > 12 && !utvidet && visning === "tabell" ? (
            <div className="avis-mer-saker">
              <button type="button" onClick={() => setUtvidet(true)}>Vis alle {filtrert.length} saker</button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
