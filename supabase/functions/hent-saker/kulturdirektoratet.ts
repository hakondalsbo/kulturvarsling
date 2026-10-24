// Kulturdirektoratet-adapter — vedtaksdatabasen («hvem får penger»).
// Verifisert juli 2026: CSV-eksporten (16 MB, >100k vedtak for Kulturfondet,
// Fond for lyd og bilde, Statens kunstnerstipend m.fl.) krever en 3-stegs flyt:
//   1. GET /vedtak                        → session-cookie + sprig:config (signert hash)
//   2. GET sprig-render med sprig:config  → HTML-fragment med fersk CRAFT_CSRF_TOKEN
//   3. POST CSV-endepunktet med token     → text/csv
// Hashen i sprig:config endres ved deploy hos dem — derfor hentes den ferskt hver kjøring.
//
// RESSURSVALG: CSV-en har 5 000+ innvilgede enkeltvedtak per år og ingen ID-kolonne.
// Enkeltvedtak som varsler ville aldri tømt Claude-køen (25/kjøring) — derfor
// aggregeres det til ÉN varsel per tildelingsrunde (ordning + søknadsfrist).
// Innkjøpsordningene har samme søknadsfrist per runde, så det blir én sak
// per runde uten en egen nøkkel. rundedato er per tittel og brukes ikke
// som gruppe. Fragment-URL er dedup-nøkkel. Eksisterende rader skrives ikke om.

import {
  erInnkjopsordning,
  kategoriForOrdning,
  ordningsetikett,
} from "../_shared/ordningskoder.ts";
import {
  feilFraUnntak,
  feilUtfall,
  lesTekstRespons,
  okUtfall,
  uventetFormat,
  type AdapterUtfall,
} from "./kildehelse.ts";

const BASE = "https://www.kulturdirektoratet.no";

export type VedtakRad = Record<string, string>;

// Feltparsing av ÉN logisk rad — semikolonseparert, «""»-escapede anførselstegn.
function parseFelt(linje: string): string[] {
  const felter: string[] = [];
  let felt = "";
  let iSitat = false;
  for (let i = 0; i < linje.length; i++) {
    const c = linje[i];
    if (iSitat) {
      if (c === '"') {
        if (linje[i + 1] === '"') {
          felt += '"';
          i++;
        } else iSitat = false;
      } else felt += c;
    } else if (c === '"' && felt === "") {
      iSitat = true;
    } else if (c === ";") {
      felter.push(felt);
      felt = "";
    } else felt += c;
  }
  felter.push(felt);
  return felter;
}

// Craft-eksporten er semikolonseparert med UTF-8 BOM; felt kan være sitert med
// «""»-escapede anførselstegn og inneholde semikolon og linjeskift i sitatet.
// YTELSE (lærdom fra WORKER_RESOURCE_LIMIT i prod): 16 MB / >100k rader tåler
// ikke tegn-for-tegn-parsing av hele filen i edge-workeren. Derfor: (1) nativ
// linjesplitt, (2) logiske rader gjenskjøtes der antall anførselstegn er odde
// (sitatet fortsetter over linjeskiftet), (3) billig beholdRad-forfilter på
// rålinjen, (4) full feltparsing kun av radene som slipper gjennom.
export function parseVedtakCsv(
  csv: string,
  beholdRad: (linje: string) => boolean = () => true,
): VedtakRad[] {
  const fysiske = csv.replace(/^\uFEFF/, "").split("\n");
  const logiske: string[] = [];
  let buffer = "";
  let iSitat = false;
  for (const fysisk of fysiske) {
    const linje = fysisk.endsWith("\r") ? fysisk.slice(0, -1) : fysisk;
    buffer = buffer ? `${buffer}\n${linje}` : linje;
    if ((linje.split('"').length - 1) % 2 === 1) iSitat = !iSitat;
    if (!iSitat) {
      if (buffer) logiske.push(buffer);
      buffer = "";
    }
  }
  if (buffer) logiske.push(buffer);
  if (!logiske.length) return [];

  const hode = parseFelt(logiske[0]);
  const rader: VedtakRad[] = [];
  for (let i = 1; i < logiske.length; i++) {
    if (!beholdRad(logiske[i])) continue;
    const felter = parseFelt(logiske[i]);
    rader.push(Object.fromEntries(hode.map((h, j) => [h, felter[j] ?? ""])));
  }
  return rader;
}

