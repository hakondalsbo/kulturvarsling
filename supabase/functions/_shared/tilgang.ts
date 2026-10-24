// Serverens databaseprofil avgjør tilgang. Klientens plan/metadata brukes aldri.
export function harPremium(profil: unknown): boolean {
  return !!profil && typeof profil === "object" && (profil as Record<string, unknown>).plan === "premium";
}
export type AiOppgave = "klartekst" | "budsjett" | "horingshjelp";

/** Takt mot reserver_ai_kvote, som avviser grense over 120. Klartekst og budsjett er uendret. */
export function aiKvoteGrense(oppgave: AiOppgave, premium: boolean): number {
  if (oppgave === "budsjett" || oppgave === "horingshjelp") return 10;
  return premium ? 120 : 30;
}

export async function reserverAiKvote(db: { rpc: (navn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }, brukerId: string, oppgave: AiOppgave, premium: boolean): Promise<"ok" | "grense" | "feil"> {
  const { data, error } = await db.rpc("reserver_ai_kvote", {
    p_bruker: brukerId, p_oppgave: oppgave,
    p_grense: aiKvoteGrense(oppgave, premium),
  });
  if (error || typeof data !== "boolean") return "feil";
  return data ? "ok" : "grense";
}
