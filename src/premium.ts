/**
 * Betalingsmuren. Av i prøvedrift med mindre verdien er nøyaktig "true".
 * Samme regel som serverens PREMIUM_AKTIV i supabase/functions/_shared/tilgang.ts.
 */
export function premiumAktivFra(verdi: string | null | undefined): boolean {
  return verdi === "true";
}

export function premiumAktiv(): boolean {
  return premiumAktivFra(import.meta.env.VITE_PREMIUM_AKTIV);
}

export type PremiumFlate = {
  /** Vis priser, Stripe-knapp og oppgraderingsboks. */
  visBetaling: boolean;
  meny: { id: "premium"; label: string };
  tittel: string;
  /** Nøktern tekst når muren er av. Tom når betalingsboksen vises. */
  profilTekst: string | null;
};

export function verktøyÅpent(plan: unknown, murAktiv: boolean): boolean {
  if (!murAktiv) return true;
  return plan === "premium";
}

export function premiumFlate(murAktiv: boolean, plan: unknown): PremiumFlate {
  if (!murAktiv) {
    return {
      visBetaling: false,
      meny: { id: "premium", label: "Verktøy" },
      tittel: "Verktøy",
      profilTekst: "Åpen prøvedrift. Alle verktøy er åpne for innloggede, uten betaling.",
    };
  }
  const premium = plan === "premium";
  return {
    visBetaling: !premium,
    meny: { id: "premium", label: "Premium" },
    tittel: "Premium-verktøy",
    profilTekst: null,
  };
}