const formaterKr = (n: number) =>
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

// Aggregerer innvilgede vedtak til én varsel per ordning og søknadsfrist.
// Vindu: runder med søknadsfrist siste ~6 mnd — vedtakene publiseres 2–4 mnd
// etter frist, så dette fanger nye runder uten å grave opp fjorårets.
// rundedato grupperes ikke: på innkjøpsordningene er den per tittel.
// `nå` kan injiseres i tester; produksjon bruker klokka.
export function grupperTildelinger(
  rader: VedtakRad[],
  nå: number = Date.now(),
): any[] {
  const cutoff = new Date(nå - 180 * 86400000).toISOString().split("T")[0];

  type Gruppe = {
    ordning: string;
    frist: string;
    innkjop: boolean;
    finansieringskilde: string;
    antall: number;
    sum: number;
    størst: Array<{ navn: string; beløp: number }>;
  };
  const grupper = new Map<string, Gruppe>();

  for (const rad of rader) {
    if (rad.soknad_vedtak !== "Innvilget") continue;
    const frist = (rad.soknadsfrist ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(frist) || frist < cutoff) continue;
    const ordning = (rad.ordning_kode ?? "").trim();
    if (!ordning) continue;

    const nøkkel = `${ordning}|${frist}`;
    let g = grupper.get(nøkkel);
    if (!g) {
      g = {
        ordning,
        frist,
        innkjop: erInnkjopsordning(ordning),
        finansieringskilde: rad.hovedfinansieringskilde || "Kulturdirektoratet",
        antall: 0,
        sum: 0,
        størst: [],
      };
      grupper.set(nøkkel, g);
    }
    g.antall++;
    // Innkjøp har verdi_type «Innkjøp». Tallet der er ikke et kronebeløp.
    if (!g.innkjop && rad.verdi_type === "Beløp") {
      const beløp = Number(rad.verdi_innvilget);
      if (Number.isFinite(beløp) && beløp > 0) {
        g.sum += beløp;
        g.størst.push({ navn: rad.tiltak_tittel || rad.soker_navn || "", beløp });
      }
    }
  }

  return [...grupper.values()].map((g) => {
    // Navnet fra ordlisten ligger i kildeteksten før modellen ser saken.
    // Ukjente koder blir stående som koden, uten en oppdiktet forklaring.
    const etikett = ordningsetikett(g.ordning);
    const topp = g.størst
      .sort((a, b) => b.beløp - a.beløp)
      .slice(0, 3)
      .filter((t) => t.navn)
      .map((t) => `${t.navn} (${formaterKr(t.beløp)} kr)`);
    const sumTekst = g.sum > 0 ? `, til sammen ${formaterKr(g.sum)} kr` : "";
    const kategori = kategoriForOrdning(g.ordning);
    const nokkel = `${g.ordning}-${g.frist}`;
    return {
      tittel:
        `Tildeling: ${g.finansieringskilde} — ${g.antall} søknader innvilget (${etikett}, runde ${g.frist})`,
      instans: g.finansieringskilde,
      kilde: `${BASE}/vedtak#${nokkel}`,
      frist: null, // søknadsfristen er passert — dette er et vedtaksvarsel, ikke en frist
      sammendrag_raa:
        `Ordning ${etikett}. ` +
        `${g.antall} søknader innvilget${sumTekst} i runden med søknadsfrist ${g.frist} ` +
        `(${g.finansieringskilde}).` +
        (topp.length ? ` Størst: ${topp.join("; ")}.` : ""),
      kilde_id: `kulturdirektoratet-${nokkel}`,
      // rundedato er ikke publiseringstid og ikke dedup-nøkkel. Dedup er URL-en.
      publisert_dato: null,
      kilde_publisert: null,
      sakstype: "tildeling",
      // Kulturspesifikk kilde — alt her ER kulturfeltet. Claude vurderer uansett.
      forhåndsgodkjent: true,
      ...(kategori ? { kategori } : {}),
    };
  });
}

