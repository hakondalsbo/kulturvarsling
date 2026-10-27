// Felles grense for offentlige skrive-endepunkter.
// Nøkkelen er en hash, aldri rå IP eller e-post. Tabellen tømmes
// for rader eldre enn 48 timer av kalleren. Ingen Deno-spesifikke API-er.

export const FART_TIME_MS = 60 * 60 * 1000;
export const FART_OPPBEVARING_MS = 48 * 60 * 60 * 1000;
export const FART_EPOST = 5;
export const FART_IP = 20;
export const FART_BRUKER = 5;

export type FartNokkel = { nokkel: string; grense: number };
export type FartUtfall = "ok" | "blokkert" | "utilgjengelig";

export function skalBlokkere(antall: number, grense: number): boolean {
  return antall >= grense;
}

export function klientIp(req: { headers: { get(name: string): string | null } }): string {
  const raw = req.headers.get("cf-connecting-ip")
    || req.headers.get("x-real-ip")
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "ukjent";
  return raw.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 64) || "ukjent";
}

export async function sha256Hex(tekst: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Db = { from: (tabell: string) => any };

/**
 * Teller forsøk den siste timen. Over grensen skrives ingen ny rad.
 * Feil mot tabellen er utilgjengelig, så endepunktet kan svare 503
 * i stedet for å slippe gjennom uten grense.
 */
export async function registrerFartsgrense(
  db: Db,
  endepunkt: string,
  nokler: FartNokkel[],
): Promise<FartUtfall> {
  const siden = new Date(Date.now() - FART_TIME_MS).toISOString();
  const tall = await Promise.all(nokler.map(async (n) => {
    const { count, error } = await db.from("fartsgrense")
      .select("id", { count: "exact", head: true })
      .eq("endepunkt", endepunkt)
      .eq("nokkel", n.nokkel)
      .gte("opprettet_at", siden);
    if (error) return null;
    return typeof count === "number" ? count : 0;
  }));
  if (tall.some((n) => n == null)) return "utilgjengelig";
  if (tall.some((n, i) => skalBlokkere(n ?? 0, nokler[i].grense))) return "blokkert";
  const { error } = await db.from("fartsgrense").insert(
    nokler.map((n) => ({ endepunkt, nokkel: n.nokkel })),
  );
  if (error) return "utilgjengelig";
  const gamle = new Date(Date.now() - FART_OPPBEVARING_MS).toISOString();
  try {
    await db.from("fartsgrense").delete().eq("endepunkt", endepunkt).lt("opprettet_at", gamle);
  } catch {
    // Oppryddingen er ikke det som avgjør om forsøket slipper inn.
  }
  return "ok";
}
