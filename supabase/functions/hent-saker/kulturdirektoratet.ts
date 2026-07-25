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
// aggregeres det til ÉN varsel per tildelingsrunde (ordning + søknadsfrist),
// med stabil fragment-URL som dedup-nøkkel. ~105 runder siste halvår.

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

// Aggregerer innvilgede vedtak til én varsel per tildelingsrunde.
// Vindu: runder med søknadsfrist siste ~6 mnd — vedtakene publiseres 2–4 mnd
// etter frist, så dette fanger nye runder uten å grave opp fjorårets.
// `nå` kan injiseres i tester; produksjon bruker klokka.
export function grupperTildelinger(
  rader: VedtakRad[],
  nå: number = Date.now(),
): any[] {
  const cutoff = new Date(nå - 180 * 86400000).toISOString().split("T")[0];

  type Gruppe = {
    ordning: string;
    frist: string;
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
        finansieringskilde: rad.hovedfinansieringskilde || "Kulturdirektoratet",
        antall: 0,
        sum: 0,
        størst: [],
      };
      grupper.set(nøkkel, g);
    }
    g.antall++;
    if (rad.verdi_type === "Beløp") {
      const beløp = Number(rad.verdi_innvilget);
      if (Number.isFinite(beløp) && beløp > 0) {
        g.sum += beløp;
        g.størst.push({ navn: rad.tiltak_tittel || rad.soker_navn || "", beløp });
      }
    }
  }

  return [...grupper.values()].map((g) => {
    const topp = g.størst
      .sort((a, b) => b.beløp - a.beløp)
      .slice(0, 3)
      .filter((t) => t.navn)
      .map((t) => `${t.navn} (${formaterKr(t.beløp)} kr)`);
    const sumTekst = g.sum > 0 ? `, til sammen ${formaterKr(g.sum)} kr` : "";
    return {
      tittel:
        `Tildeling: ${g.finansieringskilde} — ${g.antall} søknader innvilget (${g.ordning}, runde ${g.frist})`,
      instans: g.finansieringskilde,
      kilde: `${BASE}/vedtak#${g.ordning}-${g.frist}`,
      frist: null, // søknadsfristen er passert — dette er et vedtaksvarsel, ikke en frist
      sammendrag_raa:
        `${g.antall} søknader innvilget${sumTekst} i runden med søknadsfrist ${g.frist} ` +
        `(ordning ${g.ordning}, ${g.finansieringskilde}).` +
        (topp.length ? ` Størst: ${topp.join("; ")}.` : ""),
      kilde_id: `kulturdirektoratet-${g.ordning}-${g.frist}`,
      publisert_dato: null,
      sakstype: "tildeling",
      // Kulturspesifikk kilde — alt her ER kulturfeltet. Claude vurderer uansett.
      forhåndsgodkjent: true,
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

export async function hentKulturdirektoratetTildelinger(): Promise<any[]> {
  try {
    const jar = new Map<string, string>();
    const headers = () => ({
      "User-Agent": "Kulturvarsling/1.0",
      Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    });

    // Steg 1: /vedtak-siden — cookies + sprig:config (hx-vals er HTML-escapet JSON)
    const side = await fetch(`${BASE}/vedtak`, { headers: headers() });
    if (!side.ok) {
      console.error(`Kulturdirektoratet /vedtak svarte ${side.status}`);
      return [];
    }
    samleCookies(jar, side);
    const html = await side.text();
    const attr = html.match(/data-hx-vals="([^"]*sprig:config[^"]*)"/)?.[1];
    if (!attr) {
      console.error("Kulturdirektoratet: fant ikke sprig:config på /vedtak");
      return [];
    }
    const config = JSON.parse(attr.replaceAll("&quot;", '"'))["sprig:config"];

    // Steg 2: sprig-fragmentet med fersk CSRF-token
    const frag = await fetch(
      `${BASE}/actions/sprig-core/components/render?${
        new URLSearchParams({ "sprig:config": config })
      }`,
      { headers: headers() },
    );
    if (!frag.ok) {
      console.error(`Kulturdirektoratet sprig-render svarte ${frag.status}`);
      return [];
    }
    samleCookies(jar, frag);
    const token = (await frag.text()).match(
      /name="CRAFT_CSRF_TOKEN" value="([^"]+)"/,
    )?.[1];
    if (!token) {
      console.error("Kulturdirektoratet: fant ikke CRAFT_CSRF_TOKEN i fragmentet");
      return [];
    }

    // Steg 3: CSV-nedlasting (hele datasettet — aar-parameter ignoreres av serveren)
    const csvRes = await fetch(
      `${BASE}/actions/download-determination-csv/determination-download/csv`,
      {
        method: "POST",
        headers: {
          ...headers(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ CRAFT_CSRF_TOKEN: token }),
      },
    );
    if (!csvRes.ok) {
      console.error(`Kulturdirektoratet CSV svarte ${csvRes.status}`);
      return [];
    }
    // Forfilteret dropper ~80 % av radene (Avslått/Ubesluttet) før feltparsing —
    // permissivt med vilje: falske positive lukes ut av grupperTildelinger.
    const rader = parseVedtakCsv(
      await csvRes.text(),
      (linje) => linje.includes("Innvilget"),
    );
    const items = grupperTildelinger(rader);
    console.log(
      `Kulturdirektoratet: ${rader.length} vedtaksrader, ${items.length} tildelingsrunder siste halvår`,
    );
    return items;
  } catch (e) {
    console.error("Kulturdirektoratet feil:", e);
    return [];
  }
}