// Slår sammen cookies fra Set-Cookie-headere til én Cookie-header (Deno fetch
// har ingen cookie-jar — Craft krever session-cookie + CSRF-cookie i par).
function samleCookies(jar: Map<string, string>, res: Response) {
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [par] = sc.split(";");
    const i = par.indexOf("=");
    if (i > 0) jar.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
  }
}

export async function hentKulturdirektoratetTildelinger(): Promise<AdapterUtfall> {
  const vedtakUrl = `${BASE}/vedtak`;
  try {
    const jar = new Map<string, string>();
    const headers = () => ({
      "User-Agent": "Kulturvarsling/1.0",
      Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    });

    // Steg 1: /vedtak-siden — cookies + sprig:config (hx-vals er HTML-escapet JSON)
    const side = await fetch(vedtakUrl, { headers: headers() });
    const sideLest = await lesTekstRespons(side, vedtakUrl);
    if ("feil" in sideLest) {
      console.error(`Kulturdirektoratet ${vedtakUrl}: ${sideLest.feil.melding}`);
      return feilUtfall(sideLest.feil);
    }
    samleCookies(jar, side);
    const html = sideLest.tekst;
    const attr = html.match(/data-hx-vals="([^"]*sprig:config[^"]*)"/)?.[1];
    if (!attr) {
      const feil = uventetFormat(vedtakUrl, "fant ikke sprig:config");
      console.error(`Kulturdirektoratet: ${feil.melding}`);
      return feilUtfall(feil);
    }
    const config = JSON.parse(attr.replaceAll("&quot;", '"'))["sprig:config"];

    // Steg 2: sprig-fragmentet med fersk CSRF-token
    const fragUrl = `${BASE}/actions/sprig-core/components/render?${
      new URLSearchParams({ "sprig:config": config })
    }`;
    const frag = await fetch(fragUrl, { headers: headers() });
    const fragLest = await lesTekstRespons(frag, fragUrl);
    if ("feil" in fragLest) {
      console.error(`Kulturdirektoratet sprig-render: ${fragLest.feil.melding}`);
      return feilUtfall(fragLest.feil);
    }
    samleCookies(jar, frag);
    const token = fragLest.tekst.match(
      /name="CRAFT_CSRF_TOKEN" value="([^"]+)"/,
    )?.[1];
    if (!token) {
      const feil = uventetFormat(fragUrl, "fant ikke CRAFT_CSRF_TOKEN");
      console.error(`Kulturdirektoratet: ${feil.melding}`);
      return feilUtfall(feil);
    }

    // Steg 3: CSV-nedlasting (hele datasettet — aar-parameter ignoreres av serveren)
    const csvUrl = `${BASE}/actions/download-determination-csv/determination-download/csv`;
    const csvRes = await fetch(csvUrl, {
      method: "POST",
      headers: {
        ...headers(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ CRAFT_CSRF_TOKEN: token }),
    });
    const csvLest = await lesTekstRespons(csvRes, csvUrl);
    if ("feil" in csvLest) {
      console.error(`Kulturdirektoratet CSV: ${csvLest.feil.melding}`);
      return feilUtfall(csvLest.feil);
    }
    // Forfilteret dropper ~80 % av radene (Avslått/Ubesluttet) før feltparsing —
    // permissivt med vilje: falske positive lukes ut av grupperTildelinger.
    // raatt_antall er radene som slapp forfilteret (før vindu/aggregering og dedup).
    const rader = parseVedtakCsv(
      csvLest.tekst,
      (linje) => linje.includes("Innvilget"),
    );
    const items = grupperTildelinger(rader);
    console.log(
      `Kulturdirektoratet: ${rader.length} vedtaksrader, ${items.length} tildelingsrunder siste halvår`,
    );
    return okUtfall(items, rader.length, items.length, csvRes.status);
  } catch (e) {
    console.error("Kulturdirektoratet feil:", e);
    return feilUtfall(feilFraUnntak(e, vedtakUrl));
  }
}
