import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  erKulturRelevant,
  erKulturSak,
  finnHøringsfrist,
  parseRssItems,
  statusFraFrist,
} from "./logikk.ts";
import { hentEInnsynKultursaker } from "./einnsyn.ts";

// ─── Stortinget: kultursaker med høringsfrister ───────────────────────────────
// KILDEKART-funn (verifisert juli 2026): det gamle endepunktet
// eksport/horingsoversikt finnes ikke (404), og eksport/horinger er nede (500).
// Strategi nå: hent ALLE saker for sesjonen (serverens komité-filter ignoreres
// uansett), filtrer klientside med erKulturSak, og slå opp eksport/sak per NY
// kultursak for å finne HOERFRIST (høringsfrist). Detaljoppslag gjøres kun for
// saker vi ikke har fra før, så antall kall er lite etter første kjøring.
async function hentStortingetSaker(eksKilder: Set<string>): Promise<any[]> {
  const items: any[] = [];
  const sesjoner = ["2025-2026"];

  for (const sesjon of sesjoner) {
    try {
      const res = await fetch(
        `https://data.stortinget.no/eksport/saker?sesjonid=${sesjon}&format=json`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) {
        console.error(`Stortinget saker svarte ${res.status}`);
        continue;
      }
      const data = await res.json();
      const alleSaker: any[] = data?.saker_liste ?? [];
      const kultursaker = alleSaker.filter(erKulturSak);
      console.log(
        `Stortinget (${sesjon}): ${alleSaker.length} saker totalt, ${kultursaker.length} kulturrelevante`,
      );

      for (const sak of kultursaker) {
        const tittel = sak.tittel ?? sak.korttittel ?? "";
        if (!tittel) continue;
        const kilde =
          `https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=${sak.id}`;
        if (eksKilder.has(kilde)) continue; // detaljoppslag kun for nye saker

        let frist: string | null = null;
        try {
          const detRes = await fetch(
            `https://data.stortinget.no/eksport/sak?sakid=${sak.id}&format=json`,
            { headers: { Accept: "application/json" } },
          );
          if (detRes.ok) frist = finnHøringsfrist(await detRes.json());
        } catch (e) {
          console.error(`Detaljoppslag for sak ${sak.id} feilet:`, e);
        }

        items.push({
          tittel,
          instans: sak.komite?.navn
            ? `${sak.komite.navn}, Stortinget`
            : "Stortinget",
          kilde,
          frist,
          sammendrag_raa: sak.henvisning ?? "",
          kilde_id: `stortinget-sak-${sak.id}`,
          forhåndsgodkjent: true, // valgt via komité/emne — skal ikke stoppes av nøkkelordfilteret
        });
      }
    } catch (e) {
      console.error("Stortinget saker feil:", e);
    }
  }

  return items;
}

// ─── Stortinget: ventede saker (tidligvarsling) ───────────────────────────────
// Regjeringens VARSLEDE kommende proposisjoner/meldinger — lar oss varsle
// kulturfeltet FØR sakene fremmes for Stortinget. (Verifisert i kildekartet.)
async function hentVentedeSaker(): Promise<any[]> {
  const items: any[] = [];
  try {
    const res = await fetch(
      "https://data.stortinget.no/eksport/ventedesaker?format=json",
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) {
      console.error(`Ventede saker svarte ${res.status}`);
      return items;
    }
    const data = await res.json();
    const saker: any[] = data?.saker_liste ?? [];

    for (const sak of saker) {
      const departement: string = sak.departement ?? "";
      const tittel: string = sak.tittel ?? "";
      if (!tittel) continue;
      if (!/kultur/i.test(departement) && !erKulturRelevant(tittel)) continue;

      items.push({
        tittel: `Varslet sak: ${tittel}`,
        instans: departement || "Regjeringen",
        kilde:
          `https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/ventede-saker/#sak-${sak.id}`,
        frist: null,
        sammendrag_raa:
          `${sak.type ?? "Sak"} varslet fremmet i ${sak["måned"] ?? "kommende sesjon"}. ` +
          "Tidligvarsling: saken er ennå ikke fremmet for Stortinget.",
        kilde_id: `stortinget-ventet-${sak.id}`,
        forhåndsgodkjent: true,
      });
    }
    console.log(
      `Ventede saker: ${saker.length} totalt, ${items.length} kulturrelevante`,
    );
  } catch (e) {
    console.error("Ventede saker feil:", e);
  }
  return items;
}

