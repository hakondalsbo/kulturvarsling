// Kjente nettleser-opprinnelser. Samme liste som stripe-checkout bruker
// for returadressen etter betaling. Ukjent Origin får ikke sin egen
// adresse ekkoet tilbake.

export const TILLATTE_ORIGINS: readonly string[] = [
  "https://www.kulturvarsling.no",
  "https://kulturvarsling.no",
  "http://localhost:5173",
  "http://localhost:4173",
];

const CANONICAL = "https://www.kulturvarsling.no";

export function erTillattOpprinnelse(origin: string | null | undefined): boolean {
  return !!origin && TILLATTE_ORIGINS.includes(origin);
}

export function corsHeadere(
  req: { headers: { get(name: string): string | null } },
  metoder = "POST, OPTIONS",
): Record<string, string> {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": erTillattOpprinnelse(origin) ? origin! : CANONICAL,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": metoder,
    Vary: "Origin",
  };
}
