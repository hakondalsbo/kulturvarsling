/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KOMMUNELOGIN?: string;
  readonly VITE_HORINGSHJELP?: string;
  /** Sat fra VERCEL_ENV i vite.config, så prod-bygg kan skru av ?demo=. */
  readonly VITE_VERCEL_ENV?: string;
}
