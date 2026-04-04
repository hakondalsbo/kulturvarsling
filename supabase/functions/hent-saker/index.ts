import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Kulturrelevante nøkkelord ────────────────────────────────────────────────
const KULTUR_NØKKELORD = [
  "kultur", "kunst", "scenekunst", "musikk", "film", "museum", "museer",
  "bibliotek", "dans", "teater", "kulturliv", "kulturbudsjettet",
  "kulturpolitikk", "kulturmidler", "kulturskole", "kulturbygg",
  "kulturarv", "kulturinstitusjon", "kulturfondet", "kunstner",
  "stipend", "kulturrådet", "kulturdirektorat", "spillmidler",
  "litteratur", "opera", "ballett", "festival", "konsert", "kino",
  "forfatter", "komponist", "billedkunst", "skulptur", "arkiv",
  "riksteatret", "nationaltheatret", "operaen", "filminstituttet",
];

// Nøkkelord som indikerer at saken IKKE er kulturrelevant selv om den
// passerer positiv nøkkelordsjekk (f.eks. via "Familie- og kulturkomiteen")
const IKKE_KULTUR = [
  "redningshelikopter", "helikopterbas", "beredskapsavtale",
  "forsvarsdepartement", "politiet", "kriminalitet",
  "veibygging", "samferdsel", "vegvesen",
  "sykehus", "helseforetak", "legemiddel",
  "juks i skolen", "eksamen", "karakterer",
  "fengsel", "kriminalomsorg",
];

function erKulturRelevant(tittel: string, tekst = ""): boolean {
  const haystack = `${tittel} ${tekst}`.toLowerCase();
  if (IKKE_KULTUR.some((k) => haystack.includes(k))) return false;
  return KULTUR_NØKKELORD.some((k) => haystack.includes(k));
}

// ─── Stortinget API ───────────────────────────────────────────────────────────
async function hentStortingetHøringer(): Promise<any[]> {
  const items: any[] = [];
  const sesjoner = ["2025-2026"];

  for (const sesjon of sesjoner) {
    try {
      const url =
        `https://data.stortinget.no/eksport/horingsoversikt?sesjon=${sesjon}&format=json`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        console.error(`Stortinget API svarte ${res.status}`);
        continue;
      }
      const data = await res.json();
      const horinger: any[] = data?.horinger_oversikt_liste ?? [];

      for (const h of horinger) {
        const id = h.id ?? h.høring_id ?? "";
        const tittel = h.tittel ?? h.name ?? "";
        if (!tittel) continue;

        items.push({
          tittel,
          instans: h.komite?.navn ?? "Stortinget",
          kilde: `https://www.stortinget.no/no/Hva-skjer-pa-Stortinget/Horing/${id}/`,
          frist: h.frist_dato
            ? h.frist_dato.split("T")[0]
            : (h.dato ? h.dato.split("T")[0] : null),
          sammendrag_raa: h.beskrivelse ?? "",
          kilde_id: `stortinget-${id}`,
        });
      }
      console.log(
        `Stortinget (${sesjon}): ${horinger.length} høringer hentet`,
      );
    } catch (e) {
      console.error("Stortinget API feil:", e);
    }
  }

  return items;
}

// ─── Regjeringen KUD RSS ──────────────────────────────────────────────────────
async function hentRegjeringenRSS(): Promise<any[]> {
  const items: any[] = [];
  const feeds = [
    {
      url: "https://www.regjeringen.no/no/dep/kud/rss/",
      instans: "Kulturdepartementet",
    },
    {
      url: "https://www.regjeringen.no/no/dep/kud/aktuelt/rss/",
      instans: "Kulturdepartementet",
    },
    {
      url: "https://www.regjeringen.no/no/tema/kunst-og-kultur/rss/",
      instans: "Regjeringen",
    },
  ];

  for (const feed of feeds) {
    try {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": "Kulturvarsling/1.0" },
      });
      if (!res.ok) {
        console.error(`RSS ${feed.url} svarte ${res.status}`);
        continue;
      }
      const xml = await res.text();

      // Parse <item> blokker
      const itemBlokker = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
      for (const match of itemBlokker) {
        const blokk = match[1];

        const tittel = (
          blokk.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1] ??
          blokk.match(/<title>([\s\S]*?)<\/title>/)?.[1] ??
          ""
        ).trim();

        const link = (
          blokk.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? ""
        ).trim();

        const beskrivelse = (
          blokk.match(
            /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/,
          )?.[1] ??
          blokk.match(/<description>([\s\S]*?)<\/description>/)?.[1] ??
          ""
        ).replace(/<[^>]+>/g, "").trim().slice(0, 600);

        const pubDate =
          blokk.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "";

        if (!tittel || !link) continue;

        items.push({
          tittel,
          instans: feed.instans,
          kilde: link,
          frist: null, // RSS har sjelden frist
          sammendrag_raa: beskrivelse,
          kilde_id: `rss-${link}`,
          publisert_dato: pubDate
            ? new Date(pubDate).toISOString().split("T")[0]
            : null,
        });
      }
      console.log(`RSS ${feed.url}: ${itemBlokker.length} items hentet`);
    } catch (e) {
      console.error(`RSS feil for ${feed.url}:`, e);
    }
  }

  return items;
}

