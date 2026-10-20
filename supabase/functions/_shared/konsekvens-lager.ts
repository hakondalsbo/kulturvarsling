// Skriver det utledede mobiliser-flagget. Rører ikke konsekvensfeltene.
import { erMobiliserNaa, osloDato } from "./konsekvens.ts";

type SupabaseLignende = {
  from: (tabell: string) => any;
};

/**
 * Setter mobiliser_naa på nytt ut fra mobiliser_dato.
 * Rader uten dato og uten flagg hoppes over.
 * Feil (for eksempel før migrasjonen) kastes til kalleren.
 */
export async function oppfriskMobiliserNaa(
  supabase: SupabaseLignende,
  iDag: string = osloDato(),
): Promise<number> {
  const { data, error } = await supabase
    .from("varsler")
    .select("id, mobiliser_dato, mobiliser_naa")
    .or("mobiliser_dato.not.is.null,mobiliser_naa.eq.true");
  if (error) throw new Error(error.message ?? "kunne ikke lese mobiliser-felt");

  let oppdatert = 0;
  for (const rad of data ?? []) {
    const neste = erMobiliserNaa(rad.mobiliser_dato, iDag);
    if (neste === rad.mobiliser_naa) continue;
    const { error: skrivFeil } = await supabase
      .from("varsler")
      .update({ mobiliser_naa: neste })
      .eq("id", rad.id);
    if (skrivFeil) throw new Error(skrivFeil.message ?? "kunne ikke oppdatere mobiliser_naa");
    oppdatert++;
  }
  return oppdatert;
}
