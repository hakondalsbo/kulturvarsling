// Ren avgjørelse for om en Stripe-hendelse allerede er lagret.
// Ingen nettverk, så den kan testes med Node.

export type StripeLagreUtfall = "ny" | "duplikat" | "feil";

export function utfallForStripeInsert(
  feil: { code?: string } | null | undefined,
): StripeLagreUtfall {
  if (!feil) return "ny";
  if (feil.code === "23505") return "duplikat";
  return "feil";
}

export function erStripeHendelseId(id: unknown): id is string {
  return typeof id === "string" && id.length >= 3 && id.length <= 255 && !/[\u0000-\u001F]/.test(id);
}