// ─── Regjeringen RSS ──────────────────────────────────────────────────────────
// KILDEKART-oppgradering: RSS-generatoren dekker høringer, NOU-er, meldinger og
// proposisjoner fra ALLE departement (verifisert, 100 elementer per feed) — ikke
// bare KUD. Nøkkelord- og Claude-filtrene siler ut det som ikke angår kultur.
async function hentRegjeringenRSS(): Promise<any[]> {
  const items: any[] = [];
  const feeds = [
    {
      url: "https://www.regjeringen.no/no/rss/Rss/2581966/?documentType=dokumenter/h%C3%B8ringer",
      instans: "Regjeringen – høring",
    },
    {
      url: "https://www.regjeringen.no/no/rss/Rss/2581966/?documentType=dokumenter/nouer",
      instans: "Regjeringen – NOU",
    },
    {
      url: "https://www.regjeringen.no/no/rss/Rss/2581966/?documentType=dokumenter/meldinger",
      instans: "Regjeringen – stortingsmelding",
    },
    {
      url: "https://www.regjeringen.no/no/rss/Rss/2581966/?documentType=dokumenter/proposisjoner",
      instans: "Regjeringen – proposisjon",
    },
    {
      url: "https://www.regjeringen.no/no/dep/kud/rss/",
      instans: "Kulturdepartementet",
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
      const parsed = parseRssItems(xml, feed.instans);
      items.push(...parsed);
      console.log(`RSS ${feed.url}: ${parsed.length} items hentet`);
    } catch (e) {
      console.error(`RSS feil for ${feed.url}:`, e);
    }
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

    if (!res.ok) {
      const kropp = await res.text().catch(() => "");
      console.error(`Claude API ${res.status}: ${kropp.slice(0, 300)}`);
      return null;
    }
    const data = await res.json();
    const tekst = data.content?.[0]?.text ?? "{}";
    return JSON.parse(tekst.trim());
  } catch (e) {
    console.error("Claude feil:", e);
    return null;
  }
}

// ─── Claude-helsesjekk ────────────────────────────────────────────────────────
// Ett mikro-kall ved oppstart så responsen alltid viser OM og HVORFOR
// AI-laget eventuelt er nede — aldri mer stille Claude-svikt.
async function testClaude(apiKey: string | undefined): Promise<string> {
  if (!apiKey) return "mangler ANTHROPIC_API_KEY";
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
        max_tokens: 8,
        messages: [{ role: "user", content: "Svar kun: ok" }],
      }),
    });
    if (res.ok) return "ok";
    const kropp = await res.text().catch(() => "");
    return `HTTP ${res.status}: ${kropp.slice(0, 200)}`;
  } catch (e) {
    return `nettverksfeil: ${String(e).slice(0, 150)}`;
  }
}

