// Vercel Cron-endepunkt — trigges automatisk én gang daglig (se "crons" i vercel.json).
// Denne funksjonen gjør IKKE selve innhentingen; den videresender bare kallet til
// den eksisterende Supabase Edge Function (hent-saker), som er der logikken bor.
//
// Nødvendige miljøvariabler i Vercel (Project Settings → Environment Variables):
//   HENT_SAKER_URL     = https://zyyijlvmgoanjdzngmon.supabase.co/functions/v1/hent-saker
//   SUPABASE_ANON_KEY  = <din Supabase anon/public key>  (trygg å bruke, er ment å være offentlig)
//   CRON_SECRET        = <en tilfeldig streng>  (valgfri, men anbefalt — se under)

export const config = { maxDuration: 60 };

export default async function handler(req: any, res: any) {
  // Vercel Cron sender automatisk «Authorization: Bearer <CRON_SECRET>» når
  // CRON_SECRET-miljøvariabelen er satt. Da avvises alle andre som prøver å
  // kalle endepunktet manuelt.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ feil: "Uautorisert" });
  }

  const funksjonsUrl = process.env.HENT_SAKER_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!funksjonsUrl || !anonKey) {
    return res
      .status(500)
      .json({ feil: "Mangler HENT_SAKER_URL eller SUPABASE_ANON_KEY" });
  }

  try {
    const svar = await fetch(funksjonsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: "{}",
    });

    const resultat = await svar.json().catch(() => ({}));
    console.log("hent-saker trigget:", svar.status, resultat);

    return res
      .status(svar.ok ? 200 : 502)
      .json({ videresendt_status: svar.status, resultat });
  } catch (e) {
    console.error("Klarte ikke trigge hent-saker:", e);
    return res.status(502).json({ feil: String(e) });
  }
}