// ─── Stortinget: familie- og kulturkomiteens saker ────────────────────────────
async function hentKomiteensSaker(): Promise<any[]> {
  const items: any[] = [];
  try {
    const url =
      "https://data.stortinget.no/eksport/saker?sesjon=2025-2026&komite=FaKu&format=json";
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return items;

    const data = await res.json();
    const saker: any[] = data?.saker_liste ?? [];

    for (const sak of saker) {
      const id = sak.id ?? "";
      const tittel = sak.tittel ?? sak.korttittel ?? "";
      if (!tittel) continue;

      items.push({
        tittel,
        instans: "Familie- og kulturkomiteen, Stortinget",
        kilde: `https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=${id}`,
        frist: sak.frist_dato ? sak.frist_dato.split("T")[0] : null,
        sammendrag_raa: sak.beskrivelse ?? sak.innstilling ?? "",
        kilde_id: `stortinget-sak-${id}`,
      });
    }
    console.log(`Komiteen: ${saker.length} saker hentet`);
  } catch (e) {
    console.error("Komite-saker feil:", e);
  }
  return items;
}

// ─── Claude API: kategoriser og sammendrag ────────────────────────────────────
async function analyserMedClaude(
  item: any,
  apiKey: string,
): Promise<any | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: `Du er ekspert på norsk kulturpolitikk. Vurder om denne saken er DIREKTE relevant for profesjonelle aktører i norsk kultursektor (kunstnere, kulturinstitusjoner, kulturorganisasjoner).

Tittel: ${item.tittel}
${item.sammendrag_raa ? `Beskrivelse: ${item.sammendrag_raa.slice(0, 400)}` : ""}
Instans: ${item.instans}

RELEVANT = ja BARE hvis saken direkte berører: finansiering av kunst/kultur, kulturinstitusjoner, kunstnerstipend, kulturbygg, scenekunst, musikk, film, museer, bibliotek, kulturarv, opphavsrett, kulturpolitikk, kulturskoler, kulturfond eller lignende kjerneområder for kulturfeltet.

IKKE RELEVANT = saker om: forsvar, beredskap, helse, skole (unntatt kulturskole), justis, samferdsel, AI i utdanning generelt, helikopter, redning, eller andre saker som bare nevner "kultur" i forbifarten.

Svar BARE med gyldig JSON, ingen markdown:
{
  "relevant": true eller false,
  "kategori": "scenekunst" | "musikk" | "dans" | "opera" | "litteratur" | "film" | "visuell" | "museer" | "spill" | "kulturarv",
  "niva": "nasjonalt" | "fylke" | "kommune",
  "status": "kritisk" | "viktig" | "normal",
  "sammendrag": "1-2 konkrete setninger om hva saken betyr for kulturfeltet"
}`,
          },
        ],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const tekst = data.content?.[0]?.text ?? "{}";
    return JSON.parse(tekst.trim());
  } catch (e) {
    console.error("Claude feil:", e);
    return null;
  }
}

// ─── Bestem status ut fra frist ───────────────────────────────────────────────
function statusFraFrist(frist: string | null): string {
  if (!frist) return "normal";
  const dager = Math.floor(
    (new Date(frist).getTime() - Date.now()) / 86400000,
  );
  if (dager < 0) return "normal"; // allerede utløpt
  if (dager <= 7) return "kritisk";
  if (dager <= 21) return "viktig";
  return "normal";
}

// ─── Hoved-handler ────────────────────────────────────────────────────────────
Deno.serve(async (_req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

    // Hent eksisterende kilder for deduplicering
    const { data: eks } = await supabase.from("varsler").select("kilde");
    const eksKilder = new Set((eks ?? []).map((v: any) => v.kilde));

    // Hent fra alle kilder parallelt
    const [høringer, rssItems, komiteen] = await Promise.all([
      hentStortingetHøringer(),
      hentRegjeringenRSS(),
      hentKomiteensSaker(),
    ]);

    const alle = [...høringer, ...rssItems, ...komiteen];

    // Filtrer bort duplikater og ikke-relevante
    const nye = alle.filter(
      (item) =>
        item.kilde &&
        !eksKilder.has(item.kilde) &&
        erKulturRelevant(item.tittel, item.sammendrag_raa),
    );

    console.log(
      `Totalt hentet: ${alle.length}, nye og relevante: ${nye.length}`,
    );

    let antallLagret = 0;
    const feil: string[] = [];

    for (const item of nye) {
      let kategori = "scenekunst";
      let niva = "nasjonalt";
      let status = statusFraFrist(item.frist);
      let sammendrag = item.sammendrag_raa?.slice(0, 400) || item.tittel;

      // Bruk Claude for bedre analyse hvis API-nøkkel er satt
      if (anthropicKey) {
        const analyse = await analyserMedClaude(item, anthropicKey);
        if (analyse && !analyse.relevant) continue; // ikke relevant ifølge Claude
        if (analyse) {
          kategori = analyse.kategori ?? kategori;
          niva = analyse.niva ?? niva;
          sammendrag = analyse.sammendrag || sammendrag;
          // Bruk Claude-status kun hvis vi ikke har frist (frist er mer presis)
          if (!item.frist) status = analyse.status ?? status;
        }
      }

      const { error } = await supabase.from("varsler").insert({
        tittel: item.tittel,
        sammendrag,
        instans: item.instans,
        kilde: item.kilde,
        frist: item.frist ?? null,
        kategori,
        niva,
        sted: niva === "nasjonalt" ? "Nasjonalt" : "Norge",
        status,
        publisert: true,
      });

      if (error) {
        feil.push(`${item.tittel}: ${error.message}`);
      } else {
        antallLagret++;
        eksKilder.add(item.kilde); // unngå dobbel innsetting i samme kjøring
      }
    }

    const respons = {
      kjørt: new Date().toISOString(),
      hentet_totalt: alle.length,
      nye_og_relevante: nye.length,
      lagret: antallLagret,
      feil: feil.length > 0 ? feil : undefined,
    };

    console.log("Ferdig:", respons);
    return new Response(JSON.stringify(respons), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Kritisk feil:", e);
    return new Response(JSON.stringify({ feil: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
