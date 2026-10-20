// Ren logikk som App.tsx bruker der tsc fant ekte kjøretidsfeil.
// Ingen React, slik at node --test kan kjøre den.

export function sakerJegFølger<T extends { id: unknown }>(
  varsler: readonly T[] | null | undefined,
  fulgte: readonly unknown[] | null | undefined,
): T[] {
  const ids = new Set(fulgte ?? []);
  return (varsler ?? []).filter((sak) => ids.has(sak.id));
}

// Gammel mock-state het `analyse` og ble tømt med setAnalyse("") ved verktøybytte.
// Live-koden lagrer analysen i `resultat`. Byttet skal sette verktøyet og tømme den.
export function byttPremiumVerktøy(id: string): { tool: string; resultat: null } {
  return { tool: id, resultat: null };
}
