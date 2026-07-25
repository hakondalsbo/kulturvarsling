// E2 Klartekst (VEIKART): «hva betyr dette for deg?» — visjonens kjerne.
// Claude oversetter forvaltningsspråk til klartekst, personalisert på
// mottakerens profil (fagfelt, org-type, sted). Svaret caches per sak +
// profiltype, så samme forklaring betales kun én gang på tvers av like brukere.
//
// Kalles fra nettleseren (SaksModal), derfor CORS + OPTIONS-preflight.
// POST-body: { sak: {...}, profil: { orgType, orgNavn, fagfelt: [labels],
//              kommunenr, fylkesnr }, brukerId? }
// Secrets: ANTHROPIC_API_KEY (finnes).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MODELL = "claude-sonnet-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// Fylkesnavn per fylkesnummer (2024-inndelingen, 15 fylker). Kommunenavn slås
// opp fra Brønnøysund (lat, varm modul-cache mellom kall i samme isolat).
const FYLKE: Record<string, string> = {
  "03": "Oslo", "11": "Rogaland", "15": "Møre og Romsdal", "18": "Nordland",
  "31": "Østfold", "32": "Akershus", "33": "Buskerud", "34": "Innlandet",
  "39": "Vestfold", "40": "Telemark", "42": "Agder", "46": "Vestland",
  "50": "Trøndelag", "55": "Troms", "56": "Finnmark",
};
let kommuneNavn: Map<string, string> | null = null;
async function kommuneNavnFor(knr: string): Promise<string | null> {
  if (!kommuneNavn) {
    try {
      const res = await fetch(
        "https://data.brreg.no/enhetsregisteret/api/kommuner?size=500",
        { headers: { Accept: "application/json" } },
      );
      const data = await res.json();
      kommuneNavn = new Map(
        (data?._embedded?.kommuner ?? []).map((k: any) => [
          k.nummer,
          String(k.navn).toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m: string) => m.toUpperCase()),
        ]),
      );
    } catch (_) {
      kommuneNavn = new Map();
    }
  }
  return kommuneNavn.get(knr) ?? null;
}

// Profiltype = cache-nøkkelen. Grov nok til å deles mellom like brukere, presis
// nok til at forklaringen treffer: org-type | primærfagfelt | fylke.
function profiltypeAv(p: any): string {
  const orgType = (p?.orgType || "generell").toString().toLowerCase();
  const fagfelt = Array.isArray(p?.fagfelt) && p.fagfelt.length
    ? p.fagfelt.slice().sort().join(",").toLowerCase()
    : "alle";
  const geo = p?.kommunenr || p?.fylkesnr || "NO";
  return `${orgType}|${fagfelt}|${geo}`;
}

async function beskrivMottaker(p: any): Promise<string> {
  const roller: Record<string, string> = {
    organisasjon: "en kulturorganisasjon",
    kunstner: "en frilanser/kunstner",
    institusjon: "en kulturinstitusjon",
    annet: "en kulturaktør",
  };
  const rolle = roller[p?.orgType] || "en kulturaktør";
  const felt = Array.isArray(p?.fagfelt) && p.fagfelt.length
    ? ` innen ${p.fagfelt.join(", ")}`
    : "";
  let sted = "i Norge";
  if (p?.kommunenr) {
    const navn = await kommuneNavnFor(p.kommunenr);
    const fylke = FYLKE[p.fylkesnr] ?? FYLKE[p.kommunenr.slice(0, 2)];
    sted = navn ? `i ${navn}${fylke ? ` (${fylke})` : ""}` : (fylke ? `i ${fylke}` : sted);
  } else if (p?.fylkesnr && FYLKE[p.fylkesnr]) {
    sted = `i ${FYLKE[p.fylkesnr]}`;
  }
  const navn = p?.orgNavn ? ` (${p.orgNavn})` : "";
  return `${rolle}${felt}, ${sted}${navn}`;
}

