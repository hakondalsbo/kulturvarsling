import { useEffect, useRef } from "react";

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function turnstileNokkel(): string {
  const verdi = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  return typeof verdi === "string" ? verdi.trim() : "";
}

let scriptLovet: Promise<void> | null = null;

function lastScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptLovet) return scriptLovet;
  scriptLovet = new Promise((resolve, reject) => {
    const ferdig = () => resolve();
    const feil = () => {
      scriptLovet = null;
      reject(new Error("turnstile"));
    };
    const eksisterende = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    if (eksisterende) {
      eksisterende.addEventListener("load", ferdig);
      eksisterende.addEventListener("error", feil);
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.defer = true;
    s.onload = ferdig;
    s.onerror = feil;
    document.head.appendChild(s);
  });
  return scriptLovet;
}

export function TurnstileFelt({ onToken }: { onToken: (token: string) => void }) {
  const nokkel = turnstileNokkel();
  const holder = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!nokkel || !holder.current) return;
    let widgetId = "";
    let avbrutt = false;
    lastScript().then(() => {
      if (avbrutt || !holder.current || !window.turnstile) return;
      widgetId = window.turnstile.render(holder.current, {
        sitekey: nokkel,
        callback: (token: string) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(""),
        "error-callback": () => onTokenRef.current(""),
      });
    }).catch(() => onTokenRef.current(""));
    return () => {
      avbrutt = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [nokkel]);

  if (!nokkel) return null;
  return <div ref={holder} className="kv-turnstile" />;
}
