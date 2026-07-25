-- Nattlig automatikk INNE i Supabase (pg_cron + pg_net) — erstatter behovet
-- for Vercel Cron. Kjører hent-saker hver natt kl. 06:00 UTC (08:00 norsk
-- sommertid). Anon-nøkkelen er offentlig av design (ligger i frontenden).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'hent-saker-daglig',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://zyyijlvmgoanjdzngmon.supabase.co/functions/v1/hent-saker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5eWlqbHZtZ29hbmpkem5nbW9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNDI1NzMsImV4cCI6MjA4ODkxODU3M30.k2WWIg_7STiIOPSGojZ2zH_QCShvvSw8Ax0hk1yGjOI',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5eWlqbHZtZ29hbmpkem5nbW9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNDI1NzMsImV4cCI6MjA4ODkxODU3M30.k2WWIg_7STiIOPSGojZ2zH_QCShvvSw8Ax0hk1yGjOI'
    ),
    body := '{}'::jsonb
  )
  $$
);
