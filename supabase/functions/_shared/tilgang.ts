// Serverens databaseprofil avgjør tilgang når muren er på.
// Klientens plan/metadata brukes aldri. Muren er av med mindre PREMIUM_AKTIV er "true".
export function harPremium(profil: unknown): boolean {
  return !!profil && typeof profil === "object" && (profil as Record<string, unknown>).plan === "premium";
}

/** Samme regel som VITE_PREMIUM_AKTIV i klienten. Alt annet enn "true" er prøvedrift. */
export function premiumMurAktiv(verdi: string | null | undefined): boolean {
  return verdi === "true";
}

/** Fagverktøy som budsjett. I prøvedrift er de åpne. Plan leses bare når muren er på. */
export function harFagtilgang(profil: unknown, murAktiv: boolean): boolean {
  if (!murAktiv) return true;
  return harPremium(profil);
}

/**
 * Klartekst-taket. I prøvedrift brukes premium-taket for alle innloggede,
 * men reserver_ai_kvote kalles fortsatt. Når muren er på, avgjør profiler.plan.
 */
export function brukPremiumKvote(profil: unknown, murAktiv: boolean): boolean {
  if (!murAktiv) return true;
  return harPremium(profil);
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
