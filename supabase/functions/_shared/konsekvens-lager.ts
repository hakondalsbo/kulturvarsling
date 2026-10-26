// Skriver det utledede mobiliser-flagget på ulåste rader.
// Rører ikke konsekvensfeltene. Låste rader får ingen skriving.
import { erKonsekvensLåst, erMobiliserNaa, osloDato } from "./konsekvens.ts";

type SupabaseLignende = {
  from: (tabell: string) => any;
};

type MobiliserRad = {
  id: string;
  mobiliser_dato: string | null;
  mobiliser_naa: boolean | null;
  manuelt_redigert?: boolean | null;
  konsekvens_manuell?: boolean | null;
};

/**
 * Setter mobiliser_naa på nytt ut fra mobiliser_dato.
 * Rader uten dato og uten flagg hoppes over.
 * manuelt_redigert og konsekvens_manuell hoppes over, også i selve update.
 * Feil (for eksempel før migrasjonen) kastes til kalleren.
 */
export async function oppfriskMobiliserNaa(
  supabase: SupabaseLignende,
  iDag: string = osloDato(),
): Promise<number> {
  const { data, error } = await supabase
    .from("varsler")
    .select("id, mobiliser_dato, mobiliser_naa, manuelt_redigert, konsekvens_manuell")
    .or("mobiliser_dato.not.is.null,mobiliser_naa.eq.true");
  if (error) throw new Error(error.message ?? "kunne ikke lese mobiliser-felt");

  let oppdatert = 0;
  for (const rad of (data ?? []) as MobiliserRad[]) {
    if (erKonsekvensLåst(rad)) continue;
    const neste = erMobiliserNaa(rad.mobiliser_dato, iDag);
    if (neste === rad.mobiliser_naa) continue;
    const { data: skrevet, error: skrivFeil } = await supabase
      .from("varsler")
      .update({ mobiliser_naa: neste })
      .eq("id", rad.id)
      .eq("manuelt_redigert", false)
      .eq("konsekvens_manuell", false)
      .select("id");
    if (skrivFeil) throw new Error(skrivFeil.message ?? "kunne ikke oppdatere mobiliser_naa");
    if (skrevet?.length) oppdatert++;
  }
  return oppdatert;
}
