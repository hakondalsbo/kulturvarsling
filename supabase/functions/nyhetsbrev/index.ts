// Nyhetsbrevet er av. Prod svarer 410, og denne filen er den samme stubben.
// En deploy fra repoet skal ikke slå den gamle utsendingen på igjen.
// Den gamle koden ligger i supabase/arkiv/nyhetsbrev.ts og er ikke en funksjon.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve((_req: Request) => {
  return new Response("Nyhetsbrevet er av.", {
    status: 410,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
