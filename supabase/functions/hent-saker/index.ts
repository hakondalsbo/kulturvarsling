import { kallClaude } from "../_shared/claude.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import {
  erKulturRelevant,
  erKulturSak,
  finnHøringsfrist,
  statusFraFrist,
  stortingsSesjoner,
} from "./logikk.ts";
import { hentEInnsynKultursaker } from "./einnsyn.ts";
import { hentBergenSaker } from "./bergen.ts";
import { hentKulturdirektoratetTildelinger } from "./kulturdirektoratet.ts";
import { hentSametingetSaker } from "./sametinget.ts";
import { hentRegjeringenRSS } from "./regjeringen.ts";
import {
  feilFraStatus,
  feilFraUnntak,
  feilUtfall,
  klassifiserKjøring,
  lesTekstRespons,
  okUtfall,
  slåSammenAdapterdeler,
  tidligAvslag,
  utledKjoertAv,
  uventetFormat,
  type AdapterDel,
  type AdapterUtfall,
  type KjoertAv,
} from "./kildehelse.ts";

// ─── Stortinget: kultursaker med høringsfrister ───────────────────────────────
// KILDEKART-funn (verifisert juli 2026): det gamle endepunktet
// eksport/horingsoversikt finnes ikke (404), og eksport/horinger er nede (500).
// Strategi nå: hent ALLE saker for sesjonen (serverens komité-filter ignoreres
// uansett), filtrer klientside med erKulturSak, og slå opp eksport/sak per NY
// kultursak for å finne HOERFRIST (høringsfrist). Detaljoppslag gjøres kun for
// saker vi ikke har fra før, så antall kall er lite etter første kjøring.
//
// Begge sesjonene (gjeldende + forrige, Europe/Oslo) blir ETT utfall.
// Feiler én, fortsetter den andre, og kjøringen klassifiseres som delvis.
async function hentEnStortingssesjon(
  sesjon: string,
  eksKilder: Set<string>,
): Promise<AdapterDel> {
  const url =
    `https://data.stortinget.no/eksport/saker?sesjonid=${sesjon}&format=json`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const lest = await lesTekstRespons(res, url);
    if ("feil" in lest) {
      console.error(`Stortinget saker ${sesjon}: ${lest.feil.melding}`, url);
      return { items: [], raattAntall: 0, antallEtterFilter: 0, feil: lest.feil };
    }
    let data: any;
    try {
      data = JSON.parse(lest.tekst);
    } catch (e) {
      const feil = feilFraUnntak(e, url);
      console.error(`Stortinget saker parse ${sesjon}:`, e);
      return { items: [], raattAntall: 0, antallEtterFilter: 0, feil };
    }
    if (!Array.isArray(data?.saker_liste)) {
      const feil = uventetFormat(url, "mangler saker_liste");
      console.error(`Stortinget saker ${sesjon}: ${feil.melding}`, url);
      return { items: [], raattAntall: 0, antallEtterFilter: 0, feil };
    }
    const alleSaker: any[] = data.saker_liste;
    const kultursaker = alleSaker.filter(erKulturSak);
    console.log(
      `Stortinget (${sesjon}): ${alleSaker.length} saker totalt, ${kultursaker.length} kulturrelevante`,
    );

    const vurderes = kultursaker.filter((sak) => sak.tittel ?? sak.korttittel ?? "");
    const items: any[] = [];
    for (const sak of vurderes) {
      const tittel = sak.tittel ?? sak.korttittel ?? "";
      const kilde =
        `https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=${sak.id}`;
      if (eksKilder.has(kilde)) continue; // detaljoppslag kun for nye saker

      let frist: string | null = null;
      const detUrl =
        `https://data.stortinget.no/eksport/sak?sakid=${sak.id}&format=json`;
      try {
        const detRes = await fetch(detUrl, { headers: { Accept: "application/json" } });
        if (!detRes.ok) {
          const feil = feilFraStatus(detRes.status, detUrl);
          console.error(`Detaljoppslag for sak ${sak.id} feilet: ${feil.melding}`, detUrl);
          return {
            items,
            raattAntall: alleSaker.length,
            antallEtterFilter: vurderes.length,
            feil,
          };
        }
        frist = finnHøringsfrist(await detRes.json());
      } catch (e) {
        console.error(`Detaljoppslag for sak ${sak.id} feilet:`, e);
        return {
          items,
          raattAntall: alleSaker.length,
          antallEtterFilter: vurderes.length,
          feil: feilFraUnntak(e, detUrl),
        };
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
    return {
      items,
      raattAntall: alleSaker.length,
      antallEtterFilter: vurderes.length,
      feil: null,
    };
  } catch (e) {
    console.error("Stortinget saker feil:", e);
    return { items: [], raattAntall: 0, antallEtterFilter: 0, feil: feilFraUnntak(e, url) };
  }
}

async function hentStortingetSaker(eksKilder: Set<string>): Promise<AdapterUtfall> {
  const deler: AdapterDel[] = [];
  for (const sesjon of stortingsSesjoner()) {
    deler.push(await hentEnStortingssesjon(sesjon, eksKilder));
  }
  return slåSammenAdapterdeler(deler);
}

// ─── Stortinget: ventede saker (tidligvarsling) ───────────────────────────────
// Regjeringens VARSLEDE kommende proposisjoner/meldinger — lar oss varsle
// kulturfeltet FØR sakene fremmes for Stortinget. (Verifisert i kildekartet.)
async function hentVentedeSaker(): Promise<AdapterUtfall> {
  const url = "https://data.stortinget.no/eksport/ventedesaker?format=json";
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const lest = await lesTekstRespons(res, url);
    if ("feil" in lest) {
      console.error(`Ventede saker: ${lest.feil.melding}`, url);
      return feilUtfall(lest.feil);
    }
    let data: any;
    try {
      data = JSON.parse(lest.tekst);
    } catch (e) {
      const feil = feilFraUnntak(e, url);
      console.error("Ventede saker parse:", e);
      return feilUtfall(feil);
    }
    if (!Array.isArray(data?.saker_liste)) {
      const feil = uventetFormat(url, "mangler saker_liste");
      console.error(`Ventede saker: ${feil.melding}`, url);
      return feilUtfall(feil);
    }
    const saker: any[] = data.saker_liste;
    const items: any[] = [];

    for (const sak of saker) {
      const departement: string = sak.departement ?? "";
      const tittel: string = sak.tittel ?? "";
      if (!tittel) continue;
      if (!/kultur/i.test(departement) && !erKulturRelevant(tittel)) continue;
      items.push({
        tittel: `Varslet sak: ${tittel}`,
        instans: departement || "Regjeringen",
        kilde: `https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/ventede-saker/#sak-${sak.id}`,
        frist: null,
        sammendrag_raa: `${sak.type ?? "Sak"} varslet fremmet i ${sak["måned"] ?? "kommende sesjon"}. ` + "Tidligvarsling: saken er ennå ikke fremmet for Stortinget.",
        kilde_id: `stortinget-ventet-${sak.id}`,
        forhåndsgodkjent: true,
      });
    }
    console.log(
      `Ventede saker: ${saker.length} totalt, ${items.length} kulturrelevante`,
    );
    return okUtfall(items, saker.length, items.length);
  } catch (e) {
    console.error("Ventede saker feil:", e);
    return feilUtfall(feilFraUnntak(e, url));
  }
}