// ─── Hoved-handler ────────────────────────────────────────────────────────────
Deno.serve(async (_req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const claudeStatus = await testClaude(anthropicKey);
    if (claudeStatus !== "ok") console.error("Claude-helsesjekk:", claudeStatus);

    // Hent eksisterende kilder for deduplicering
    const { data: eks } = await supabase.from("varsler").select("kilde");
    const eksKilder = new Set((eks ?? []).map((v: any) => v.kilde));

    const t0 = Date.now();

    // Kilderegisteret: kobler kjøringslogg til kilde (ARKITEKTUR §1.4)
    const { data: kilderRows } = await supabase
      .from("kilder")
      .select("id, adapter")
      .eq("aktiv", true);
    const kilderMap = new Map<string, string>(
      (kilderRows ?? []).map((r: any) => [r.adapter, r.id]),
    );

    // Hent fra alle kilder parallelt
    const [stortingssaker, rssItems, ventede, einnsynSaker] = await Promise.all([
      hentStortingetSaker(eksKilder),
      hentRegjeringenRSS(),
      hentVentedeSaker(),
      hentEInnsynKultursaker(),
    ]);

    const merk = (liste: any[], adapter: string) =>
      liste.map((i) => ({ ...i, adapter }));
    const alle = [
      ...merk(stortingssaker, "stortinget-saker"),
      ...merk(rssItems, "regjeringen-rss"),
      ...merk(ventede, "stortinget-ventede"),
      ...merk(einnsynSaker, "einnsyn"),
    ];

    // Filtrer bort duplikater og ikke-relevante.
    // Saker valgt via komité/emne (forhåndsgodkjent) hopper over nøkkelordfilteret —
    // en sak om åndsverkloven mangler f.eks. ordet «kultur» i tittelen.
    // Claude-laget kvalitetssikrer uansett alt til slutt.
    const nye = alle.filter(
      (item) =>
        item.kilde &&
        !eksKilder.has(item.kilde) &&
        (item.forhåndsgodkjent ||
          erKulturRelevant(item.tittel, item.sammendrag_raa)),
    );

    console.log(
      `Totalt hentet: ${alle.length}, nye og relevante: ${nye.length}`,
    );

    let antallLagret = 0;
    const lagretPerAdapter = new Map<string, number>();
    const feil: string[] = [];

    for (const item of nye) {
      let kategori = "scenekunst";
      let niva = "nasjonalt";
      let status = statusFraFrist(item.frist);
      let sammendrag = item.sammendrag_raa?.slice(0, 400) || item.tittel;

      // Bruk Claude for bedre analyse hvis API-nøkkel er satt
      if (anthropicKey) {
        let analyse = await analyserMedClaude(item, anthropicKey);
        if (!analyse) analyse = await analyserMedClaude(item, anthropicKey); // ett nytt forsøk
        if (!analyse) {
          // Claude utilgjengelig (rate-limit e.l.): IKKE lagre ufiltrert.
          // Saken er ikke i varsler ennå, så dedup stopper den ikke — den
          // blir vurdert på nytt ved neste kjøring i stedet.
          feil.push(`${item.tittel.slice(0, 60)}: Claude-analyse utilgjengelig, utsatt`);
          continue;
        }
        if (!analyse.relevant) continue; // ikke relevant ifølge Claude
        kategori = analyse.kategori ?? kategori;
        niva = analyse.niva ?? niva;
        sammendrag = analyse.sammendrag || sammendrag;
        // Bruk Claude-status kun hvis vi ikke har frist (frist er mer presis)
        if (!item.frist) status = analyse.status ?? status;
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
        lagretPerAdapter.set(
          item.adapter,
          (lagretPerAdapter.get(item.adapter) ?? 0) + 1,
        );
        eksKilder.add(item.kilde); // unngå dobbel innsetting i samme kjøring
      }
    }

    // Kjøringslogg per kilde — «stillhet er ikke suksess»: en kilde med 0 funn
    // eller vedvarende «tom»-status skal være synlig i kilde_kjoringer.
    const kjøringer: Array<[string, number]> = [
      ["stortinget-saker", stortingssaker.length],
      ["regjeringen-rss", rssItems.length],
      ["stortinget-ventede", ventede.length],
      ["einnsyn", einnsynSaker.length],
    ];
    for (const [adapter, funnet] of kjøringer) {
      const kildeId = kilderMap.get(adapter);
      if (!kildeId) continue;
      const status = funnet > 0 ? "ok" : "tom";
      await supabase.from("kilde_kjoringer").insert({
        kilde_id: kildeId,
        status,
        antall_funnet: funnet,
        antall_nye: lagretPerAdapter.get(adapter) ?? 0,
        varighet_ms: Date.now() - t0,
      });
      await supabase
        .from("kilder")
        .update({ sist_hentet: new Date().toISOString(), sist_status: status })
        .eq("id", kildeId);
    }

    const respons = {
      kjørt: new Date().toISOString(),
      claude_status: claudeStatus,
      hentet_totalt: alle.length,
      nye_og_relevante: nye.length,
      lagret: antallLagret,
      feil: feil.length > 0 ? feil.slice(0, 10) : undefined,
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
