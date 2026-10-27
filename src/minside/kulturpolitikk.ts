/**
 * Håkon godkjente kulturpolitikk som eget fagområde 26. oktober 2026.
 * Samme verdi står i public.kulturpolitikk_valgbart() etter migrasjonen
 * 20261027070100_kulturpolitikk_valgbart.sql. Den eldre migrasjonen
 * 20261024200000 returnerer fortsatt false og skal ikke endres.
 *
 * true: kategorien kan krysses av og lagres i profiler.fagfelt. Saker med
 * kategori kulturpolitikk treffer bare tomt fagfelt eller et fagfelt som
 * inneholder verdien. Mange eInnsyn-saker om tilskudd, budsjett og økonomiplan
 * uten navngitt kunstform er kategorisert kulturpolitikk.
 */
export const KULTURPOLITIKK_VALGBART = true;

export const KULTURPOLITIKK_ID = "kulturpolitikk";
