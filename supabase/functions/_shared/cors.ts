// Kjente nettleser-opprinnelser. Samme liste som stripe-checkout bruker
// for returadressen etter betaling. Ukjent Origin får ingen
// Access-Control-Allow-Origin. Vercel-preview for dette prosjektet er med,
// så avmeld, budsjett, klartekst, stripe-checkout, horingshjelp og
// slett-konto kan kalles fra preview uten å åpne for andre adresser.

export const TILLATTE_ORIGINS: readonly string[] = [
  "https://www.kulturvarsling.no",
  "https://kulturvarsling.no",
  "http://localhost:5173",
  "http://localhost:4173",
];

const PREVIEW_OPPRINNELSE =
  /^https:\/\/kulturvarsling-[a-z0-9-]+-hakondalsbos-projects\.vercel\.app$/;

export function erTillattOpprinnelse(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return TILLATTE_ORIGINS.includes(origin) || PREVIEW_OPPRINNELSE.test(origin);
}

export function corsHeadere(
  req: { headers: { get(name: string): string | null } },
  metoder = "POST, OPTIONS",
): Record<string, string> {
  const origin = req.headers.get("origin");
  const headere: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": metoder,
    Vary: "Origin",
  };
  if (origin && erTillattOpprinnelse(origin)) {
    headere["Access-Control-Allow-Origin"] = origin;
  }
  return headere;
}
