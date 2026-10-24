/**
 * Lett flagg. Håkon har ikke bekreftet «kulturpolitikk» som eget fagområde.
 * Samme verdi må stå i public.kulturpolitikk_valgbart() i migrasjonen
 * 20261024200000_minside_valg.sql.
 *
 * false: verdien vises ikke i KATEGORIER, og sak_treffer_abonnement
 * ignorerer den i fagfelt. En sak merket kulturpolitikk treffer fortsatt
 * tomt fagfelt (alle fag), og treffer ikke et fagfelt som bare lister andre fag.
 * Ligger «kulturpolitikk» alene i fagfelt mens flagget er av, blir filteret
 * tomt og betyr alle fag.
 *
 * true: kategorien kan krysses av og lagres i profiler.fagfelt. Da treffer
 * saker med kategori kulturpolitikk bare tomt fagfelt eller et fagfelt som
 * inneholder verdien. Mange eInnsyn-saker om tilskudd, budsjett og økonomiplan
 * uten navngitt kunstform er kategorisert kulturpolitikk. De faller ut av et
 * smalt abonnement til brukeren også krysser av for kulturpolitikk.
 */
export const KULTURPOLITIKK_VALGBART = false;

export const KULTURPOLITIKK_ID = "kulturpolitikk";
