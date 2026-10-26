/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KOMMUNELOGIN?: string;
  readonly VITE_HORINGSHJELP?: string;
  /** Sat fra VERCEL_ENV i vite.config, så prod-bygg kan skru av ?demo=. */
  readonly VITE_VERCEL_ENV?: string;
  readonly VITE_MOBILISERING_SIGNATUR_AKTIV?: string;
  readonly VITE_MOBILISER_PANEL_AKTIV?: string;
  readonly VITE_MOBILISER_DEMO?: string;
  /** Cloudflare Turnstile site key. Tom verdi skrur av widgeten. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}
