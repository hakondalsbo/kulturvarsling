// Serverens databaseprofil avgjør tilgang. Klientens plan/metadata brukes aldri.
export function harPremium(profil: unknown): boolean {
  return !!profil && typeof profil === "object" && (profil as Record<string, unknown>).plan === "premium";
}
export async function reserverAiKvote(db: { rpc: (navn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }, brukerId: string, oppgave: "klartekst" | "budsjett", premium: boolean): Promise<"ok" | "grense" | "feil"> {
  const { data, error } = await db.rpc("reserver_ai_kvote", {
    p_bruker: brukerId, p_oppgave: oppgave,
    p_grense: oppgave === "budsjett" ? 10 : premium ? 120 : 30,
  });
  if (error || typeof data !== "boolean") return "feil";
  return data ? "ok" : "grense";
}
