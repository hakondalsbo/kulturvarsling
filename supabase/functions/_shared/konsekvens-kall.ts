// Haiku-kall for konsekvens. Feil returneres, de kastes ikke videre til innhentingen.
import { kallClaude } from "./claude.ts";
import {
  byggKonsekvensPrompt,
  feltFraVurdering,
  lesTokenForbruk,
  osloDato,
  tekstFraClaude,
  tolkKonsekvensSvar,
  type KonsekvensFelt,
  type KonsekvensInn,
  type TokenForbruk,
} from "./konsekvens.ts";

const MODELL = "claude-haiku-4-5-20251001";

export type KlassifiserResultat =
  | { ok: true; felt: KonsekvensFelt; tokens: TokenForbruk | null }
  | { ok: false; grunn: "http" | "tom" | "unntak"; status: number | null; tokens: TokenForbruk | null };

export async function klassifiserKonsekvens(
  inn: Omit<KonsekvensInn, "dagensDato"> & { dagensDato?: string },
  apiKey: string,
  deps: {
    fetch?: typeof fetch;
    log?: (entry: Record<string, unknown>) => void;
    timeoutMs?: number;
    oppgave?: string;
  } = {},
): Promise<KlassifiserResultat> {
  const dagensDato = inn.dagensDato ?? osloDato();
  try {
    const res = await kallClaude({
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODELL,
        max_tokens: 500,
        messages: [{
          role: "user",
          content: byggKonsekvensPrompt({ ...inn, dagensDato }),
        }],
      }),
    }, deps.oppgave ?? "konsekvens", deps);

    const data = await res.json().catch(() => null);
    const tokens = lesTokenForbruk(data);
    if (!res.ok) return { ok: false, grunn: "http", status: res.status, tokens };
    const tekst = tekstFraClaude(data);
    if (!tekst.trim()) return { ok: false, grunn: "tom", status: res.status, tokens };
    return {
      ok: true,
      felt: feltFraVurdering(tolkKonsekvensSvar(tekst, dagensDato)),
      tokens,
    };
  } catch {
    return { ok: false, grunn: "unntak", status: null, tokens: null };
  }
}
