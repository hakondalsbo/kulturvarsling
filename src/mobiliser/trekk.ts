// Trekk fra e-postlenken. Ingenting sendes ved sidelasting:
// e-postskannere følger lenken, og kallet skjer først ved klikk.
// Tokenet skal aldri inn i tekst, adressefeltet til kallet eller logger.

import { PERSONVERN_EPOST } from "./kjerne.ts";

const SUPABASE_URL = "https://zyyijlvmgoanjdzngmon.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5eWlqbHZtZ29hbmpkem5nbW9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNDI1NzMsImV4cCI6MjA4ODkxODU3M30.k2WWIg_7STiIOPSGojZ2zH_QCShvvSw8Ax0hk1yGjOI";

/** Samme sti som signeringsskjemaet. Tokenet ligger i kroppen, ikke i URL-en. */
export const TREKK_ENDEPUNKT = `${SUPABASE_URL}/functions/v1/signer-innspill`;

const MAKS_TOKEN = 80;

export const TREKK_SLETTET_TEKST =
  "Kulturvarsling AS har med en gang slettet navnet ditt, e-postadressen din og det du har skrevet om deg selv. Er innspillet allerede sendt, kan det ikke hentes tilbake fra mottakeren.";

export const TREKK_ALLEREDE_TEKST =
  "Signaturen er allerede trukket, eller lenken er ikke lenger gyldig";

export const TREKK_TILSTANDER = [
  "bekreft",
  "sender",
  "slettet",
  "allerede",
  "ugyldig",
  "for-mange",
  "lagring",
  "opptatt",
  "nett",
] as const;

export type TrekkTilstand = (typeof TREKK_TILSTANDER)[number];

export type TrekkTekst = {
  overskrift: string;
  status: string;
  slag: "info" | "ok" | "feil";
  visTrekk: boolean;
  visProveIgjen: boolean;
};

export type TrekkHent = (url: string, init: RequestInit) => Promise<Response>;

export function lesTrekkSoke(soke: string): URLSearchParams {
  const q = soke.startsWith("?") ? soke.slice(1) : soke;
  return new URLSearchParams(q);
}

export function erTrekkForesporsel(soke: string): boolean {
  return lesTrekkSoke(soke).get("handling") === "trekk";
}

/** Rå token fra lenken. Tomt eller urimelig langt blir ikke sendt og ikke vist. */
export function trekkToken(soke: string): string | null {
  const t = lesTrekkSoke(soke).get("t");
  if (t == null || t.trim() === "" || t.length > MAKS_TOKEN) return null;
  return t;
}

export function trekkTekst(tilstand: TrekkTilstand): TrekkTekst {
  switch (tilstand) {
    case "bekreft":
      return {
        overskrift: "Vil du trekke signaturen din?",
        status: "Ingenting er slettet før du trykker.",
        slag: "info",
        visTrekk: true,
        visProveIgjen: false,
      };
    case "sender":
      return {
        overskrift: "Vil du trekke signaturen din?",
        status: "Trekker signaturen.",
        slag: "info",
        visTrekk: true,
        visProveIgjen: false,
      };
    case "slettet":
      return {
        overskrift: "Signaturen er trukket",
        status: TREKK_SLETTET_TEKST,
        slag: "ok",
        visTrekk: false,
        visProveIgjen: false,
      };
    case "allerede":
      return {
        overskrift: TREKK_ALLEREDE_TEKST,
        status: `Kontakt ${PERSONVERN_EPOST}.`,
        slag: "info",
        visTrekk: false,
        visProveIgjen: false,
      };
    case "ugyldig":
      return {
        overskrift: "Lenken er ugyldig.",
        status: `Skriv til ${PERSONVERN_EPOST} hvis du trenger hjelp.`,
        slag: "feil",
        visTrekk: false,
        visProveIgjen: false,
      };
    case "for-mange":
      return {
        overskrift: "For mange forsøk.",
        status: "Prøv igjen senere.",
        slag: "feil",
        visTrekk: false,
        visProveIgjen: false,
      };
    case "lagring":
      return {
        overskrift: "Tilbaketrekkingen ble ikke lagret.",
        status: "Prøv igjen.",
        slag: "feil",
        visTrekk: false,
        visProveIgjen: true,
      };
    case "opptatt":
      return {
        overskrift: "Tjenesten svarer ikke.",
        status: "Prøv igjen om litt.",
        slag: "feil",
        visTrekk: false,
        visProveIgjen: true,
      };
    case "nett":
      return {
        overskrift: "Forespørselen kom ikke frem.",
        status: "Sjekk tilkoblingen, og prøv igjen.",
        slag: "feil",
        visTrekk: false,
        visProveIgjen: true,
      };
  }
}

/** Knappen er eneste vei til kallet. Sender-tilstanden kan ikke starte et nytt kall. */
export function skalKalleTrekk(token: string | null, tilstand: TrekkTilstand): boolean {
  if (token == null || token.trim() === "") return false;
  if (tilstand === "sender") return false;
  const tekst = trekkTekst(tilstand);
  return tekst.visTrekk || tekst.visProveIgjen;
}

export function tolkTrekkSvar(status: number, ok: boolean): TrekkTilstand {
  if (status === 200 && ok) return "slettet";
  if (status === 200) return "lagring";
  if (status === 404) return "allerede";
  if (status === 400) return "ugyldig";
  if (status === 429) return "for-mange";
  if (status === 500) return "lagring";
  if (status === 503) return "opptatt";
  return "nett";
}

export function trekkKropp(token: string): { handling: "trekk"; token: string } {
  return { handling: "trekk", token };
}

export async function kallTrekk(token: string, hent: TrekkHent = fetch): Promise<TrekkTilstand> {
  let res: Response;
  try {
    res = await hent(TREKK_ENDEPUNKT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify(trekkKropp(token)),
    });
  } catch {
    return "nett";
  }
  const data = await res.json().catch(() => null) as { ok?: unknown } | null;
  return tolkTrekkSvar(res.status, !!data && data.ok === true);
}
