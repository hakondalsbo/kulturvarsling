// Etterkontroll: tall og årstall i et sammendrag som ikke står i kildeteksten.
// Logger et flagg og kan skrive én rad i varsel_sperringer. Stopper ikke kjøringen.

export type Tallavvik = {
  aar: string[];
  tall: string[];
};

function somTekst(verdi: unknown): string {
  return typeof verdi === "string" ? verdi : "";
}

function sortertUnik(verdier: Iterable<string>): string[] {
  return [...new Set(verdier)].sort();
}

// Tusenskille med mellomrom eller punkt, og desimal med komma eller punkt.
// Datoer på formen 24.03.2026 blir ikke slått sammen til ett tall.
function normaliserTalltekst(tekst: string): string {
  let s = tekst.replace(/\u00ad/g, "").replace(/\u00a0/g, " ");
  s = s.replace(/\d{1,3}(?: \d{3})+/g, (treff) => treff.replace(/ /g, ""));
  s = s.replace(/\d{1,3}(?:\.\d{3})+(?!\d)/g, (treff) => treff.replace(/\./g, ""));
  s = s.replace(/(\d+)\.(\d{1,2})(?!\d|\.)/g, "$1,$2");
  return s;
}

function tallNokkel(token: string): string {
  const [helt, des] = token.split(",");
  const heltNorm = helt.replace(/^0+(?=\d)/, "");
  return des !== undefined ? `${heltNorm},${des}` : heltNorm;
}

function trekkUt(tekst: string): { aar: Set<string>; tall: Set<string> } {
  const norm = normaliserTalltekst(tekst);
  const aar = new Set<string>();
  const tall = new Set<string>();
  for (const treff of norm.matchAll(/\d+(?:,\d+)?/g)) {
    const token = treff[0];
    if (/^(?:19|20)\d{2}$/.test(token)) aar.add(token);
    else tall.add(tallNokkel(token));
  }
  return { aar, tall };
}

/** Årstall (19xx/20xx) og andre tall i sammendraget som ikke finnes i kilden. */
export function finnUdokumenterteTall(sammendrag: unknown, kilde: unknown): Tallavvik {
  const fraSammendrag = trekkUt(somTekst(sammendrag));
  const fraKilde = trekkUt(somTekst(kilde));
  return {
    aar: sortertUnik([...fraSammendrag.aar].filter((aar) => !fraKilde.aar.has(aar))),
    tall: sortertUnik([...fraSammendrag.tall].filter((tall) => !fraKilde.tall.has(tall))),
  };
}

export function kildegrunnlag(deler: Array<string | null | undefined>): string {
  return deler.filter((del) => typeof del === "string" && del.trim().length > 0).join("\n");
}

/**
 * Nye varsler med avvik lagres upublisert, så en redaktør ser dem før de
 * blir synlige. Tomt avvik publiseres. Funksjonen kaster ikke.
 */
export function publiseresEtterKontroll(avvik: Tallavvik): boolean {
  return avvik.aar.length === 0 && avvik.tall.length === 0;
}

/**
 * Logger avviket. Kaster ikke, og returnerer alltid. Kalleren lagrer
 * raden videre. Ved avvik skal nye varsler settes inn med publisert=false.
 */
export function loggUdokumenterteTall(
  oppgave: string,
  tekst: unknown,
  kilde: unknown,
  referanse = "",
  log: (linje: string) => void = (linje) => console.warn(linje),
): Tallavvik {
  try {
    const avvik = finnUdokumenterteTall(tekst, kilde);
    if (avvik.aar.length || avvik.tall.length) {
      log(JSON.stringify({
        hendelse: "tall_uten_kilde",
        oppgave,
        referanse: referanse.slice(0, 180),
        aar: avvik.aar,
        tall: avvik.tall,
      }));
    }
    return avvik;
  } catch (e) {
    log(JSON.stringify({
      hendelse: "tall_uten_kilde_feil",
      oppgave,
      melding: String(e).slice(0, 120),
    }));
    return { aar: [], tall: [] };
  }
}

export type SperreOppgave = "hent-saker" | "klartekst";

export type VarselSperring = {
  varsel_id: string;
  arsak: "tall_uten_kilde";
  oppgave: SperreOppgave;
  detalj: { aar: string[]; tall: string[] };
};

/** Én rad per sak. Tomt avvik gir ingen rad. Detaljen er bare tallene, ikke kildeteksten. */
export function sperringForTall(
  varselId: string,
  oppgave: SperreOppgave,
  avvik: Tallavvik,
): VarselSperring | null {
  if (!varselId || (avvik.aar.length === 0 && avvik.tall.length === 0)) return null;
  return {
    varsel_id: varselId,
    arsak: "tall_uten_kilde",
    oppgave,
    detalj: { aar: [...avvik.aar], tall: [...avvik.tall] },
  };
}

type SperreKlient = {
  from: (tabell: string) => {
    upsert: (
      rad: VarselSperring,
      opts: { onConflict: string; ignoreDuplicates: boolean },
    ) => Promise<{ error: { message?: string } | null }>;
  };
};

/**
 * Skriver varsel_sperringer. Kaster ikke. null når ingen rad trengtes
 * eller raden ble skrevet. Tekst når skrivingen feilet.
 */
export async function lagreTallSperring(
  supabase: SperreKlient,
  varselId: string,
  oppgave: SperreOppgave,
  avvik: Tallavvik,
): Promise<string | null> {
  const rad = sperringForTall(varselId, oppgave, avvik);
  if (!rad) return null;
  try {
    const { error } = await supabase.from("varsel_sperringer").upsert(rad, {
      onConflict: "varsel_id,arsak,oppgave",
      ignoreDuplicates: true,
    });
    if (!error) return null;
    const melding = (error.message ?? "skriving feilet").slice(0, 200);
    console.error("varsel_sperringer:", melding);
    return melding;
  } catch (e) {
    const melding = String(e).slice(0, 200);
    console.error("varsel_sperringer:", melding);
    return melding;
  }
}
