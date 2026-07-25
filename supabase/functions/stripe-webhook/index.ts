// Mottar hendelser fra Stripe og oppdaterer profiler.plan (E5).
// Dette er sannhetskilden for hvem som er Premium — appen stoler aldri på
// frontend, kun på det Stripe bekrefter hit.
//
// Håndterte hendelser:
//   checkout.session.completed    → plan = "premium" + lagre stripe_customer_id
//   customer.subscription.deleted → plan = "gratis"
//
// MÅ deployes uten JWT-krav (Stripe har ingen Supabase-token):
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// Secrets: STRIPE_WEBHOOK_SECRET (whsec_... fra webhook-oppsettet i Stripe).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOLERANSE_SEK = 300; // avvis signaturer eldre enn 5 min (replay-vern)

// Stripe signerer `${timestamp}.${payload}` med HMAC-SHA256 og sender
// resultatet i stripe-signature-headeren som "t=...,v1=...".
async function verifiserSignatur(
  payload: string,
  header: string | null,
  hemmelighet: string,
): Promise<boolean> {
  if (!header) return false;
  const deler = header.split(",").map((d) => d.split("="));
  const t = deler.find(([k]) => k === "t")?.[1];
  const signaturer = deler.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || signaturer.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > TOLERANSE_SEK) return false;

  const nøkkel = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(hemmelighet),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    nøkkel,
    new TextEncoder().encode(`${t}.${payload}`),
  );
  const forventet = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  // Konstant-tids sammenligning så timing ikke lekker noe.
  return signaturer.some((sig) => {
    if (sig.length !== forventet.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) {
      diff |= sig.charCodeAt(i) ^ forventet.charCodeAt(i);
    }
    return diff === 0;
  });
}

Deno.serve(async (req: Request) => {
  const hemmelighet = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!hemmelighet) {
    console.error("STRIPE_WEBHOOK_SECRET mangler som Supabase-secret");
    return new Response("Ikke konfigurert", { status: 500 });
  }

  const payload = await req.text();
  const gyldig = await verifiserSignatur(
    payload,
    req.headers.get("stripe-signature"),
    hemmelighet,
  );
  if (!gyldig) return new Response("Ugyldig signatur", { status: 400 });

  const event = JSON.parse(payload);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const brukerId = session.client_reference_id ??
      session.metadata?.supabase_user_id;
    if (brukerId) {
      const { error } = await admin.from("profiler")
        .update({
          plan: "premium",
          stripe_customer_id: session.customer,
          oppdatert: new Date().toISOString(),
        })
        .eq("id", brukerId);
      if (error) {
        // 500 → Stripe prøver på nytt senere i stedet for å miste hendelsen.
        console.error("Kunne ikke aktivere premium:", error);
        return new Response("DB-feil", { status: 500 });
      }
      console.log(`Premium aktivert for bruker ${brukerId}`);
    } else {
      console.error("checkout.session.completed uten bruker-referanse");
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    const { data, error } = await admin.from("profiler")
      .update({ plan: "gratis", oppdatert: new Date().toISOString() })
      .eq("stripe_customer_id", sub.customer)
      .select("id");
    if (error) {
      console.error("Kunne ikke nedgradere:", error);
      return new Response("DB-feil", { status: 500 });
    }
    if (!data?.length && sub.metadata?.supabase_user_id) {
      // Reserveløsning hvis kunde-ID-en aldri ble lagret på profilen.
      await admin.from("profiler")
        .update({ plan: "gratis", oppdatert: new Date().toISOString() })
        .eq("id", sub.metadata.supabase_user_id);
    }
    console.log(`Abonnement avsluttet for Stripe-kunde ${sub.customer}`);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
