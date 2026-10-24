import { panelErSynlig, signaturErSynlig } from "./miljo.ts";

/** Liten lenke ved «Følg saken». Peker til boksen PR #33 eier. Tegnes bare når visningen er på. */
export function MobiliserInngang({ sakId }: { sakId: string | number }) {
  if (!panelErSynlig() && !signaturErSynlig()) return null;
  return (
    <a
      className="kv-lenke"
      href="/min-side#fulgte"
      data-lenkepunkt="min-side"
      data-koble="fulgte"
      data-sak={String(sakId)}
      onClick={(e) => e.stopPropagation()}
    >
      Saker du følger
    </a>
  );
}
