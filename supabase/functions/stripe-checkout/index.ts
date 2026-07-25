// Oppretter en Stripe Checkout Session for Premium-abonnement (E5).
// Kalles fra PremiumModal i appen med brukerens JWT (sb.functions.invoke).
//
// Bruk:
//   POST {"interval": "monthly"}  → { "url": "https://checkout.stripe.com/..." }
//   POST {"interval": "yearly"}   → samme, men årspris
//
// Prisene slås opp i Stripe på beløp: 99 kr/mnd (9900 øre) og 790 kr/år
// (79000 øre) — brukeren trenger derfor bare å opprette produktet og de to
// prisene i Stripe-dashbordet, ingen pris-ID-er må limes inn noe sted.
//
// Secrets: STRIPE_SECRET_KEY (sk_test_... i testmodus, sk_live_... i drift).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TILLATTE_ORIGINS = [
  "https://www.kulturvarsling.no",
  "https://kulturvarsling.no",
  "http://localhost:5173",
  "http://localhost:4173",
];

// Beløp i øre — må matche prisene brukeren oppretter i Stripe-dashbordet.
const PRISER = {
  monthly: { interval: "month", beløp: 9900, label: "99 kr/mnd" },
  yearly: { interval: "year", beløp: 79000, label: "790 kr/år" },
} as const;

async function stripeKall(
  sti: string,
  metode: "GET" | "POST",
  nøkkel: string,
  params?: URLSearchParams,
): Promise<any> {
  const url = `https://api.stripe.com/v1/${sti}` +
    (metode === "GET" && params ? `?${params}` : "");
  const res = await fetch(url, {
    method: metode,
    headers: {
      Authorization: `Bearer ${nøkkel}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: metode === "POST" ? params : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Stripe svarte ${res.status}`);
  }
  return data;
}

// Finn pris-ID i Stripe ut fra intervall + beløp (NOK). Faller tilbake til
// første aktive pris med riktig intervall hvis beløpet ikke matcher eksakt.
async function finnPris(
  nøkkel: string,
  valg: (typeof PRISER)[keyof typeof PRISER],
): Promise<string> {
  const data = await stripeKall(
    "prices",
    "GET",
    nøkkel,
    new URLSearchParams({ active: "true", type: "recurring", limit: "100" }),
  );
  const kandidater = (data.data ?? []).filter((p: any) =>
    p.currency === "nok" && p.recurring?.interval === valg.interval
  );
  const eksakt = kandidater.find((p: any) => p.unit_amount === valg.beløp);
  const pris = eksakt ?? kandidater[0];
  if (!pris) {
    throw new Error(
      `Fant ingen aktiv ${valg.label}-pris i Stripe. Sjekk at produktet ` +
        `«Kulturvarsling Premium» er opprettet med gjentakende pris i NOK ` +
        `(se docs/STRIPE-OPPSETT.md).`,
    );
  }
  return pris.id;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svar = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  try {
    const stripeNøkkel = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeNøkkel) {
      return svar({
        error:
          "Betaling er ikke konfigurert ennå (STRIPE_SECRET_KEY mangler som Supabase-secret).",
      }, 500);
    }

    // Hvem er brukeren? JWT-en følger med fra appen via Authorization-headeren.
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: req.headers.get("Authorization")! } },
      },
    );
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return svar({ error: "Du må være innlogget for å oppgradere." }, 401);

    const { interval } = await req.json().catch(() => ({}));
    const valg = PRISER[interval as keyof typeof PRISER];
    if (!valg) return svar({ error: "Ugyldig prisvalg." }, 400);

    // Service-rolle for å lese/lagre stripe_customer_id uavhengig av RLS.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: profil } = await admin.from("profiler")
      .select("stripe_customer_id").eq("id", user.id).single();

    // Gjenbruk Stripe-kunden hvis den finnes — ellers opprett og lagre den.
    let kundeId = profil?.stripe_customer_id;
    if (!kundeId) {
      const kunde = await stripeKall(
        "customers",
        "POST",
        stripeNøkkel,
        new URLSearchParams({
          email: user.email ?? "",
          "metadata[supabase_user_id]": user.id,
        }),
      );
      kundeId = kunde.id;
      await admin.from("profiler")
        .update({ stripe_customer_id: kundeId }).eq("id", user.id);
    }

    const prisId = await finnPris(stripeNøkkel, valg);

    const origin = TILLATTE_ORIGINS.includes(req.headers.get("origin") ?? "")
      ? req.headers.get("origin")!
      : "https://www.kulturvarsling.no";

    const session = await stripeKall(
      "checkout/sessions",
      "POST",
      stripeNøkkel,
      new URLSearchParams({
        mode: "subscription",
        customer: kundeId!,
        "line_items[0][price]": prisId,
        "line_items[0][quantity]": "1",
        success_url: `${origin}/app?premium=suksess`,
        cancel_url: `${origin}/app?premium=avbrutt`,
        client_reference_id: user.id,
        "subscription_data[metadata][supabase_user_id]": user.id,
        locale: "nb",
        allow_promotion_codes: "true",
      }),
    );

    return svar({ url: session.url });
  } catch (e) {
    console.error("stripe-checkout-feil:", e);
    return svar({ error: (e as Error).message }, 500);
  }
});