// ─── Claude API: kategoriser og sammendrag ────────────────────────────────────
// Siste feilårsak eksponeres i responsen (siste_analyse_feil) for feilsøking.
let sisteAnalyseFeil: string | null = null;

async function analyserMedClaude(
  item: any,
  apiKey: string,
): Promise<any | null> {
  try {
    const res = await kallClaude({
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
    }, "hent-saker");

    if (!res.ok) {
      const kropp = await res.text().catch(() => "");
      sisteAnalyseFeil = `HTTP ${res.status}: ${kropp.slice(0, 200)}`;
      console.error("Claude API:", sisteAnalyseFeil);
      return null;
    }
    const data = await res.json();
    // Robust mot thinking-blokker (Claude 5): finn tekstblokken eksplisitt.
    const tekst = (data.content?.find((b: any) => b.type === "text")?.text ?? "{}")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    return JSON.parse(tekst);
  } catch (e) {
    sisteAnalyseFeil = `unntak: ${String(e).slice(0, 200)}`;
    console.error("Claude feil:", sisteAnalyseFeil);
    return null;
  }
}

// ─── Claude-helsesjekk ────────────────────────────────────────────────────────
// Ett mikro-kall ved oppstart så responsen alltid viser OM og HVORFOR
// AI-laget eventuelt er nede — aldri mer stille Claude-svikt.
async function testClaude(apiKey: string | undefined): Promise<string> {
  if (!apiKey) return "mangler ANTHROPIC_API_KEY";
  try {
    const res = await kallClaude({
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
    }, "hent-saker");
    if (res.ok) return "ok";
    const kropp = await res.text().catch(() => "");
    return `HTTP ${res.status}: ${kropp.slice(0, 200)}`;
  } catch (e) {
    return `nettverksfeil: ${String(e).slice(0, 150)}`;
  }
}