async function skrivKlartekst(
  apiKey: string,
  sak: any,
  mottaker: string,
): Promise<any | null> {
  const nivåTekst = { nasjonalt: "nasjonalt", fylke: "regionalt/fylke", kommune: "lokalt/kommune" }[sak?.niva] ?? sak?.niva ?? "";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODELL,
        max_tokens: 900,
        messages: [{
          role: "user",
          content:
            `Du er ekspert på norsk kulturpolitikk og oversetter tørt forvaltningsspråk til klartekst for travle kulturaktører. Forklar hva DENNE saken konkret betyr for MOTTAKEREN — direkte, jordnært, uten byråkratspråk.

SAKEN:
Tittel: ${sak?.tittel ?? ""}
Instans: ${sak?.instans ?? ""} (nivå: ${nivåTekst})
${sak?.frist ? `Oppgitt frist: ${sak.frist}` : "Ingen frist oppgitt."}
Sammendrag: ${(sak?.sammendrag ?? "").slice(0, 800)}

MOTTAKEREN: ${mottaker}.

Svar BARE med gyldig JSON, ingen markdown:
{
  "for_deg": "2-3 setninger, start konkret og snakk direkte til mottakeren (du/deg), f.eks. «Som friteater i Vestland betyr dette at …». Er saken egentlig lite relevant for nettopp denne mottakeren, si det ærlig i stedet for å overdrive.",
  "hvem_paavirkes": "Én setning: hvem i kulturfeltet dette treffer mest.",
  "belop": "Beløp eller økonomisk konsekvens i klartekst hvis saken nevner det, ellers null.",
  "frist": "Hva som eventuelt haster og når, ellers null.",
  "handlingsvalg": ["2-4 korte, konkrete ting mottakeren kan gjøre nå (imperativ), f.eks. «Send høringssvar før fristen», «Kontakt kulturkomiteen», «Følg saken»."]
}`,
        }],
      }),
    });
    if (!res.ok) {
      console.error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const tekst = (data.content?.find((b: any) => b.type === "text")?.text ?? "{}")
      .replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(tekst);
  } catch (e) {
    console.error("Klartekst-feil:", e);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { sak, profil, brukerId } = await req.json().catch(() => ({}));
    if (!sak?.id || !sak?.tittel) return json({ feil: "mangler sak" }, 400);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ feil: "mangler ANTHROPIC_API_KEY" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const profiltype = profiltypeAv(profil);

    // 1) Cache-treff → returner umiddelbart (ingen Claude-kostnad, teller ikke
    //    mot en fremtidig gratis-grense siden ingenting genereres på nytt).
    const { data: cachet } = await supabase.from("klartekst_cache")
      .select("tekst").eq("sak_id", String(sak.id)).eq("profiltype", profiltype)
      .maybeSingle();
    if (cachet?.tekst) {
      return json({ kilde: "cache", profiltype, ...cachet.tekst });
    }

    // 2) Cache-bom → generer med Claude
    const mottaker = await beskrivMottaker(profil ?? {});
    const tekst = await skrivKlartekst(apiKey, sak, mottaker);
    if (!tekst) return json({ feil: "Claude utilgjengelig — prøv igjen" }, 502);

    // 3) Lagre i cache (best-effort — svaret leveres uansett)
    await supabase.from("klartekst_cache").upsert({
      sak_id: String(sak.id), profiltype, tekst, modell: MODELL,
    }).then(({ error }) => error && console.error("cache-skriv:", error.message));

    // 4) Spor genereringen i aktivitet (best-effort). Kun ved NY generering, så
    //    E5 kan telle billbare genereringer mot gratis-grensen uten å telle
    //    gjentatte visninger. Feiler stille hvis skjema ikke matcher.
    if (brukerId) {
      await supabase.from("aktivitet").insert({
        bruker_id: brukerId, type: "klartekst",
        tittel: `Klartekst: ${sak.tittel}`.slice(0, 200), sak_id: String(sak.id),
      }).then(({ error }) => error && console.error("aktivitet-logg:", error.message));
    }

    return json({ kilde: "ny", profiltype, ...tekst });
  } catch (e) {
    console.error("forklar-sak feil:", e);
    return json({ feil: String(e) }, 500);
  }
});
