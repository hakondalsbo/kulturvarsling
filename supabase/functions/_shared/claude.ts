// Felles transport: ett kontrollert nytt forsøk ved eksplisitt overbelastning.
// Nettverksfeil/tidsavbrudd gjentas ikke: første kall kan allerede være fakturert.
export async function kallClaude(
  init: RequestInit,
  oppgave: string,
  deps: {
    fetch?: typeof fetch;
    log?: (entry: Record<string, unknown>) => void;
    timeoutMs?: number;
    vent?: (ms: number) => Promise<void>;
  } = {},
): Promise<Response> {
  const hent = deps.fetch ?? fetch;
  const log = deps.log ?? ((entry) => console.info(JSON.stringify(entry)));
  const vent = deps.vent ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const request = JSON.parse(String(init.body ?? "{}"));
  for (let forsøk = 0; forsøk < 2; forsøk++) {
    const start = Date.now();
    const res = await hent("https://api.anthropic.com/v1/messages", {
      ...init,
      signal: AbortSignal.timeout(deps.timeoutMs ?? 25_000),
    });
    const payload = await res.clone().json().catch(() => null);
    // Ingen prompt, profil, e-post eller dokumenttekst skrives til driftsloggen.
    log({ hendelse: "ai_forbruk", oppgave, model: request.model,
      status: res.status, forsøk: forsøk + 1, varighet_ms: Date.now() - start,
      input_tokens: payload?.usage?.input_tokens ?? null,
      output_tokens: payload?.usage?.output_tokens ?? null,
      cache_read_input_tokens: payload?.usage?.cache_read_input_tokens ?? null,
      cache_creation_input_tokens: payload?.usage?.cache_creation_input_tokens ?? null,
    });
    if (forsøk === 0 && [429, 503, 529].includes(res.status)) {
      const retryAfter = res.headers.get("retry-after");
      const sekunder = retryAfter === null ? 1 : Number(retryAfter);
      // Lange rate-limit-vinduer overlates til neste forespørsel/jobbkjøring.
      if (!Number.isFinite(sekunder) || sekunder < 0 || sekunder > 2) return res;
      await vent(sekunder * 1000);
      continue;
    }
    return res;
  }
  throw new Error("Uventet Claude-tilstand");
}