// Prod-jobben `hent-saker-daglig` poster { "utlost_av": "pg_cron" }.
async function lesKjoertAv(req: Request): Promise<KjoertAv> {
  let utlostAv: unknown;
  try {
    const tekst = await req.text();
    if (tekst.trim()) utlostAv = JSON.parse(tekst)?.utlost_av;
  } catch {
    utlostAv = undefined;
  }
  return utledKjoertAv({
    utlostAv,
    headerUtlostAv: req.headers.get("x-utlost-av"),
    vercelCronHeader: req.headers.get("x-vercel-cron"),
  });
}

async function kjørAdapter(
  navn: string,
  fn: () => Promise<AdapterUtfall>,
): Promise<{ navn: string; utfall: AdapterUtfall; varighetMs: number }> {
  const t = Date.now();
  try {
    const utfall = await fn();
    return { navn, utfall, varighetMs: Date.now() - t };
  } catch (e) {
    console.error(`${navn} krasjet utenfor adapteren:`, e);
    return {
      navn,
      utfall: feilUtfall(feilFraUnntak(e)),
      varighetMs: Date.now() - t,
    };
  }
}

function jsonSvar(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Hoved-handler ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Plattformens JWT-kontroll beholdes. Separat cron-hemmelighet gir tilgang til jobben.
  const tidlig = tidligAvslag(
    req.method,
    Deno.env.get("HENT_SAKER_CRON_SECRET"),
    req.headers.get("x-cron-secret"),
  );
  if (tidlig) {
    if (tidlig.status === 503) {
      console.error("Kritisk konfigurasjonsfeil: HENT_SAKER_CRON_SECRET mangler");
    }
    if (tidlig.kind === "tekst") return new Response(tidlig.body, { status: tidlig.status });
    return jsonSvar(tidlig.body, tidlig.status);
  }

  try {
    const kjoertAv = await lesKjoertAv(req);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

    // Hent eksisterende kilder for deduplicering. Feil her avbryter før innhenting.
    const { data: eks, error: eksFeil } = await supabase.from("varsler").select("kilde");
    if (eksFeil) {
      return jsonSvar({ feil: "Eksisterende saker kunne ikke hentes. Ingen innhenting startet." }, 503);
    }
    const eksKilder = new Set((eks ?? []).map((v: any) => v.kilde));

    // Kilderegisteret: kobler kjøringslogg til kilde (ARKITEKTUR §1.4)
    const { data: kilderRows, error: registerFeil } = await supabase
      .from("kilder")
      .select("id, adapter")
      .eq("aktiv", true);
    if (registerFeil) {
      return jsonSvar({ feil: "Kilderegisteret kunne ikke hentes. Ingen innhenting startet." }, 503);
    }
    const claudeStatus = await testClaude(anthropicKey);
    if (claudeStatus !== "ok") console.error("Claude-helsesjekk:", claudeStatus);
    const kilderMap = new Map<string, string>(
      (kilderRows ?? []).map((r: any) => [r.adapter, r.id]),
    );

    // Hent fra alle kilder parallelt. Én adapter som kaster, stopper ikke de andre.
    const kjøringer = await Promise.all([
      kjørAdapter("stortinget-saker", () => hentStortingetSaker(eksKilder)),
      kjørAdapter("regjeringen-rss", () => hentRegjeringenRSS()),
      kjørAdapter("stortinget-ventede", () => hentVentedeSaker()),
      kjørAdapter("einnsyn", () => hentEInnsynKultursaker()),
      kjørAdapter("bergen", () => hentBergenSaker()),
      kjørAdapter("kulturdirektoratet", () => hentKulturdirektoratetTildelinger()),
      kjørAdapter("sametinget", () => hentSametingetSaker()),
    ]);

    const alle = kjøringer.flatMap((k) =>
      k.utfall.items.map((i) => ({ ...i, adapter: k.navn }))
    );

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
    const driftFeil: string[] = [];

    // Kostnads- OG ressurstak: maks antall saker som AI-vurderes per kjøring.
    // Overskytende utsettes til neste kjøring (dedup slår ikke inn — de er ikke
    // lagret). 25 holder kjøringen på ~1 min — trygt under Supabase-workerens
    // regnekvote (80 ga WORKER_RESOURCE_LIMIT/546) og under Claude API-ets
    // rate-grense for nye kontoer (50 kall/min).
    // kallClaude har allerede ett kontrollert nytt forsøk. Ikke legg på et til.
    const MAKS_CLAUDE_SAKER = 25;
    let claudeSaker = 0;
    let antallAvvist = 0;

    for (const item of nye) {
      let kategori = "scenekunst";
      let niva = item.niva ?? "nasjonalt";
      let status = statusFraFrist(item.frist);
      let sammendrag = item.sammendrag_raa?.slice(0, 400) || item.tittel;

      // Bruk Claude for bedre analyse hvis API-nøkkel er satt
      if (anthropicKey) {
        if (claudeSaker >= MAKS_CLAUDE_SAKER) {
          driftFeil.push(`${item.tittel.slice(0, 60)}: utsatt (kostnadstak per kjøring)`);
          continue;
        }
        claudeSaker++;
        const analyse = await analyserMedClaude(item, anthropicKey);
        if (!analyse) {
          // Claude utilgjengelig (rate-limit e.l.): IKKE lagre ufiltrert.
          // Saken er ikke i varsler ennå, så dedup stopper den ikke — den
          // blir vurdert på nytt ved neste kjøring i stedet.
          driftFeil.push(`${item.tittel.slice(0, 60)}: Claude-analyse utilgjengelig, utsatt`);
          continue;
        }
        if (!analyse.relevant) {
          // Husk avvisningen: lagres som UPUBLISERT rad (appen viser kun
          // publisert=true), så samme sak aldri koster en ny AI-vurdering —
          // dedup via kilde-URL stopper den ved neste kjøring.
          const { error: avvistFeil } = await supabase.from("varsler").insert({
            tittel: item.tittel,
            sammendrag: "Automatisk avvist av relevansfilteret",
            instans: item.instans,
            kilde: item.kilde,
            frist: item.frist ?? null,
            kategori: analyse.kategori ?? "kulturpolitikk",
            niva: analyse.niva ?? "nasjonalt",
            sted: "Norge",
            status: "normal",
            publisert: false,
          });
          if (!avvistFeil) {
            antallAvvist++;
            eksKilder.add(item.kilde);
          }
          continue;
        }
        kategori = analyse.kategori ?? kategori;
        // Adaptere som VET nivået sitt (f.eks. Bergen = kommune) overstyres ikke
        if (!item.niva) niva = analyse.niva ?? niva;
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
        sted: item.sted ?? (niva === "nasjonalt" ? "Nasjonalt" : "Norge"),
        status,
        publisert: true,
        sakstype: item.sakstype ?? null,
        kommunenr: item.kommunenr ?? null,
        fylkesnr: item.fylkesnr ?? null,
      });

      if (error) {
        driftFeil.push(`${item.tittel}: ${error.message}`);
      } else {
        antallLagret++;
        lagretPerAdapter.set(
          item.adapter,
          (lagretPerAdapter.get(item.adapter) ?? 0) + 1,
        );
        eksKilder.add(item.kilde); // unngå dobbel innsetting i samme kjøring
      }
    }

    // Kjøringslogg per kilde. antall_funnet = råtreff før filter/dedup.
    // «tom» bare når kilden svarte OK med 0 råtreff. Feil blir aldri «tom».
    // feilmelding er saniteret: kilde_kjoringer er offentlig lesbar.
    const kildeStatus = [];
    const kildeFeil: string[] = [];
    for (const k of kjøringer) {
      const antallNye = lagretPerAdapter.get(k.navn) ?? 0;
      const klass = klassifiserKjøring({
        raattAntall: k.utfall.raattAntall,
        antallNye,
        feil: k.utfall.feil,
        forsok: k.utfall.forsok,
        vellykket: k.utfall.vellykket,
      });
      kildeStatus.push({
        adapter: k.navn,
        status: klass.status,
        raatt_antall: k.utfall.raattAntall,
        antall_etter_filter: k.utfall.antallEtterFilter,
        antall_nye: antallNye,
        http_status: klass.httpStatus,
        feilmelding: klass.feilmelding,
        varighet_ms: k.varighetMs,
      });
      if (
        (klass.status.startsWith("feil_") || klass.status === "delvis") &&
        klass.feilmelding
      ) {
        kildeFeil.push(`${k.navn}: ${klass.feilmelding}`);
      }
      const kildeId = kilderMap.get(k.navn);
      if (!kildeId) {
        console.error(`Ingen rad i kilder for adapter ${k.navn} — kjøring logges ikke`);
        continue;
      }
      const { error: loggFeil } = await supabase.from("kilde_kjoringer").insert({
        kilde_id: kildeId,
        status: klass.status,
        antall_funnet: k.utfall.raattAntall,
        antall_etter_filter: k.utfall.antallEtterFilter,
        antall_nye: antallNye,
        feilmelding: klass.feilmelding,
        http_status: klass.httpStatus,
        varighet_ms: k.varighetMs,
        kjoert_av: kjoertAv,
      });
      if (loggFeil) console.error(`kilde_kjoringer ${k.navn}:`, loggFeil.message);
      await supabase
        .from("kilder")
        .update({ sist_hentet: new Date().toISOString(), sist_status: klass.status })
        .eq("id", kildeId);
    }

    const feil = [...kildeFeil, ...driftFeil];
    const respons = {
      kjørt: new Date().toISOString(),
      kjoert_av: kjoertAv,
      claude_status: claudeStatus,
      siste_analyse_feil: sisteAnalyseFeil ?? undefined,
      hentet_totalt: alle.length,
      nye_og_relevante: nye.length,
      lagret: antallLagret,
      avvist_av_filter: antallAvvist,
      feil: feil.length > 0 ? feil.slice(0, 10) : undefined,
      kilde_status: kildeStatus,
    };

    console.log("Ferdig:", respons);
    return jsonSvar(respons);
  } catch (e) {
    console.error("Kritisk feil:", e);
    return jsonSvar({ feil: String(e) }, 500);
  }
});
