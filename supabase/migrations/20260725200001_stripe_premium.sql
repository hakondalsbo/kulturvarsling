-- E5: Ekte premium via Stripe-abonnement.
-- Kobler Supabase-brukeren til Stripe-kunden slik at webhooken kan finne
-- riktig profil når et abonnement opprettes eller avsluttes.

alter table public.profiler
  add column if not exists stripe_customer_id text;

create index if not exists profiler_stripe_customer_idx
  on public.profiler (stripe_customer_id);
