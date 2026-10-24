import { useState, useMemo, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { ForsideAvis, VarselArkiv, KildeSetning, KildeDetaljer, datoMeta, Rollemerke } from "./avis.tsx";
import { vurderSak } from "./handling.ts";
import { DesignSide } from "./design.tsx";
import { MerketTekst, OrdlisteSide } from "./ord.tsx";
import { delOppDokument } from "./innhold/treff.ts";
import { UNDERTEKST } from "./tekster.ts";
import { behandlingsansvarlig, orgnr, poststed } from "./selskap.ts";
import { Knapp, Felt, Tekstfelt, Velger, Dialog } from "./ui.tsx";
import { kommuneLoginSynlig } from "./kommunelogin.ts";
import { PREMIUM_AAR_KR, PREMIUM_MAANED_KR, sparProsentArlig } from "./priser.ts";
import { dagerTilFrist, fristEtikett } from "./frist.ts";
import { geografiskFraNivaa, leggTilUtvalg, nivaaFraGeografisk, preferanserFraProfil, utvalgErDekket } from "./preferanser.ts";

// ─── Supabase klient ──────────────────────────────────────────────────────
// Bytt ut disse to verdiene med dine egne fra Supabase, Settings, API
const SUPABASE_URL  = "https://zyyijlvmgoanjdzngmon.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5eWlqbHZtZ29hbmpkem5nbW9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNDI1NzMsImV4cCI6MjA4ODkxODU3M30.k2WWIg_7STiIOPSGojZ2zH_QCShvvSw8Ax0hk1yGjOI";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
const PERSONVERN_VERSJON = "personvern-2026-10";

// ─── Hjelpefunksjoner ─────────────────────────────────────────────────────
async function lastVarsler() {
  const { data, error } = await sb.from("varsler")
    .select("*")
    .eq("publisert", true)
    .order("frist", { ascending: true });
  if (error) { console.error("Varsler-feil:", error); return null; }
  return data.map(v => ({
    ...v,
    nivå: v.niva,  // map db snake_case to app camelCase
    dager: dagerTilFrist(v.frist)
  }));
}

async function lastKampanjer() {
  const { data, error } = await sb.from("kampanje_med_signaturer")
    .select("*")
    .eq("aktiv", true);
  if (error) { console.error("Kampanje-feil:", error); return null; }
  return data.map(k => ({
    ...k,
    sig: k.signaturer ?? 0,
    mal: k.mal,
    sakId: k.sak_id,
    tags: k.tags ?? []
  }));
}

async function hentProfil(userId) {
  const { data } = await sb.from("profiler").select("*").eq("id", userId).single();
  return data;
}

function profilfelt(oppdateringer) {
  const felt = { ...oppdateringer };
  // id ligger i WHERE. plan og stripe_customer_id settes bare av service_role.
  delete felt.id;
  delete felt.plan;
  delete felt.stripe_customer_id;
  return felt;
}

async function lagreProfil(userId, oppdateringer) {
  const { error } = await sb.from("profiler")
    .update({ ...profilfelt(oppdateringer), oppdatert: new Date().toISOString() })
    .eq("id", userId);
  return !error;
}

// handle_new_user oppretter raden ved registrering. Klienten oppdaterer den.
async function upsertProfil(userId, data) {
  return lagreProfil(userId, data);
}

async function toggleFølgSak(brukerId, sakId, følger) {
  if (følger) {
    const { error } = await sb.from("fulgte_saker").delete()
      .eq("bruker_id", brukerId).eq("sak_id", sakId);
    return !error;
  }
  const { error } = await sb.from("fulgte_saker").upsert(
    { bruker_id: brukerId, sak_id: sakId },
    { onConflict: "bruker_id,sak_id", ignoreDuplicates: true },
  );
  return !error;
}

async function hentFulgte(brukerId) {
  const { data, error } = await sb.from("fulgte_saker")
    .select("sak_id").eq("bruker_id", brukerId);
  if (error) return { ids: [], feil: true };
  return { ids: (data ?? []).map(r => r.sak_id), feil: false };
}

function brukerFraSesjon(authUser: any, profil: any) {
  const pref = preferanserFraProfil(profil);
  const epost = authUser?.email || profil?.epost || "";
  if (pref.varslerAktive && !pref.varselEpost) pref.varselEpost = epost;
  return {
    id: authUser.id,
    navn: profil?.navn || epost.split("@")[0] || "",
    epost,
    org: profil?.org || "",
    orgType: profil?.org_type || "",
    plan: profil?.plan || "gratis",
    onboardingDone: profil?.onboarding_done ?? false,
    fylkesnr: profil?.fylkesnr || null,
    kommunenr: profil?.kommunenr || null,
    ...pref,
  };
}

const ORG_TYPER = ["organisasjon", "kunstner", "institusjon", "annet"];
function orgTypeEllerNull(verdi: any) {
  return ORG_TYPER.includes(verdi) ? verdi : null;
}

async function lastKilder() {
  const { data } = await sb.from("kilder")
    .select("navn,niva,organ,adapter,aktiv,sist_hentet,sist_status")
    .eq("aktiv", true);
  return data ?? [];
}

// ─── Gratis demokrati vs. premium fagverktøy ──────────────────────────────
// GRUNNPRINSIPP (docs/VEIKART.md): Demokratisk informasjon er ALLTID gratis.
// Å vite hva som skjer, følge saker, delta, mobilisere, filtrere til sitt eget
// fylke/kommune OG forstå en sak i klartekst — koster ingenting. Premium (plan
// styrt av Stripe-webhooken, aldri av frontend) er FAGVERKTØY som gjør en jobb
// for deg: budsjettolkning/KOSTRA-sammenligning, AI-utkast til høringssvar,
// historiske trender/eksport, organisasjonsverktøy. Se isFagverktøy-gating der.
//
// Klartekst («hva betyr dette for meg?») er forståelse av en offentlig sak =
// GRATIS for alle innloggede. Innlogging kreves kun for å hindre anonymt
// misbruk av et betalt-per-kall AI-endepunkt — selve registreringen er gratis.
export function kanBrukeKlartekst(user){
  return !!user?.id;
}
// Beholdt for bakoverkompatibilitet med E2-koden; klartekst har ingen kvote nå.
export function registrerKlartekstBruk(_user){ /* gratis — ingen teller */ }

async function loggAktivitetDB(brukerId, entry) {
  await sb.from("aktivitet").insert({
    bruker_id: brukerId,
    type: entry.type,
    tittel: entry.tittel,
    sak_id: entry.sakId ?? null,
    mottaker: entry.mottaker ?? null,
  });
}

async function hentAktivitet(brukerId) {
  const { data } = await sb.from("aktivitet")
    .select("*").eq("bruker_id", brukerId)
    .order("opprettet", { ascending: false }).limit(50);
  return data ?? [];
}

async function signKampanje(kampanjeId, brukerId, navn, epost) {
  const { error } = await sb.from("kampanje_signaturer").insert({
    kampanje_id: kampanjeId,
    bruker_id: brukerId ?? null,
    navn,
    epost
  });
  return !error;
}

async function sendFeedbackDB(brukerId, type, tekst, sakTittel) {
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token ?? null;
  const innlogget = data?.session?.user?.id ?? null;
  // Kolonnene er public.feedback: bruker_id, type, tekst, sak_tittel.
  // id, status ('ny') og opprettet har default. type må være en av
  // feil | mangler | utdatert | forslag | annet.
  // Prefer return=minimal: return=representation krever SELECT-policy, og den
  // finnes ikke. Da svarer API-et 42501 og raden lagres ikke.
  const bruker_id = token && innlogget ? innlogget : null;
  if (brukerId && bruker_id && brukerId !== bruker_id) {
    console.error("Feedback: bruker_id fra kalleren matchet ikke sesjonen, bruker sesjonen");
  }
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${token ?? SUPABASE_ANON}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        bruker_id,
        type,
        tekst,
        sak_tittel: sakTittel ?? null,
      }),
    });
  } catch (e) {
    return { message: "Kunne ikke nå serveren. Prøv igjen." };
  }
  if (res.ok) return null;
  let message = `Kunne ikke lagre tilbakemeldingen (HTTP ${res.status}).`;
  try {
    const body = await res.json();
    if (typeof body?.message === "string" && body.message.trim()) message = body.message;
  } catch { /* tom feilkropp */ }
  return { message };
}

// ─── Static data ────────────────────────────────────────────────────────────
const KATEGORIER = [
  {id:"scenekunst",label:"Scenekunst"},
  {id:"musikk",label:"Musikk"},
  {id:"dans",label:"Dans"},
  {id:"opera",label:"Opera"},
  {id:"litteratur",label:"Litteratur"},
  {id:"film",label:"Film og TV"},
  {id:"visuell",label:"Visuell kunst"},
  {id:"museer",label:"Museer"},
  {id:"spill",label:"Spill"},
  {id:"kulturarv",label:"Kulturarv og bygg"},
];

const FYLKER = [
  {nr:"03",navn:"Oslo"},{nr:"11",navn:"Rogaland"},{nr:"15",navn:"Møre og Romsdal"},
  {nr:"18",navn:"Nordland"},{nr:"31",navn:"Østfold"},{nr:"32",navn:"Akershus"},
  {nr:"33",navn:"Buskerud"},{nr:"34",navn:"Innlandet"},{nr:"39",navn:"Vestfold"},
  {nr:"40",navn:"Telemark"},{nr:"42",navn:"Agder"},{nr:"46",navn:"Vestland"},
  {nr:"50",navn:"Trøndelag"},{nr:"55",navn:"Troms"},{nr:"56",navn:"Finnmark"},
];
const fylkesnavn = (nr) => FYLKER.find(f=>f.nr===String(nr))?.navn ?? null;

const VARSLER = [];
const KAMPANJER = [];
const SAK_HISTORIKK: any[] = [];
const AKTIVITET_INIT = [];
const KOM_HØRINGER_INIT: any[] = [];
const KOM_SVAR_MOCK: any[] = [];

const NIVÅ_VALG = [
  {id:"nasjonalt",label:"Nasjonalt"},
  {id:"fylke",label:"Fylke"},
  {id:"kommune",label:"Kommune"},
];
const FREKVENS_VALG = [
  {id:"straks",label:"Straks",tekst:"Bare saker med under 7 dager til frist og status kritisk."},
  {id:"daglig",label:"Daglig",tekst:"Én e-post per dag med nye saker."},
  {id:"ukentlig",label:"Ukentlig",tekst:"Én e-post per uke med saker fra de siste 7 dagene."},
];
const ORG_TYPE_VALG = [
  {id:"organisasjon",label:"Organisasjon"},
  {id:"kunstner",label:"Frilanser eller kunstner"},
  {id:"institusjon",label:"Institusjon"},
  {id:"annet",label:"Annet"},
];
const TYPE_NAVN: Record<string,string> = {
  horingssvar:"Høringssvar",
  horing:"Høringssvar",
  kontakt:"Kontakt",
  politiker:"Politiker",
  signatur:"Signatur",
  kampanje:"Kampanje",
  pressemelding:"Pressemelding",
  komite:"Komité",
};
const UTFALL_NAVN: Record<string,string> = {
  seier:"Seier",
  tap:"Vedtatt mot vår vilje",
  pågår:"Avsluttet, utfall er ikke registrert",
};

function katNavn(id?: string) {
  return KATEGORIER.find(k=>k.id===id)?.label || "";
}
function nivaaNavn(nivå?: string, sted?: string) {
  if(nivå==="nasjonalt") return "Nasjonalt";
  if(nivå==="fylke") return sted ? `Fylke, ${sted}` : "Fylke";
  if(nivå==="kommune") return sted ? `Kommune, ${sted}` : "Kommune";
  return sted || "";
}
function orgTypeNavn(id?: string) {
  return ORG_TYPE_VALG.find(o=>o.id===id)?.label || id || "";
}
function metaLinje(deler: Array<string | false | null | undefined>) {
  return deler.filter(Boolean).join(" · ");
}

function Faner({faner,valgt,onVelg}:{faner:{id:string;label:string}[];valgt:string;onVelg:(id:string)=>void}) {
  return (
    <div className="kv-faner" role="tablist">
      {faner.map(f=>(
        <button type="button" role="tab" key={f.id} aria-selected={valgt===f.id} onClick={()=>onVelg(f.id)}>{f.label}</button>
      ))}
    </div>
  );
}
function Flervalg({valg,valgt,onToggle}:{valg:{id:string;label:string}[];valgt:string[];onToggle:(id:string)=>void}) {
  return (
    <div className="kv-valg">
      {valg.map(v=>(
        <button type="button" key={v.id} aria-pressed={valgt.includes(v.id)} onClick={()=>onToggle(v.id)}>{v.label}</button>
      ))}
    </div>
  );
}
function Enkeltvalg({valg,valgt,onVelg}:{valg:{id:string;label:string}[];valgt:string;onVelg:(id:string)=>void}) {
  return (
    <div className="kv-valg">
      {valg.map(v=>(
        <button type="button" key={v.id} aria-pressed={valgt===v.id} onClick={()=>onVelg(v.id)}>{v.label}</button>
      ))}
    </div>
  );
}

let _showToast: (msg:string,type?:"ok"|"feil"|"info")=>void = ()=>{};
export function showToast(msg:string, type:"ok"|"feil"|"info"="ok") { _showToast(msg,type); }

function ToastContainer() {
  const [toasts,setToasts]=useState<{id:number;msg:string;type:string}[]>([]);
  _showToast = (msg,type="ok")=>{
    const id=Date.now();
    setToasts(t=>[...t,{id,msg,type}]);
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),3200);
  };
  if(!toasts.length) return null;
  const siste = toasts[toasts.length-1];
  return (
    <div className={siste.type==="feil"?"kv-toast feil":"kv-toast"} role="status">
      {toasts.map(t=>t.msg).join(" ")}
    </div>
  );
}

function KildeTillitsstrip({onÅpne}) {
  const [kilder,setKilder]=useState<any[]|null>(null);
  useEffect(()=>{ lastKilder().then(setKilder).catch(()=>setKilder([])); },[]);
  return <KildeSetning kilder={kilder} onÅpne={onÅpne}/>;
}

function KildeHelseSide({onBack}) {
  const [kilder,setKilder]=useState<any[]>([]);
  const [lastet,setLastet]=useState(false);
  useEffect(()=>{ lastKilder().then(k=>{setKilder(k);setLastet(true);}).catch(()=>{setKilder([]);setLastet(true);}); },[]);
  return (
    <div className="avis-wrap">
      <button type="button" className="avis-tilbake" onClick={onBack}>Tilbake</button>
      <KildeDetaljer kilder={kilder} lastet={lastet}/>
    </div>
  );
}

function Landing({setScreen,varsler=[],kampanjer=[]}) {
  const [valgt,setValgt]=useState<any>(null);
  const [fane,setFane]=useState("info");
  const [lokaleFulgte,setLokaleFulgte]=useState<any[]>([]);
  return (
    <div className="avis">
      <div className="avis-dato">
        <div className="avis-wrap avis-dato-rad">
          <div className="avis-dato-venstre">
            <span className="avis-dato-meta">{datoMeta(varsler.length)}</span>
          </div>
          <div className="avis-dato-hoyre">
            {kommuneLoginSynlig && <button type="button" onClick={()=>setScreen("kommune-login")}>For kommuner</button>}
            <button type="button" onClick={()=>setScreen("bruker-login")}>Logg inn</button>
          </div>
        </div>
      </div>
      <header className="avis-mast">
        <button type="button" className="avis-tittel">Kultur<span>varsling</span></button>
        <p className="avis-under">{UNDERTEKST}</p>
      </header>
      <ForsideAvis
        saker={varsler}
        lastet
        fulgte={lokaleFulgte}
        onToggleFølg={(id)=>setLokaleFulgte((f)=>f.includes(id)?f.filter((x)=>x!==id):[...f,id])}
        onÅpne={(sak, tab)=>{setFane(tab);setValgt(sak);}}
        onAlle={()=>setScreen("bruker-app")}
        kampanjeAntall={kampanjer.length}
        onKampanjer={()=>setScreen("bruker-login")}
      />
      <footer className="avis-fot">
        <div className="avis-wrap avis-fot-rad">
          <span>Kulturvarsling</span>
          <span>
            <button type="button" onClick={()=>setScreen("bruker-login")}>Logg inn</button>
          </span>
        </div>
      </footer>
      {valgt&&<SaksModal sak={valgt} startTab={fane} onClose={()=>setValgt(null)} kampanjer={kampanjer}/>}
    </div>
  );
}

function OnboardingWizard({user,setUser,onDone}) {
  const [steg,setSteg]=useState(0);
  const [org,setOrg]=useState(user?.org||"");
  const [orgType,setOrgType]=useState(user?.orgType||"");
  const [valgtKat,setValgtKat]=useState<string[]>(user?.fagfelt||user?.varselKat||[]);
  const [valgtNivå,setValgtNivå]=useState<string[]>(user?.varselNivå||["nasjonalt","fylke","kommune"]);
  const [frekvens,setFrekvens]=useState(user?.varselFrekvens||"daglig");
  const [lagrer,setLagrer]=useState(false);
  const [samtykke,setSamtykke]=useState(false);

  const stegListe=[
    {tittel:"Hvem er du?",sub:"Navn og type aktør."},
    {tittel:"Hva følger du med på?",sub:"Velg fagområder først, deretter geografisk nivå."},
    {tittel:"Varsler",sub:"Hvor ofte skal varslene samles?"},
    {tittel:"Personvern og samtykke",sub:"Les gjennom og bekreft."},
  ];

  async function fullfør() {
    if (!samtykke) return;
    const geografisk = geografiskFraNivaa(valgtNivå, user?.geografisk||[]);
    const naa = new Date().toISOString();
    const forrige = user;
    const neste = {
      org, orgType, fagfelt: valgtKat, geografisk,
      varslerAktive: true, varselKat: valgtKat, varselNivå: valgtNivå,
      varselFrekvens: frekvens, varselEpost: user?.epost||"", onboardingDone: true,
    };
    setUser(u=>({...u,...neste}));
    if(user?.id) {
      setLagrer(true);
      const ok = await upsertProfil(user.id, {
        org, org_type: orgTypeEllerNull(orgType), fagfelt: valgtKat, geografisk,
        varsler_aktive: true, varsel_frekvens: frekvens, onboarding_done: true,
        personvern_akseptert_at: naa,
        personvern_versjon: PERSONVERN_VERSJON,
      });
      setLagrer(false);
      if(!ok) {
        setUser(forrige);
        showToast("Kunne ikke lagre valgene. Prøv igjen.","feil");
        return;
      }
    }
    onDone();
  }

  return (
    <div className="kv-dialog-bak">
      <div className="kv-dialog smal" role="dialog" aria-modal="true" aria-label={stegListe[steg].tittel}>
        <div className="kv-dialog-hode">
          <p className="kv-steg">Steg {steg+1} av {stegListe.length}</p>
          <h2 className="kv-undertittel">{stegListe[steg].tittel}</h2>
          <p className="kv-ingress">{stegListe[steg].sub}</p>
        </div>
        <div className="kv-dialog-kropp">
          {steg===0&&(
            <div>
              <Felt id="onb-org" label="Navn eller organisasjon" value={org} onChange={e=>setOrg(e.target.value)} placeholder="Eksempel: Norsk Musikerforbund" />
              <p className="kv-feltnavn">Type aktør</p>
              <Enkeltvalg valg={ORG_TYPE_VALG} valgt={orgType} onVelg={setOrgType} />
            </div>
          )}
          {steg===1&&(
            <div className="kv-stakk">
              <div>
                <p className="kv-feltnavn">Fagområde</p>
                <Flervalg valg={KATEGORIER} valgt={valgtKat} onToggle={(id)=>setValgtKat(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])} />
                <p className="kv-meta">Tomt utvalg betyr alle fagområder.</p>
              </div>
              <div>
                <p className="kv-feltnavn">Geografisk nivå</p>
                <Flervalg valg={NIVÅ_VALG} valgt={valgtNivå} onToggle={(id)=>setValgtNivå(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])} />
              </div>
            </div>
          )}
          {steg===2&&(
            <div>
              <Enkeltvalg valg={FREKVENS_VALG} valgt={frekvens} onVelg={setFrekvens} />
              <p className="kv-meta">{FREKVENS_VALG.find(f=>f.id===frekvens)?.tekst}</p>
            </div>
          )}
          {steg===3&&(
            <div className="kv-stakk">
              <p className="kv-brod">
                Du registrerer deg med <strong>{user?.epost}</strong> som representant for <strong>{org||"organisasjonen din"}</strong>.
                E-postadressen brukes til varsler du har slått på. Opplysningene deles ikke videre til kommersielle formål.
              </p>
              <label className="kv-samtykke">
                <input id="kv-samtykke" type="checkbox" checked={samtykke} onChange={e=>setSamtykke(e.target.checked)} />
                <span>
                  Jeg har lest og akseptert <a className="kv-lenke" href="/personvern" target="_blank" rel="noopener noreferrer">personvernerklæringen</a> og samtykker til at Kulturvarsling kan behandle personopplysningene mine.
                </span>
              </label>
              <p className="kv-meta">Du kan trekke samtykket tilbake og slette kontoen. Spørsmål sendes til personvern@kulturvarsling.no.</p>
            </div>
          )}
          <div className="kv-klynge">
            {steg>0&&<Knapp variant="linje" onClick={()=>setSteg(s=>s-1)}>Tilbake</Knapp>}
            {steg<stegListe.length-1&&(
              <Knapp className="vokse" onClick={()=>setSteg(s=>s+1)}>Neste</Knapp>
            )}
            {steg===stegListe.length-1&&(
              <Knapp className="vokse" onClick={fullfør} disabled={!samtykke||lagrer}>
                {lagrer?"Lagrer":"Fullfør registrering"}
              </Knapp>
            )}
          </div>
          {steg===0&&(
            <Knapp variant="stille" onClick={onDone}>Hopp over og sett opp profil senere</Knapp>
          )}
        </div>
      </div>
    </div>
  );
}

function FeedbackModal({onClose, kontekst=null as any}) {
  const [type,setType]=useState(kontekst?.type||"feil");
  const [tekst,setTekst]=useState("");
  const [sendt,setSendt]=useState(false);
  const [feil,setFeil]=useState("");
  const [laster,setLaster]=useState(false);
  const typer=[
    {id:"feil",label:"Feil i saken"},
    {id:"mangler",label:"Manglende sak"},
    {id:"utdatert",label:"Utdatert info"},
    {id:"forslag",label:"Forslag"},
    {id:"annet",label:"Annet"},
  ];

  async function send(){
    if(!tekst.trim()||laster) return;
    setLaster(true); setFeil("");
    let brukerId=null;
    try {
      const { data } = await sb.auth.getSession();
      brukerId = data?.session?.user?.id ?? null;
    } catch { brukerId = null; }
    const error = await sendFeedbackDB(brukerId, type, tekst.trim(), kontekst?.sakTittel ?? null);
    setLaster(false);
    if(error){
      console.error("Feedback-feil:", error);
      setFeil(error.message
        ? `Kunne ikke lagre tilbakemeldingen: ${error.message}`
        : "Kunne ikke lagre tilbakemeldingen. Prøv igjen.");
      return;
    }
    setSendt(true);
  }

  return (
    <Dialog tittel={sendt?"Tilbakemelding lagret":"Tilbakemelding"} onClose={onClose} smal>
      {sendt?(
        <div className="kv-stakk">
          <p className="kv-brod">Tilbakemeldingen er lagret. Den brukes til å rette saker og forbedre oversikten.</p>
          <Knapp variant="linje" onClick={onClose}>Lukk</Knapp>
        </div>
      ):(
        <div className="kv-stakk">
          {kontekst?.sakTittel&&<p className="kv-meta">Gjelder saken: {kontekst.sakTittel}</p>}
          <div>
            <p className="kv-feltnavn">Type</p>
            <Enkeltvalg valg={typer} valgt={type} onVelg={setType} />
          </div>
          <Tekstfelt
            id="fb-tekst"
            label={type==="feil"?"Hva er feil?":type==="mangler"?"Hvilken sak mangler?":type==="utdatert"?"Hva er utdatert?":type==="forslag"?"Forslaget":"Beskrivelse"}
            value={tekst}
            onChange={e=>setTekst(e.target.value)}
            rows={4}
            placeholder={type==="feil"?"For eksempel feil frist, feil instans eller faktafeil i sammendraget.":type==="mangler"?"Beskriv saken og hvem som behandler den.":type==="forslag"?"Hva bør endres?":""}
          />
          {feil&&<p className="kv-feil" role="alert">{feil}</p>}
          <div className="kv-klynge">
            <Knapp className="vokse" disabled={!tekst.trim()||laster} onClick={send}>{laster?"Sender":"Send tilbakemelding"}</Knapp>
            <Knapp variant="linje" onClick={onClose}>Avbryt</Knapp>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function BrukerLogin({setScreen,setUser,grunn=""}) {
  const [epost,setEpost]=useState("");
  const [pw,setPw]=useState("");
  const [navn,setNavn]=useState("");
  const [mode,setMode]=useState("login");
  const [feil,setFeil]=useState("");
  const [laster,setLaster]=useState(false);
  const [bekreftSendt,setBekreftSendt]=useState(false);
  const [glemtModus,setGlemtModus]=useState(false);

  async function loggInn() {
    setLaster(true); setFeil("");
    const { data, error } = await sb.auth.signInWithPassword({ email:epost, password:pw });
    if(error) { setFeil("Feil e-post eller passord."); setLaster(false); return; }
    const profil = await hentProfil(data.user.id);
    setUser(brukerFraSesjon(data.user, profil));
    setScreen("bruker-app");
    setLaster(false);
  }

  async function registrer() {
    setLaster(true); setFeil("");
    if(!epost||!pw||!navn) { setFeil("Fyll inn alle felt."); setLaster(false); return; }
    const { data, error } = await sb.auth.signUp({
      email: epost, password: pw,
      options: { data: { navn } }
    });
    if(error) { setFeil(error.message); setLaster(false); return; }
    if(data?.user?.identities?.length === 0) {
      setFeil("E-post allerede registrert."); setLaster(false); return;
    }
    if(data.user) {
      await upsertProfil(data.user.id, { navn, onboarding_done: false });
      await new Promise(r=>setTimeout(r,500));
      setUser({ ...brukerFraSesjon(data.user, null), navn, onboardingDone: false });
      setScreen("bruker-app");
    } else { setBekreftSendt(true); }
    setLaster(false);
  }

  async function nullstillPassord() {
    if(!epost) { setFeil("Fyll inn e-postadresse først."); return; }
    setLaster(true); setFeil("");
    const { error } = await sb.auth.resetPasswordForEmail(epost, {
      redirectTo: "https://www.kulturvarsling.no/app"
    });
    if(error) { setFeil("Kunne ikke sende tilbakestillingslenke."); setLaster(false); }
    else { setBekreftSendt(true); setLaster(false); }
  }

  if(bekreftSendt) return (
    <div className="kv-skjerm">
      <div className="kv-ark smal">
        <h1 className="kv-tittel">{glemtModus?"Tilbakestilling sendt":"Bekreftelse sendt"}</h1>
        <p className="kv-brod">
          {glemtModus
            ? <>En lenke for å tilbakestille passordet er sendt til <strong>{epost}</strong>.</>
            : <>En bekreftelseslenke er sendt til <strong>{epost}</strong>. Åpne lenken for å aktivere kontoen.</>
          }
        </p>
        <Knapp variant="linje" onClick={()=>{setBekreftSendt(false);setGlemtModus(false);}}>Tilbake til innlogging</Knapp>
      </div>
    </div>
  );

  return (
    <div className="kv-skjerm">
      <div className="kv-ark smal">
        <h1 className="kv-tittel">{mode==="login"?"Logg inn":"Opprett konto"}</h1>
        <p className="kv-ingress">
          {grunn || (mode==="login"
            ? "Logg inn for å følge saker og lagre varsler."
            : "Kontoen er gratis og brukes til varsler, brev og oversikt over innspill.")}
        </p>
        <Felt id="login-epost" label="E-postadresse" type="email" value={epost} onChange={e=>setEpost(e.target.value)} autoComplete="email" />
        <Felt id="login-pw" label="Passord" type="password" value={pw} onChange={e=>setPw(e.target.value)} autoComplete={mode==="login"?"current-password":"new-password"} placeholder="Minst 6 tegn" />
        {mode==="register"&&<Felt id="login-navn" label="Navn eller organisasjon" value={navn} onChange={e=>setNavn(e.target.value)} />}
        {mode==="register"&&(
          <p className="kv-meta">
            Ved å opprette konto aksepterer du <a className="kv-lenke" href="/personvern" target="_blank" rel="noopener noreferrer">personvernerklæringen</a>.
          </p>
        )}
        {feil&&<p className="kv-feil" role="alert">{feil}</p>}
        <Knapp className="bred" onClick={mode==="login"?loggInn:registrer} disabled={laster}>
          {laster?"Laster":(mode==="login"?"Logg inn":"Opprett konto")}
        </Knapp>
        {mode==="login"&&(
          <Knapp variant="stille" onClick={()=>{setGlemtModus(true);nullstillPassord();}}>Glemt passordet?</Knapp>
        )}
        <p className="kv-meta">
          {mode==="login"?"Har du ikke konto?":"Har du allerede konto?"}{" "}
          <button type="button" className="kv-knapp stille" onClick={()=>{setMode(m=>m==="login"?"register":"login");setFeil("");}}>
            {mode==="login"?"Registrer deg":"Logg inn"}
          </button>
        </p>
        <div className="kv-klynge">
          {kommuneLoginSynlig && <Knapp variant="stille" onClick={()=>setScreen("kommune-login")}>For kommuner</Knapp>}
          <Knapp variant="stille" onClick={()=>setScreen("bruker-app")}>Tilbake</Knapp>
        </div>
      </div>
    </div>
  );
}

/** Bare i vite dev, til skjermbilder. Brukeren har ingen id, så ingenting lagres. */
function forhandsvisning(): string | null {
  if (!import.meta.env.DEV) return null;
  return new URLSearchParams(window.location.search).get("vis");
}

const FORHANDSBRUKER = {
  navn: "Eksempel",
  org: "Eksempelorganisasjon",
  epost: "eksempel@kulturvarsling.no",
  orgType: "organisasjon",
  fylkesnr: "03",
  onboardingDone: true,
  varslerAktive: true,
  fagfelt: ["musikk", "scenekunst"],
  geografisk: ["nasjonalt", "fylke"],
  varselFrekvens: "ukentlig",
  varselEpost: "eksempel@kulturvarsling.no",
};

function visningFraSti(): string {
  const p = window.location.pathname.replace(/\/$/, "");
  if (p === "/ordliste" || p === "/app/ordliste") return "ordliste";
  if (p === "/design" || p === "/app/design") return "design";
  const vis = forhandsvisning();
  if (vis === "profil" || vis === "varsler") return "profil";
  if (vis === "mobiliser") return "mobiliser";
  return "forside";
}

function BrukerApp({user,setUser,setScreen,beOmInnlogging}: any) {
  const [view,setView]=useState(visningFraSti);
  const [arkivKat,setArkivKat]=useState("alle");
  const [showPremium,setShowPremium]=useState(false);
  const [showVarselReg,setShowVarselReg]=useState(forhandsvisning()==="varsler");
  const [showOnboarding,setShowOnboarding]=useState(user&&!user.onboardingDone);
  const [showFeedback,setShowFeedback]=useState(false);
  const [fulgte,setFullgte]=useState<any[]>([]);
  const isPremium = user?.plan==="premium";
  const [aktivitet,setAktivitet]=useState<any[]>(AKTIVITET_INIT);

  const [varsler,setVarsler]=useState<any[]>([]);
  const [kampanjer,setKampanjer]=useState<any[]>([]);
  const [dataLastet,setDataLastet]=useState(false);

  const idagISO = new Date().toISOString().split("T")[0];
  const erHistorisk = (v)=>
    (v.frist && v.frist < idagISO) ||
    (!v.frist && v.opprettet && (Date.now()-new Date(v.opprettet).getTime()) > 90*86400000);
  const aktiveVarsler = useMemo(()=>varsler.filter(v=>!erHistorisk(v)),[varsler]);
  const historiskeVarsler = useMemo(()=>varsler.filter(erHistorisk),[varsler]);
  const fristSynlige = useMemo(()=>varsler.filter((v: any)=>v.frist || v.status==="passert" || !erHistorisk(v)),[varsler]);

  useEffect(()=>{
    async function lastData() {
      const v = await lastVarsler();
      if(v && v.length > 0) setVarsler(v);
      const k = await lastKampanjer();
      if(k && k.length > 0) setKampanjer(k);
      if(user?.id) {
        const f = await hentFulgte(user.id);
        if(f.feil) showToast("Kunne ikke hente sakene du følger.","feil");
        else setFullgte(f.ids);
        const a = await hentAktivitet(user.id);
        if(a.length > 0) setAktivitet(a.map(x=>({
          ...x, type:x.type, tittel:x.tittel, dato:x.opprettet?.slice(0,10)||"",
          sakId:x.sak_id, mottaker:x.mottaker, status:x.status||"sendt"
        })));
      }
      setDataLastet(true);
    }
    lastData();

    const kanalen = sb.channel("varsler-live")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"varsler",filter:"publisert=eq.true"},(payload)=>{
        const v = payload.new;
        const nytt = {...v, nivå:v.niva, dager:dagerTilFrist(v.frist)};
        setVarsler(prev=>[nytt,...prev]);
        showToast(`Nytt varsel: ${v.tittel.slice(0,60)}…`,"info");
      })
      .subscribe();

    return ()=>{ sb.removeChannel(kanalen); };
  },[]);

  async function loggAktivitet(entry) {
    const ny = {...entry, id:Date.now(), dato:new Date().toLocaleDateString("no-NO")};
    setAktivitet(a=>[ny,...a]);
    if(user?.id) await loggAktivitetDB(user.id, entry);
  }

  async function toggleFølg(sakId) {
    if(!user?.id) {
      beOmInnlogging("Logg inn for å følge saken. Valget lagres på kontoen din.");
      return;
    }
    const følger = fulgte.includes(sakId);
    const forrige = fulgte;
    setFullgte(f=>følger?f.filter(x=>x!==sakId):[...f,sakId]);
    const ok = await toggleFølgSak(user.id, sakId, følger);
    if(!ok) {
      setFullgte(forrige);
      showToast("Kunne ikke lagre følgingen. Prøv igjen.","feil");
    }
  }

  async function toggleVarsler(kat: any, geo: any) {
    if(!user?.id) {
      beOmInnlogging("Logg inn for å slå på varsler. Valget lagres på kontoen din.");
      return;
    }
    const forrige = {
      fagfelt: user.fagfelt||[],
      geografisk: user.geografisk||[],
      varslerAktive: !!user.varslerAktive,
      varselEpost: user.varselEpost||"",
      varselKat: user.varselKat||[],
      varselNivå: user.varselNivå||[],
    };
    const dekket = utvalgErDekket(forrige.varslerAktive, forrige.fagfelt, forrige.geografisk, kat, geo);
    const utvalg = dekket
      ? { fagfelt: forrige.fagfelt, geografisk: forrige.geografisk }
      : leggTilUtvalg(forrige.fagfelt, forrige.geografisk, kat, geo);
    const neste = {
      ...utvalg,
      varslerAktive: !dekket,
      varselEpost: dekket ? "" : (user.epost||""),
      varselKat: utvalg.fagfelt,
      varselNivå: nivaaFraGeografisk(utvalg.geografisk),
    };
    setUser(u=>({...u,...neste}));
    const ok = await lagreProfil(user.id, {
      varsler_aktive: neste.varslerAktive,
      fagfelt: neste.fagfelt,
      geografisk: neste.geografisk,
    });
    if(!ok) {
      setUser(u=>({...u,...forrige}));
      showToast("Kunne ikke lagre varslene. Prøv igjen.","feil");
    }
  }

  async function loggUt() {
    await sb.auth.signOut();
    setUser(null);
    setScreen("bruker-app");
  }

  const [menyÅpen,setMenyÅpen]=useState(false);
  const [merÅpen,setMerÅpen]=useState(false);

  useEffect(() => {
    const onPop = () => setView(visningFraSti());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function gå(id: string){
    setMenyÅpen(false);
    setMerÅpen(false);
    if(id==="premium"&&!isPremium){setShowPremium(true);return;}
    if(id==="mobiliser"&&!user){setScreen("bruker-login");return;}
    if(id==="ordliste") window.history.pushState({}, "", "/ordliste");
    setView(id);
    window.scrollTo({top:0});
  }
  function velgFag(id: string){
    setArkivKat(id);
    gå("varsler");
  }
  function tilMetode(){
    setMenyÅpen(false);
    setMerÅpen(false);
    setView("forside");
    window.setTimeout(()=>document.getElementById("metode")?.scrollIntoView({behavior:"smooth",block:"start"}),40);
  }
  const mer=[
    {id:"ordliste",label:"Ordliste"},
    {id:"kampanjer",label:"Kampanjer"},
    {id:"mobiliser",label:"Mobiliser"},
    {id:"historikk",label:"Historikk"},
    {id:"premium",label:"Premium"},
    ...(user?[{id:"profil",label:"Min profil"}]:[]),
  ];
  const annenTittel =
    view==="historikk"?"Sakshistorikk":
    view==="kampanjer"?"Kampanjer":
    view==="mobiliser"?"Mobiliser":
    view==="profil"?"Min profil":
    view==="premium"?"Premium-verktøy":"";
  const fagAktiv = (id: string) => view==="varsler" && arkivKat===id;

  return (
    <div className="avis">
      {showPremium&&<PremiumModal user={user} onClose={()=>setShowPremium(false)} onLogin={()=>{setShowPremium(false);setScreen("bruker-login");}}/>}
      {showVarselReg&&<VarselRegistreringModal user={user} setUser={setUser} onClose={()=>setShowVarselReg(false)} beOmInnlogging={beOmInnlogging}/>}
      {showOnboarding&&user&&<OnboardingWizard user={user} setUser={setUser} onDone={()=>setShowOnboarding(false)}/>}
      {showFeedback&&<FeedbackModal onClose={()=>setShowFeedback(false)}/>}

      <div className="avis-dato">
        <div className="avis-wrap avis-dato-rad">
          <div className="avis-dato-venstre">
            <span className="avis-dato-meta">{datoMeta(dataLastet?aktiveVarsler.length:null)}</span>
            <KildeTillitsstrip onÅpne={()=>gå("kilder")}/>
          </div>
          <div className="avis-dato-hoyre">
            {kommuneLoginSynlig && <button type="button" onClick={()=>setScreen("kommune-login")}>For kommuner</button>}
            {user ? (
              <>
                <button type="button" onClick={()=>gå("profil")}>{user.org||user.navn||"Min profil"}</button>
                <button type="button" onClick={loggUt}>Logg ut</button>
              </>
            ) : (
              <button type="button" onClick={()=>setScreen("bruker-login")}>Logg inn</button>
            )}
          </div>
        </div>
      </div>

      <header className="avis-mast">
        <button type="button" className="avis-tittel" onClick={()=>gå("forside")}>Kultur<span>varsling</span></button>
        <p className="avis-under">{UNDERTEKST}</p>
        <button type="button" className="avis-menyknapp" aria-expanded={menyÅpen} aria-controls="avis-mobilmeny" onClick={()=>setMenyÅpen(v=>!v)}>Meny</button>
      </header>

      <nav className="avis-fagnav" aria-label="Fagområder">
        <div className="avis-wrap">
          <button type="button" className={fagAktiv("alle")?"aktiv":undefined} onClick={()=>velgFag("alle")}>Alle fag</button>
          {KATEGORIER.map(k=>(
            <button type="button" key={k.id} className={fagAktiv(k.id)?"aktiv":undefined} onClick={()=>velgFag(k.id)}>{k.label}</button>
          ))}
        </div>
      </nav>

      <nav className="avis-meny" aria-label="Hovedmeny">
        <div className="avis-wrap">
          <button type="button" className={view==="forside"?"aktiv":undefined} onClick={()=>gå("forside")}>Forsiden</button>
          <button type="button" className={view==="varsler"?"aktiv":undefined} onClick={()=>gå("varsler")}>Arkiv</button>
          <button type="button" onClick={tilMetode}>Slik jobber vi</button>
          <span className="avis-mer">
            <button type="button" className={mer.some(m=>m.id===view)?"aktiv":undefined} aria-expanded={merÅpen} onClick={()=>setMerÅpen(v=>!v)}>Mer</button>
            {merÅpen&&(
              <div className="avis-mer-panel" role="menu">
                {mer.map(m=>(
                  <button type="button" role="menuitem" key={m.id} className={view===m.id?"aktiv":undefined} onClick={()=>gå(m.id)}>{m.label}</button>
                ))}
              </div>
            )}
          </span>
        </div>
      </nav>
      {menyÅpen&&(
        <div className="avis-mobilmeny" id="avis-mobilmeny">
          <button type="button" className={fagAktiv("alle")?"aktiv":undefined} onClick={()=>velgFag("alle")}>Alle fag</button>
          {KATEGORIER.map(k=>(
            <button type="button" key={k.id} className={fagAktiv(k.id)?"aktiv":undefined} onClick={()=>velgFag(k.id)}>{k.label}</button>
          ))}
          <button type="button" className={view==="forside"?"aktiv":undefined} onClick={()=>gå("forside")}>Forsiden</button>
          <button type="button" className={view==="varsler"?"aktiv":undefined} onClick={()=>gå("varsler")}>Arkiv</button>
          <button type="button" onClick={tilMetode}>Slik jobber vi</button>
          {mer.map(m=>(
            <button type="button" key={m.id} className={view===m.id?"aktiv":undefined} onClick={()=>gå(m.id)}>{m.label}</button>
          ))}
          {kommuneLoginSynlig && <button type="button" onClick={()=>setScreen("kommune-login")}>For kommuner</button>}
          {user
            ? <button type="button" onClick={loggUt}>Logg ut</button>
            : <button type="button" onClick={()=>setScreen("bruker-login")}>Logg inn</button>}
        </div>
      )}

      <main>
        {view==="forside" && (
          <BrukerForside
            setView={gå}
            varsler={aktiveVarsler}
            kampanjer={kampanjer}
            setShowPremium={setShowPremium}
            isPremium={isPremium}
            fulgte={fulgte}
            toggleFølg={toggleFølg}
            onLogin={()=>setScreen("bruker-login")}
            dataLastet={dataLastet}
            user={user}
            minFylke={user?.fylkesnr}
            onVelgFylke={(fnr)=>{setUser(u=>u?{...u,fylkesnr:fnr}:u);if(user?.id)lagreProfil(user.id,{fylkesnr:fnr});}}
            onVelgFag={velgFag}
          />
        )}
        {view==="varsler" && (
          <BrukerVarsler
            fulgte={fulgte}
            toggleFølg={toggleFølg}
            varslerData={fristSynlige}
            kampanjerData={kampanjer}
            minFylke={user?.fylkesnr}
            fagfelt={user?.fagfelt||[]}
            varslerAktive={!!user?.varslerAktive}
            geografisk={user?.geografisk||[]}
            onToggleVarsler={toggleVarsler}
            katStyrt={arkivKat}
            onKat={setArkivKat}
          />
        )}
        {view==="kilder" && <KildeHelseSide onBack={()=>gå("forside")}/>}
        {view==="ordliste" && <OrdlisteSide />}
        {view==="design" && <DesignSide />}
        {view!=="forside"&&view!=="varsler"&&view!=="kilder"&&view!=="ordliste"&&view!=="design"&&(
          <div className="avis-wrap avis-annet">
            {annenTittel&&<h1>{annenTittel}</h1>}
            {view==="historikk" && <SaksHistorikkSide aktivitet={aktivitet} historiske={historiskeVarsler}/>}
            {view==="kampanjer" && <BrukerKampanjer kampanjerData={kampanjer} varslerData={aktiveVarsler} user={user}/>}
            {view==="mobiliser" && <BrukerMobiliser loggAktivitet={loggAktivitet} user={user} varslerData={aktiveVarsler} kampanjerData={kampanjer}/>}
            {view==="profil" && (
              <MinProfilSide
                user={user}
                setUser={setUser}
                setScreen={setScreen}
                aktivitet={aktivitet}
                fulgte={fulgte}
                toggleFølg={toggleFølg}
                setShowVarselReg={setShowVarselReg}
                setShowPremium={setShowPremium}
                setShowOnboarding={setShowOnboarding}
                varslerData={varsler}
              />
            )}
            {view==="premium" && <PremiumVerktøy varslerData={varsler} user={user}/>}
          </div>
        )}
      </main>

      <footer className="avis-fot">
        <div className="avis-wrap avis-fot-rad">
          <div>
            <div>© {new Date().getFullYear()} {behandlingsansvarlig}</div>
            <div className="kv-meta">org.nr. {orgnr} · {poststed}</div>
          </div>
          <div>
            <a href="/ordliste">Ordliste</a>
            <a href="/personvern">Personvern</a>
            <button type="button" onClick={()=>setShowFeedback(true)}>Gi tilbakemelding</button>
            <span>personvern@kulturvarsling.no</span>
          </div>
        </div>
      </footer>

      <nav className="avis-bunn" aria-label="Bunnmeny">
        <button type="button" className={view==="forside"?"aktiv":undefined} onClick={()=>gå("forside")}>Forsiden</button>
        <button type="button" className={view==="varsler"?"aktiv":undefined} onClick={()=>gå("varsler")}>Arkiv</button>
        <button type="button" className={menyÅpen?"aktiv":undefined} aria-expanded={menyÅpen} onClick={()=>setMenyÅpen(v=>!v)}>Mer</button>
      </nav>
    </div>
  );
}

function FølgKnapp({sakId,fulgte,toggleFølg,size="sm"}:{sakId:any;fulgte:any[];toggleFølg:(id:any)=>void;size?:string}) {
  const følger = fulgte.includes(sakId);
  return (
    <Knapp
      variant={size==="sm"?"stille":"linje"}
      onClick={e=>{e.stopPropagation();toggleFølg(sakId);}}
    >
      {følger?"Følger":"Følg saken"}
    </Knapp>
  );
}

function MinProfilSide({user,setUser,setScreen,aktivitet,fulgte,toggleFølg,setShowVarselReg,setShowPremium,setShowOnboarding,varslerData=[]}:{user:any;setUser:any;setScreen:any;aktivitet:any[];fulgte:any[];toggleFølg:any;setShowVarselReg:any;setShowPremium:any;setShowOnboarding:any;varslerData?:any[]}) {
  const [tab,setTab]=useState("profil");
  const [slettSteg,setSlettSteg]=useState("idle");
  const [slettFeil,setSlettFeil]=useState("");
  async function slettKonto() {
    setSlettSteg("jobber");
    setSlettFeil("");
    const { data, error } = await sb.functions.invoke("slett-konto", { body: {} });
    if (error || !data?.ok) {
      setSlettSteg("idle");
      setSlettFeil("Kontoen ble ikke slettet. Prøv igjen, eller skriv til personvern@kulturvarsling.no.");
      return;
    }
    await sb.auth.signOut();
    setUser(null);
    setScreen("bruker-login");
  }
  const [redigerOrg,setRedigerOrg]=useState(false);
  const [orgVal,setOrgVal]=useState(user?.org||"");
  const [orgTypeVal,setOrgTypeVal]=useState(user?.orgType||"");
  const [fylkeVal,setFylkeVal]=useState(user?.fylkesnr||"");
  async function lagreOrg(){
    const oppd={org:orgVal,orgType:orgTypeVal,fylkesnr:fylkeVal||null};
    setUser(u=>({...u,...oppd}));
    setRedigerOrg(false);
    if(user?.id) await lagreProfil(user.id,{org:orgVal,org_type:orgTypeVal,fylkesnr:fylkeVal||null});
  }
  const fulgteSaker = varslerData.filter(v=>fulgte.includes(v.id));
  const oppsummering = [
    ["Saker fulgt", fulgte.length],
    ["Høringssvar sendt", aktivitet.filter(a=>a.type==="horingssvar").length],
    ["Politikere kontaktet", aktivitet.filter(a=>a.type==="kontakt").length],
    ["Kampanjer signert", aktivitet.filter(a=>a.type==="signatur").length],
  ];

  return (
    <div className="kv-stakk">
      <Faner
        faner={[
          {id:"profil",label:"Profil"},
          {id:"fulgte",label:"Saker jeg følger"},
          {id:"aktivitet",label:"Aktivitet"},
          {id:"innstillinger",label:"Innstillinger"},
        ]}
        valgt={tab}
        onVelg={setTab}
      />

      {tab==="profil"&&(
        <div className="kv-rutenett">
          <section className="kv-kort">
            <div className="kv-klynge mellom">
              <h2 className="kv-undertittel">Organisasjon</h2>
              <Knapp variant="linje" onClick={()=>setRedigerOrg(r=>!r)}>{redigerOrg?"Lukk":"Rediger"}</Knapp>
            </div>
            <p className="kv-brod">{user?.org||user?.navn||"Ikke satt"}</p>
            <p className="kv-meta">{user?.epost}</p>
            <p className="kv-meta">{metaLinje([orgTypeNavn(user?.orgType), user?.fylkesnr&&fylkesnavn(user.fylkesnr)])}</p>
            {redigerOrg?(
              <div>
                <Felt id="profil-org" label="Organisasjonsnavn" value={orgVal} onChange={e=>setOrgVal(e.target.value)} />
                <p className="kv-feltnavn">Type aktør</p>
                <Enkeltvalg valg={ORG_TYPE_VALG} valgt={orgTypeVal} onVelg={setOrgTypeVal} />
                <Velger id="profil-fylke" label="Fylke" value={fylkeVal} onChange={e=>setFylkeVal(e.target.value)}>
                  <option value="">Velg fylke</option>
                  {FYLKER.map(f=><option key={f.nr} value={f.nr}>{f.navn}</option>)}
                </Velger>
                <p className="kv-meta">Fylket brukes når du filtrerer saker som angår ditt område.</p>
                <Knapp className="bred" onClick={lagreOrg}>Lagre endringer</Knapp>
              </div>
            ):(
              <p className="kv-meta">Organisasjonsprofilen brukes til å fylle ut høringssvar og brev.</p>
            )}
          </section>
          <section className="kv-kort">
            <h2 className="kv-undertittel">Aktivitet</h2>
            <ul className="kv-liste">
              {oppsummering.map(([lbl,n])=>(
                <li key={String(lbl)} className="kv-rad kv-klynge mellom">
                  <span>{lbl}</span>
                  <span className="kv-tall">{n}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {tab==="fulgte"&&(
        fulgte.length===0?(
          <p className="kv-tom">Ingen saker er fulgt. Bruk «Følg saken» i arkivet for å samle dem her.</p>
        ):(
          <ul className="kv-liste">
            {fulgteSaker.map(v=>(
              <li key={v.id} className="kv-rad">
                <p className="kv-meta">{metaLinje([katNavn(v.kategori), fristEtikett(v)])}</p>
                <h3 className="kv-undertittel">{v.tittel}</h3>
                <p className="kv-meta">{v.instans}</p>
                <FølgKnapp sakId={v.id} fulgte={fulgte} toggleFølg={toggleFølg}/>
              </li>
            ))}
          </ul>
        )
      )}

      {tab==="aktivitet"&&(
        <div>
          {aktivitet.length===0&&<p className="kv-tom">Ingen aktivitet er registrert.</p>}
          <ul className="kv-liste">
            {aktivitet.map(a=>{
              const når = a.opprettet || a.dato || "";
              const visNår = typeof når==="string" && når.includes("T") ? når.slice(0,10) : når;
              return (
                <li key={a.id} className="kv-rad">
                  <p>{a.tittel || a.tekst}</p>
                  <p className="kv-meta">{metaLinje([TYPE_NAVN[a.type]||a.type, visNår])}</p>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {tab==="innstillinger"&&(
        <div className="kv-stakk">
          <section className="kv-kort">
            <h2 className="kv-undertittel">Varsler</h2>
            <p className="kv-brod">
              {user?.varslerAktive ? "Varsler er slått på. Ingenting sendes ut ennå. Valgene er bare lagret." : "Ingen varsler er slått på."}
            </p>
            <div className="kv-klynge">
              <Knapp variant="linje" onClick={()=>setShowVarselReg(true)}>Endre varsler og fagfelt</Knapp>
              {user?.varslerAktive&&(
                <Knapp variant="linje" onClick={async()=>{
                  const forrige=user;
                  setUser(u=>({...u,varslerAktive:false,varselEpost:""}));
                  const ok=user?.id ? await lagreProfil(user.id,{varsler_aktive:false}) : false;
                  if(!ok){ setUser(forrige); showToast("Kunne ikke lagre varslene. Prøv igjen.","feil"); }
                }}>Skru av varsler</Knapp>
              )}
            </div>
          </section>
          <section className="kv-kort">
            <h2 className="kv-undertittel">Profil og oppsett</h2>
            <p className="kv-brod">Gå gjennom oppsettet på nytt og oppdater organisasjonsinformasjonen.</p>
            <Knapp variant="linje" onClick={()=>setShowOnboarding(true)}>Gjennomfør oppsett på nytt</Knapp>
          </section>
          <section className="kv-kort">
            <h2 className="kv-undertittel">Personvern og data</h2>
            <p className="kv-brod">Les personvernerklæringen, eller slett kontoen og dataene som er knyttet til den.</p>
            <div className="kv-klynge">
              <a className="kv-lenke" href="/personvern">Personvernerklæringen</a>
              {slettSteg!=="bekreft"&&(
                <Knapp variant="fare" onClick={()=>setSlettSteg("bekreft")} disabled={slettSteg==="jobber"}>
                  {slettSteg==="jobber"?"Sletter":"Slett min konto"}
                </Knapp>
              )}
            </div>
            {slettSteg==="bekreft"&&(
              <div className="kv-stakk">
                <p className="kv-brod">Dette sletter kontoen og dataene som er knyttet til den. Handlingen kan ikke angres.</p>
                <div className="kv-klynge">
                  <Knapp variant="fare" onClick={slettKonto}>Ja, slett kontoen</Knapp>
                  <Knapp variant="linje" onClick={()=>setSlettSteg("idle")}>Avbryt</Knapp>
                </div>
              </div>
            )}
            {slettFeil&&<p className="kv-feil" role="alert">{slettFeil}</p>}
          </section>
          {user?.plan!=="premium"&&(
            <section className="kv-kort">
              <h2 className="kv-undertittel">Premium</h2>
              <p className="kv-brod">Budsjettolkning, trender og eksport.</p>
              <Knapp onClick={()=>setShowPremium(true)}>Se planene</Knapp>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function BrukerForside({setView,setShowPremium,isPremium,fulgte=[],toggleFølg=()=>{},onLogin=()=>{},varsler=[],kampanjer=[],dataLastet=true,minFylke=null,onVelgFylke=()=>{},user=null,onVelgFag=(_id: string)=>{}}:{setView:any;setShowPremium:any;isPremium:any;fulgte?:any[];toggleFølg?:any;onLogin?:any;varsler?:any[];kampanjer?:any[];dataLastet?:boolean;minFylke?:any;onVelgFylke?:any;user?:any;onVelgFag?:(id:string)=>void}) {
  const [valgt,setValgt]=useState<any>(null);
  const [fane,setFane]=useState("info");
  void setShowPremium; void isPremium; void onLogin; void minFylke; void onVelgFylke; void user;
  return (
    <>
      <ForsideAvis
        saker={varsler}
        lastet={dataLastet}
        fulgte={fulgte}
        onToggleFølg={toggleFølg}
        onÅpne={(sak, tab)=>{setFane(tab);setValgt(sak);}}
        onAlle={()=>setView("varsler")}
        onVelgFag={onVelgFag}
        kampanjeAntall={kampanjer.length}
        onKampanjer={()=>setView("kampanjer")}
      />
      {valgt&&<SaksModal sak={valgt} startTab={fane} onClose={()=>setValgt(null)} kampanjer={kampanjer}/>}
    </>
  );
}

export function VarselKort({v,compact=false,onClick,fulgte=[],toggleFølg=()=>{}}:{v:any;compact?:boolean;onClick?:any;fulgte?:any[];toggleFølg?:any}) {
  return (
    <article className="kv-kort">
      <p className="kv-meta">{metaLinje([katNavn(v.kategori), nivaaNavn(v.nivå, v.sted), fristEtikett(v)])}</p>
      <h3 className="kv-undertittel">{v.tittel}</h3>
      {!compact && <p className="kv-brod">{v.sammendrag}</p>}
      <p className="kv-meta">{v.instans}</p>
      <div className="kv-klynge">
        {onClick && <Knapp variant="linje" onClick={()=>onClick(v)}>Åpne</Knapp>}
        <FølgKnapp sakId={v.id} fulgte={fulgte} toggleFølg={toggleFølg}/>
      </div>
    </article>
  );
}

function KampanjeKort({k,compact=false,user=null,relSak=null,onÅpneSak}:{k:any;compact?:boolean;user?:any;relSak?:any;onÅpneSak?:()=>void}) {
  const [sig,setSig]=useState(k.sig);
  const [vis,setVis]=useState(false);
  const [signert,setSignert]=useState(false);
  const [laster,setLaster]=useState(false);
  const [navn,setNavn]=useState(user?.navn||"");
  const [epost,setEpost]=useState(user?.epost||"");

  async function signer() {
    if(!navn||!epost) return;
    setLaster(true);
    const ok = await signKampanje(k.id, user?.id??null, navn, epost);
    if(ok) { setSig(s=>s+1); setSignert(true); setVis(false); showToast("Signaturen er registrert."); }
    else { showToast("Kunne ikke registrere signaturen – prøv igjen","feil"); }
    setLaster(false);
  }

  return (
    <article className="kv-kort">
      {(k.tags||[]).length>0 && <p className="kv-meta">{(k.tags||[]).join(", ")}</p>}
      <h3 className="kv-undertittel">{k.tittel}</h3>
      {!compact && <p className="kv-brod">{k.beskrivelse}</p>}
      {relSak && onÅpneSak && (
        <button type="button" className="kv-knapp stille" onClick={onÅpneSak}>Sak: {relSak.tittel}</button>
      )}
      <p className="kv-meta">{sig} av {k.mal}{k.dager!=null?` · ${k.dager} dager igjen`:""}</p>
      {signert?(
        <p className="kv-brod">Signaturen er registrert.</p>
      ):vis?(
        <div>
          <Felt id={`kamp-navn-${k.id}`} label="Navn" value={navn} onChange={e=>setNavn(e.target.value)} />
          <Felt id={`kamp-epost-${k.id}`} label="E-post" type="email" value={epost} onChange={e=>setEpost(e.target.value)} />
          <div className="kv-klynge">
            <Knapp onClick={signer} disabled={laster}>{laster?"Lagrer":"Signer"}</Knapp>
            <Knapp variant="linje" onClick={()=>setVis(false)}>Avbryt</Knapp>
          </div>
        </div>
      ):(
        <Knapp onClick={()=>setVis(true)}>Signer kampanjen</Knapp>
      )}
    </article>
  );
}

function SaksModal({sak,onClose,kampanjer=[],startTab="info"}: {sak:any; onClose:any; kampanjer?:any; startTab?:string}) {
  const [tab,setTab]=useState(startTab||"info");
  useEffect(()=>{ setTab(startTab||"info"); },[sak?.id, startTab]);
  useEffect(()=>{
    document.body.style.overflow="hidden";
    const esc=(e:KeyboardEvent)=>{ if(e.key==="Escape") onClose(); };
    window.addEventListener("keydown",esc);
    return ()=>{ document.body.style.overflow=""; window.removeEventListener("keydown",esc); };
  },[onClose]);
  const [malModal,setMalModal]=useState<any>(null);
  const [visNyKampanje,setVisNyKampanje]=useState(false);
  const [visFeedback,setVisFeedback]=useState(false);
  const [nyKampTittel,setNyKampTittel]=useState(`Stopp: ${sak.tittel}`);
  const [nyKampBeskr,setNyKampBeskr]=useState("");
  const [nyKampOpprettet,setNyKampOpprettet]=useState(false);
  const relKampanjer=kampanjer.filter(k=>k.kategori===sak.kategori||k.sakId===sak.id);
  const merket = useMemo(
    () => delOppDokument([sak?.tittel || "", sak?.sammendrag || "", sak?.instans || ""]),
    [sak?.id, sak?.tittel, sak?.sammendrag, sak?.instans],
  );
  const vurdering = vurderSak(sak);

  const [klartekst,setKlartekst]=useState<any>(null);
  const [klartekstStatus,setKlartekstStatus]=useState("idle");
  async function hentKlartekst(){
    setKlartekstStatus("laster");
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(!session?.user){ setKlartekstStatus("ikke-innlogget"); return; }
      const profil=await hentProfil(session.user.id);
      const {data,error}=await sb.functions.invoke("klartekst",{
        body:{varsel_id:sak.id,profil:{fagfelt:profil?.fagfelt||[],org_type:profil?.org_type||"",fylke:profil?.fylke||null}}
      });
      if(error||!data?.svar) throw error||new Error("tomt svar");
      setKlartekst(data.svar); setKlartekstStatus("ok");
    }catch(e){ console.error("Klartekst-feil:",e); setKlartekstStatus("feil"); }
  }

  return (
    <Dialog tittel={<MerketTekst deler={merket[0]} />} etikett={sak.tittel} onClose={onClose}>
      {malModal&&<MalModal type={malModal.type} kontekst={malModal.kontekst} onClose={()=>setMalModal(null)}/>}
      {visFeedback&&<FeedbackModal onClose={()=>setVisFeedback(false)} kontekst={{sakTittel:sak.tittel,type:"feil"}}/>}
      <div className={vurdering.handlingsrettet ? "kv-sakrolle handling" : "kv-sakrolle orientering"}>
        <Rollemerke sak={sak} nå={new Date()} />
      </div>
      <p className="kv-meta">{metaLinje([fristEtikett(sak), katNavn(sak.kategori), nivaaNavn(sak.nivå, sak.sted)])}</p>
      <Faner
        faner={[
          {id:"info",label:"Saken"},
          {id:"horingssvar",label:"Skriv innspill"},
          {id:"mobiliser",label:"Mobiliser"},
          {id:"kampanje",label:"Kampanje"},
          {id:"del",label:"Del"},
        ]}
        valgt={tab}
        onVelg={setTab}
      />
      {tab==="info"&&(
        <div className="kv-stakk">
          <p className="kv-brod"><MerketTekst deler={merket[1]} /></p>
          {klartekstStatus!=="ok"&&klartekstStatus!=="ikke-innlogget"&&(
            <Knapp onClick={hentKlartekst} disabled={klartekstStatus==="laster"}>
              {klartekstStatus==="laster"?"Henter forklaring":"Forklar saken"}
            </Knapp>
          )}
          {klartekstStatus==="feil"&&<p className="kv-feil">Forklaringen kunne ikke hentes. Prøv igjen om litt.</p>}
          {klartekstStatus==="ikke-innlogget"&&<p className="kv-brod">Logg inn for å få en forklaring av saken. Forklaringen er gratis.</p>}
          {klartekstStatus==="ok"&&klartekst&&(
            <div>
              <p className="kv-steg">Forklaring</p>
              <p className="kv-brod">{klartekst.hva_skjer}</p>
              {klartekst.hvem_pavirkes&&<p className="kv-brod">{klartekst.hvem_pavirkes}</p>}
              {klartekst.tall_belop&&<p className="kv-brod">{klartekst.tall_belop}</p>}
              {klartekst.frist&&<p className="kv-meta">Frist: {klartekst.frist}</p>}
              {klartekst.hva_kan_du_gjore?.length>0&&(
                <ul className="kv-liste">
                  {klartekst.hva_kan_du_gjore.map((h: string,i: number)=>(
                    <li key={i} className="kv-rad">{h}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="kv-meta"><MerketTekst deler={merket[2]} /></p>
          <p><a className="kv-lenke" href={sak.kilde} target="_blank" rel="noreferrer">Les saken hos kilden</a></p>
          <div className="kv-klynge">
            <Knapp variant="linje" onClick={()=>setTab("mobiliser")}>Kontakt politikere</Knapp>
            <Knapp variant="linje" onClick={()=>setTab("horingssvar")}>Skriv innspill</Knapp>
          </div>
          {relKampanjer.length>0&&(
            <button type="button" className="kv-knapp stille" onClick={()=>setTab("kampanje")}>
              {relKampanjer.length} kampanje{relKampanjer.length===1?"":"r"} på denne saken
            </button>
          )}
          <button type="button" className="kv-knapp stille" onClick={()=>setVisFeedback(true)}>Rapporter feil i saken</button>
        </div>
      )}
      {tab==="mobiliser"&&(
        <div className="kv-stakk">
          <p className="kv-brod">Åpne brev viser en mal. E-post åpner e-postprogrammet.</p>
          <p className="kv-brod">Liste over politikere kommer.</p>
          <div className="kv-rad">
            <p className="kv-feltnavn">Anbefalt komité</p>
            <h3 className="kv-undertittel">Familie- og kulturkomiteen</h3>
            <p className="kv-meta">familie-og-kulturkomiteen@stortinget.no</p>
            <Knapp variant="linje" onClick={()=>setMalModal({type:"komite",kontekst:{navn:"Familie- og kulturkomiteen",kontakt:"familie-og-kulturkomiteen@stortinget.no"}})}>Kontakt komiteen</Knapp>
          </div>
        </div>
      )}
      {tab==="kampanje"&&(
        <div className="kv-stakk">
          {relKampanjer.length>0&&(
            <div>
              <h3 className="kv-undertittel">Kampanjer på denne saken</h3>
              <ul className="kv-liste">
                {relKampanjer.map(k=>(
                  <li key={k.id} className="kv-rad">
                    <h3 className="kv-undertittel">{k.tittel}</h3>
                    <p className="kv-brod">{k.beskrivelse}</p>
                    <p className="kv-meta">{k.sig} av {k.mal}{k.dager!=null?` · ${k.dager} dager igjen`:""}</p>
                    <KampanjeSignerMini k={k}/>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="kv-undertittel">{relKampanjer.length>0?"Ny kampanje på denne saken":"Ingen kampanje ennå"}</h3>
            <p className="kv-brod">En kampanje samler underskrifter knyttet til saken.</p>
            {!visNyKampanje&&!nyKampOpprettet&&(
              <Knapp onClick={()=>setVisNyKampanje(true)}>Start kampanje</Knapp>
            )}
            {visNyKampanje&&!nyKampOpprettet&&(
              <div>
                <Felt id="ny-kamp-tittel" label="Tittel" value={nyKampTittel} onChange={e=>setNyKampTittel(e.target.value)} />
                <Tekstfelt id="ny-kamp-beskr" label="Hva krever dere?" value={nyKampBeskr} onChange={e=>setNyKampBeskr(e.target.value)} rows={3} placeholder={`Vi krever at ${sak.instans} trekker tilbake forslaget og sikrer...`} />
                <div className="kv-klynge">
                  <Knapp onClick={()=>{if(nyKampTittel)setNyKampOpprettet(true);}}>Opprett kampanje</Knapp>
                  <Knapp variant="linje" onClick={()=>setVisNyKampanje(false)}>Avbryt</Knapp>
                </div>
              </div>
            )}
            {nyKampOpprettet&&(
              <div>
                <p className="kv-brod">Kampanjen «{nyKampTittel}» er opprettet i dette vinduet.</p>
                <Knapp variant="linje" onClick={()=>navigator.clipboard?.writeText("https://kulturvarsling.no/kampanje/ny")}>Kopier lenke</Knapp>
              </div>
            )}
          </div>
        </div>
      )}
      {tab==="horingssvar"&&<HøringssvarMini sak={sak}/>}
      {tab==="del"&&<DelMini sak={sak}/>}
    </Dialog>
  );
}

function KampanjeSignerMini({k}) {
  const [sig,setSig]=useState(k.sig);
  const [signert,setSignert]=useState(false);
  const [vis,setVis]=useState(false);
  const [navn,setNavn]=useState("");
  const [epost,setEpost]=useState("");
  if(signert) return <p className="kv-brod">Signaturen er registrert. {sig} av {k.mal}.</p>;
  if(vis) return (
    <div>
      <Felt id={`mini-navn-${k.id}`} label="Navn" value={navn} onChange={e=>setNavn(e.target.value)} />
      <Felt id={`mini-epost-${k.id}`} label="E-post" type="email" value={epost} onChange={e=>setEpost(e.target.value)} />
      <div className="kv-klynge">
        <Knapp onClick={()=>{if(navn&&epost){setSig((s:number)=>s+1);setSignert(true);}}}>Signer</Knapp>
        <Knapp variant="linje" onClick={()=>setVis(false)}>Avbryt</Knapp>
      </div>
    </div>
  );
  return <Knapp onClick={()=>setVis(true)}>Signer denne kampanjen</Knapp>;
}

function HøringssvarMini({sak}) {
  const [tekst,setTekst]=useState(
    "Høringssvar \u2013 "+sak.tittel+"\n\nFra: [Organisasjonsnavn]\nTil: "+sak.instans+"\nDato: "+new Date().toLocaleDateString("no-NO")+"\n\n--- Vår vurdering ---\n[Skriv din vurdering her. Vær konkret og bruk fakta.]\n\n--- Konsekvenser for vårt felt ---\n[Hva betyr dette for din organisasjon eller gruppe?]\n\n--- Konklusjon og krav ---\n[Skriv tydelig hva dere krever eller anbefaler]\n\nMed vennlig hilsen,\n[Navn, tittel]\n[Organisasjon]\n[E-post / telefon]"
  );
  const [kopiert,setKopiert]=useState(false);
  const [sendt,setSendt]=useState(false);
  if(sendt) return (
    <div className="kv-stakk">
      <p className="kv-brod">E-postprogrammet er åpnet. Sjekk at meldingen går til riktig adresse hos {sak.instans}.</p>
      <p><a className="kv-lenke" href={sak.kilde} target="_blank" rel="noreferrer">Les saken hos {sak.instans}</a></p>
    </div>
  );
  return (
    <div className="kv-stakk">
      <p className="kv-brod">Et høringssvar er et formelt skriftlig innspill til en offentlig prosess. Når en myndighet vurderer en beslutning, legges forslaget ut på høring, og alle kan uttale seg. Høringssvar er offentlige dokumenter som skal vurderes. Flere innspill med samme syn kan påvirke utfallet, særlig lokalt og regionalt. Vær konkret, bruk tall, og avslutt med et tydelig krav.</p>
      <p className="kv-meta">
        Leveres til {sak.instans}.{" "}
        <a className="kv-lenke" href={sak.kilde} target="_blank" rel="noreferrer">Innlevering hos {sak.instans}</a>
      </p>
      <textarea className="kv-input" value={tekst} onChange={e=>setTekst(e.target.value)} rows={12} aria-label="Innspill" />
      <div className="kv-klynge">
        <Knapp onClick={()=>{
          window.open("mailto:?subject="+encodeURIComponent("Høringssvar \u2013 "+sak.tittel)+"&body="+encodeURIComponent(tekst));
          setSendt(true);
        }}>Åpne i e-post</Knapp>
        <Knapp variant="linje" onClick={()=>{navigator.clipboard?.writeText(tekst);setKopiert(true);setTimeout(()=>setKopiert(false),2500);}}>
          {kopiert?"Kopiert":"Kopier tekst"}
        </Knapp>
      </div>
      <p className="kv-meta">Uten e-postprogram kan teksten kopieres og limes inn i nettpost. Adressen finner du hos {sak.instans}.</p>
    </div>
  );
}

function DelMini({sak}) {
  const [kopiert,setKopiert]=useState(false);
  const [epostSendt,setEpostSendt]=useState(false);
  const url="https://kulturvarsling.no/sak/"+sak.id;
  const delTekst=sak.tittel+"\nFrist: "+new Date(sak.frist).toLocaleDateString("no-NO")+" ("+sak.dager+"d igjen)\n"+sak.instans+"\n"+url;
  const epostBody="Hei,\n\nJeg vil dele en sak fra Kulturvarsling.no som kan være relevant for deg:\n\n"+sak.tittel+"\nFrist: "+new Date(sak.frist).toLocaleDateString("no-NO")+"\n\nLes mer og bidra: "+url+"\n\nSaken kort:\n"+sak.sammendrag;
  return (
    <div className="kv-stakk">
      <p className="kv-feltnavn">Direktelenke</p>
      <p className="kv-kode">{url}</p>
      <pre className="kv-kode">{delTekst}</pre>
      <div className="kv-klynge">
        <Knapp variant="linje" onClick={()=>{navigator.clipboard?.writeText(url);setKopiert(true);setTimeout(()=>setKopiert(false),2000);}}>
          {kopiert?"Kopiert":"Kopier lenke"}
        </Knapp>
        <Knapp variant="linje" onClick={()=>{navigator.clipboard?.writeText(delTekst);setKopiert(true);setTimeout(()=>setKopiert(false),2000);}}>
          Kopier tekst
        </Knapp>
        <Knapp variant="linje" onClick={()=>{window.open("mailto:?subject="+encodeURIComponent("Kultursak: "+sak.tittel)+"&body="+encodeURIComponent(epostBody));setEpostSendt(true);}}>
          {epostSendt?"E-post åpnet":"Del via e-post"}
        </Knapp>
        <Knapp variant="linje" onClick={()=>window.open("https://www.facebook.com/sharer/sharer.php?u="+encodeURIComponent(url))}>Facebook</Knapp>
        <Knapp variant="linje" onClick={()=>window.open("https://www.linkedin.com/sharing/share-offsite/?url="+encodeURIComponent(url))}>LinkedIn</Knapp>
      </div>
    </div>
  );
}

function BrukerVarsler({fulgte=[],toggleFølg=()=>{},varslerData=VARSLER,kampanjerData=[],minFylke=null,fagfelt=[],varslerAktive=false,geografisk=[],onToggleVarsler,katStyrt,onKat}: {fulgte?: any[]; toggleFølg?: any; varslerData?: any; kampanjerData?: any; minFylke?: any; fagfelt?: string[]; varslerAktive?: boolean; geografisk?: string[]; onToggleVarsler?: (kat: string, geo: any) => void; katStyrt?: string; onKat?: (id: string) => void}) {
  const [valgt,setValgt]=useState<any>(null);
  const [fane,setFane]=useState("info");
  return (
    <>
      <VarselArkiv
        saker={varslerData}
        fulgte={fulgte}
        onToggleFølg={toggleFølg}
        onÅpne={(sak, tab)=>{setFane(tab);setValgt(sak);}}
        minFylke={minFylke?String(minFylke):null}
        fylker={FYLKER}
        prioriterteFag={fagfelt}
        varslerAktive={varslerAktive}
        geografisk={geografisk}
        onToggleVarsler={onToggleVarsler}
        katStyrt={katStyrt}
        onKat={onKat}
      />
      {valgt&&<SaksModal sak={valgt} startTab={fane} onClose={()=>setValgt(null)} kampanjer={kampanjerData}/>}
    </>
  );
}

function StartKampanjeModal({onClose,user,varslerData=[]}:{onClose:()=>void;user:any;varslerData?:any[]}) {
  const [tittel,setTittel]=useState("");
  const [beskrivelse,setBeskrivelse]=useState("");
  const [mål,setMål]=useState<any>(500);
  const [kategori,setKategori]=useState("scenekunst");
  const [sakId,setSakId]=useState("");
  const [status,setStatus]=useState<any>(null);
  const send=async()=>{
    if(!tittel.trim()||!beskrivelse.trim()){setStatus("Fyll ut både tittel og beskrivelse.");return;}
    setStatus("sender");
    const {error}=await sb.from("kampanjer").insert({
      tittel:tittel.trim(),
      beskrivelse:beskrivelse.trim(),
      mal:Number(mål)||500,
      kategori,
      sak_id:sakId||null,
      tags:[],
      dager:30,
      aktiv:false, // venter på godkjenning
    });
    if(error){setStatus("Noe gikk galt: "+error.message);return;}
    setStatus("sendt");
  };
  return (
    <Dialog tittel="Start en kampanje" onClose={onClose} smal>
      {!user&&(
        <p className="kv-brod">Du må være innlogget for å starte en kampanje.</p>
      )}
      {user&&status==="sendt"&&(
        <div className="kv-stakk">
          <p className="kv-brod">Kampanjen er sendt til godkjenning. Den vises når den er gjennomgått.</p>
          <Knapp variant="linje" onClick={onClose}>Lukk</Knapp>
        </div>
      )}
      {user&&status!=="sendt"&&(
        <div className="kv-stakk">
          <p className="kv-brod">Kampanjen kan knyttes til en åpen sak. Den blir synlig etter gjennomgang.</p>
          <Felt id="start-tittel" label="Tittel" value={tittel} onChange={e=>setTittel(e.target.value)} maxLength={90} />
          <Tekstfelt id="start-beskrivelse" label="Hva gjelder det?" value={beskrivelse} onChange={e=>setBeskrivelse(e.target.value)} maxLength={600} placeholder="Beskriv saken, hvem som rammes, og hva dere krever." />
          <div className="kv-rutenett">
            <Felt id="start-mal" label="Signaturmål" type="number" min={50} value={mål} onChange={e=>setMål(e.target.value)} />
            <Velger id="start-fag" label="Fagområde" value={kategori} onChange={e=>setKategori(e.target.value)}>
              {KATEGORIER.map(k=><option key={k.id} value={k.id}>{k.label}</option>)}
            </Velger>
          </div>
          <Velger id="start-sak" label="Politisk sak, valgfritt" value={sakId} onChange={e=>setSakId(e.target.value)}>
            <option value="">Ingen tilknytning</option>
            {varslerData.map(v=><option key={v.id} value={v.id}>{v.tittel.slice(0,70)}</option>)}
          </Velger>
          {status&&status!=="sender"&&<p className="kv-feil" role="alert">{status}</p>}
          <Knapp onClick={send} disabled={status==="sender"}>{status==="sender"?"Sender":"Send til godkjenning"}</Knapp>
        </div>
      )}
    </Dialog>
  );
}

function BrukerKampanjer({kampanjerData=KAMPANJER,varslerData=VARSLER,user=null}:{kampanjerData?:any[];varslerData?:any[];user?:any}) {
  const [valgt,setValgt]=useState<any>(null);
  const [showNy,setShowNy]=useState(false);
  const [sort,setSort]=useState("frist");
  const sorted=useMemo(()=>[...kampanjerData].sort((a,b)=>{
    if(sort==="frist") return a.dager-b.dager;
    if(sort==="fremgang") return (b.sig/b.mal)-(a.sig/a.mal);
    if(sort==="signaturer") return b.sig-a.sig;
    return 0;
  }),[sort,kampanjerData]);
  return (
    <div className="kv-stakk">
      <div className="kv-klynge mellom">
        <div>
          <p className="kv-feltnavn">Sorter</p>
          <Enkeltvalg
            valg={[{id:"frist",label:"Frist"},{id:"fremgang",label:"Fremgang"},{id:"signaturer",label:"Signaturer"}]}
            valgt={sort}
            onVelg={setSort}
          />
        </div>
        <Knapp onClick={()=>setShowNy(true)}>Start kampanje</Knapp>
      </div>
      {showNy&&<StartKampanjeModal onClose={()=>setShowNy(false)} user={user} varslerData={varslerData}/>}
      <div className="kv-rutenett">
        {sorted.map(k=>{
          const relSak=k.sakId?varslerData.find(v=>v.id===k.sakId):null;
          return (
            <KampanjeKort
              key={k.id}
              k={k}
              user={user}
              relSak={relSak}
              onÅpneSak={relSak?()=>setValgt(relSak):undefined}
            />
          );
        })}
      </div>
      {sorted.length===0&&<p className="kv-tom">Ingen åpne kampanjer.</p>}
      {valgt&&<SaksModal sak={valgt} onClose={()=>setValgt(null)} kampanjer={kampanjerData}/>}
    </div>
  );
}

type Mal = { id: string; label: string; tekst: (arg?: any) => string };
const MAL_TEMPLATES: Record<string, Mal[]> = {
  komite: [
    { id:"generell", label:"Generell henvendelse", tekst:(komite)=>`Til ${komite},\n\nVi representerer kulturfeltet og ønsker å gjøre komiteen oppmerksom på en sak vi mener fortjener politisk oppmerksomhet.\n\n[Beskriv saken og hvilken beslutning som nærmer seg]\n\nVi ber komiteen om å:\n1. [Konkret krav 1]\n2. [Konkret krav 2]\n3. [Konkret krav 3]\n\nVi stiller gjerne til møte eller kan sende ytterligere dokumentasjon.\n\nMed vennlig hilsen,\n[Navn]\n[Organisasjon]\n[Telefon / e-post]` },
    { id:"budsjett", label:"Budsjettbekymring", tekst:(komite)=>`Til ${komite},\n\nVi skriver til dere med alvorlig bekymring for kulturbudsjettets utvikling.\n\nDe foreslåtte kuttene vil ramme:\n- [Felt 1] med ca. [beløp/prosent]\n- [Felt 2] med ca. [beløp/prosent]\n\nDette vil i praksis bety at [beskriv konsekvens for feltet].\n\nVi ber komiteen om å sikre at budsjettrammen for kulturfeltet som minimum prisjusteres, og at øremerkede midler til [fagfelt] ikke slås sammen med generelle kulturmidler.\n\nMed vennlig hilsen,\n[Navn / Organisasjon]` },
    { id:"horing", label:"Be om utvidet høring", tekst:(komite)=>`Til ${komite},\n\nVi ber komiteen vurdere å utvide høringen i saken om [sakstittel].\n\nBakgrunnen for vår henvendelse er at:\n- Høringsfristen er for kort til at mindre organisasjoner kan utarbeide gode svar\n- Viktige fagmiljøer er ikke direkte varslet\n- Konsekvensene for [fagfelt] er ikke tilstrekkelig utredet\n\nVi ber om at fristen forlenges til [dato] og at følgende organisasjoner inviteres særskilt:\n[Liste]\n\nMed vennlig hilsen,\n[Navn / Organisasjon]` },
  ],
  politiker: [
    { id:"generell", label:"Generell henvendelse", tekst:(p)=>`Hei ${p.navn},\n\nJeg kontakter deg som ${p.rolle} fordi jeg ønsker å sette fokus på en sak jeg mener er viktig for kulturfeltet.\n\n[Beskriv saken kort og konkret]\n\nJeg håper du vil:\n- Følge med på denne saken\n- Ta initiativ til [handling]\n- Svare på dette brevet\n\nJeg er tilgjengelig for en prat om du ønsker mer informasjon.\n\nMed vennlig hilsen,\n[Ditt navn]\n[Organisasjon]\n[Telefon]` },
    { id:"støtte", label:"Be om støtte til sak", tekst:(p)=>`Hei ${p.navn},\n\nJeg skriver til deg fordi [saksnavn] nå er til behandling, og vi trenger politisk støtte.\n\nSaken handler om [kort beskrivelse]. Uten handling vil konsekvensen være:\n- [Konsekvens 1]\n- [Konsekvens 2]\n\nDet vi konkret ber deg om er:\n1. Å ta opp saken i [komité / kommunestyre / bystyret]\n2. Å stemme for [forslag] når saken kommer til votering\n3. Å gi oss tilbakemelding på din posisjon\n\nMed vennlig hilsen,\n[Navn / Organisasjon]` },
    { id:"spørretime", label:"Be om spørsmål i Stortinget", tekst:(p)=>`Hei ${p.navn},\n\nVi ber deg vurdere å stille et skriftlig eller muntlig spørsmål til kulturministeren om følgende:\n\n«[Formuler spørsmålet]»\n\nBakgrunnen er [kort forklaring]. Saken er ikke tilstrekkelig belyst i offentligheten, og et stortingsspørsmål vil bidra til nødvendig transparens.\n\nVi kan bistå med faktagrunnlag og bakgrunnsdokumentasjon.\n\nMed vennlig hilsen,\n[Navn / Organisasjon]` },
    { id:"takk", label:"Takkebrev etter positiv handling", tekst:(p)=>`Hei ${p.navn},\n\nVi vil gjerne takke deg for [hva politikeren gjorde].\n\nDin handling betyr mye for [fagfelt / kulturliv i region]. Vi setter stor pris på at du lytter til kulturfeltet og tar ansvar.\n\nVi ser frem til å følge deg videre og vil gjerne holde deg oppdatert på utviklingen.\n\nMed vennlig hilsen,\n[Navn / Organisasjon]` },
  ],
  horing: [
    { id:"standard", label:"Standard høringssvar", tekst:(sak)=>`Høringssvar – ${sak?.tittel||"[Sakstittel]"}\n\nFra: [Organisasjonsnavn]\nTil: ${sak?.instans||"[Instans]"}\nDato: ${new Date().toLocaleDateString("no-NO")}\n\n1. INNLEDNING\n[Organisasjonen] er en [beskriv organisasjonen] med [antall] medlemmer. Vi har fulgt denne saken nøye og ønsker å bidra med våre innspill.\n\n2. SAMMENDRAG AV VÅR POSISJON\n[To til tre setninger som oppsummerer hva dere mener]\n\n3. BAKGRUNN OG KONTEKST\n[Beskriv relevant bakgrunn]\n\n4. VÅR VURDERING\n4.1 [Tema 1]\n[Vurdering]\n\n4.2 [Tema 2]\n[Vurdering]\n\n5. KONKLUSJON OG ANBEFALINGER\nPå bakgrunn av ovenstående anbefaler vi:\n- [Anbefaling 1]\n- [Anbefaling 2]\n- [Anbefaling 3]\n\nMed vennlig hilsen,\n[Navn, tittel]\n[Organisasjon]\n[Kontaktinfo]` },
    { id:"kort", label:"Kort høringssvar (1 side)", tekst:(sak)=>`Høringssvar – ${sak?.tittel||"[Sakstittel]"}\n${sak?.instans||"[Instans]"} · ${new Date().toLocaleDateString("no-NO")}\n\nFra: [Organisasjon]\n\nVi støtter / vi støtter ikke [forslaget] av følgende grunner:\n\n[3–5 kortfattede punkter med begrunnelse]\n\nVår anbefaling er at [instans] [gjør X]. Vi ber om at innspillet tas med i den videre behandlingen.\n\n[Navn / Organisasjon]` },
    { id:"faglig", label:"Faglig/teknisk høringssvar", tekst:(sak)=>`Faglig høringssvar – ${sak?.tittel||"[Sakstittel]"}\n\nOrganisasjon: [Navn]\nDato: ${new Date().toLocaleDateString("no-NO")}\nKontaktperson: [Navn, tittel, e-post]\n\nDEL 1: FAGLIG VURDERING\n[Grundig faglig analyse av forslaget]\n\nDEL 2: KONSEKVENSANALYSE\nØkonomiske konsekvenser: [vurdering]\nKvalitetsmessige konsekvenser: [vurdering]\nStrukturelle konsekvenser: [vurdering]\n\nDEL 3: ALTERNATIVE LØSNINGER\n[Beskriv alternativer som kan løse problemet bedre]\n\nDEL 4: KONKLUSJON\n[Tydelig konklusjon med konkrete anbefalinger]\n\n[Navn / Organisasjon]` },
    { id:"protest", label:"Protestsvar / sterk motstand", tekst:(sak)=>`Høringssvar med sterke innvendinger\n\nSak: ${sak?.tittel||"[Sakstittel]"}\nFra: [Organisasjon]\nDato: ${new Date().toLocaleDateString("no-NO")}\n\n[Organisasjonen] protesterer på det sterkeste mot det foreslåtte [tiltaket/kuttet/vedtaket].\n\nÅrsakene er:\n1. [Sterk innvending 1 med faktagrunnlag]\n2. [Sterk innvending 2 med faktagrunnlag]\n3. [Sterk innvending 3 med faktagrunnlag]\n\nForslaget er i strid med [lov/avtale/tidligere vedtak] og vil ha alvorlige konsekvenser for [hvem].\n\nVi krever at forslaget [trekkes / endres vesentlig / sendes tilbake for ny utredning].\n\n[Navn / Organisasjon]` },
  ],
  pressem: [
    { id:"standard", label:"Standard pressemelding", tekst:()=>`PRESSEMELDING\n[Sted], ${new Date().toLocaleDateString("no-NO")}\n\nOVERSKRIFT: [Feng tittel som beskriver saken]\n\nINGRESS: [Én til to setninger som oppsummerer det viktigste]\n\nBRODTEKST:\n[Organisasjon] reagerer på [sak/vedtak/forslag] og krever at [hvem] [gjør hva].\n\n[Sitat fra leder eller talsperson, 1–2 setninger]\n\nBakgrunn:\n[2–3 avsnitt med fakta og kontekst]\n\nKONTAKT:\nNavn: [Navn]\nTittel: [Tittel]\nTelefon: [Nummer]\nE-post: [Adresse]\n\n###` },
    { id:"seier", label:"Pressemelding, positiv sak", tekst:()=>`PRESSEMELDING\n${new Date().toLocaleDateString("no-NO")}\n\n[Tittel]\n\n[Organisasjon] registrerer at [beslutning] nå er [fattet].\n\n«[Sitat]», sier [navn og tittel].\n\nDette betyr at [konsekvens for feltet].\n\nBakgrunn: [Kort historikk]\n\nKontakt:\n[Kontaktinfo]\n\n###` },
  ],
  sosiale: [
    { id:"facebook", label:"Facebook-innlegg", tekst:(sak)=>`${sak?.tittel||"[Sakstittel]"}\n\n${sak?.sammendrag||"[Kort beskrivelse av saken]"}\n\nFrist: ${sak?.frist?new Date(sak.frist).toLocaleDateString("no-NO"):"[dato]"}.${sak?.dager!=null?` ${sak.dager} dager igjen.`:""}\n\nLes saken: ${sak?.id?`https://kulturvarsling.no/sak/${sak.id}`:"https://kulturvarsling.no"}` },
    { id:"twitter", label:"Kort melding", tekst:(sak)=>`${sak?.tittel||"[Sakstittel]"}: ${(sak?.sammendrag||"[Beskrivelse]").slice(0,120)}\n\nFrist om ${sak?.dager??"X"} dager. Behandles av ${sak?.instans||"[instans]"}.\n\nLes saken: https://kulturvarsling.no/sak/${sak?.id||""}` },
    { id:"instagram", label:"Bildetekst", tekst:(sak)=>`${sak?.tittel||"[Sakstittel]"}\n\n${sak?.sammendrag||"[Beskrivelse]"}\n\n${sak?.dager!=null?`${sak.dager} dager igjen.`:"Fristen står i saken."}\n\nLes saken: https://kulturvarsling.no` },
  ],
};

function MalModal({type, kontekst, onClose, onSend=()=>{}, user=null}:{type:string;kontekst:any;onClose:()=>void;onSend?:(entry:any)=>void;user?:any}) {
  function applyUserFill(txt) {
    if(!user) return txt;
    const org = user.org||user.navn||"";
    const navn = user.navn||"";
    const epost = user.epost||"";
    return txt
      .replace(/\[Organisasjonsnavn\]/g, org)
      .replace(/\[Organisasjonen\]/g, org)
      .replace(/\[Organisasjon\]/g, org)
      .replace(/\[Ditt navn\]/g, navn)
      .replace(/\[Navn, tittel\]/g, navn)
      .replace(/\[Navn \/ Organisasjon\]/g, navn+(org?" / "+org:""))
      .replace(/\[Navn\]/g, navn)
      .replace(/\[E-post \/ telefon\]/g, epost)
      .replace(/\[Kontaktinfo\]/g, epost);
  }
  const maler = MAL_TEMPLATES[type]||[];
  const [valgtMal, setValgtMal] = useState(maler[0]?.id||"");
  const [tekst, setTekst] = useState("");
  const [sendt, setSendt] = useState(false);
  const [kopiert, setKopiert] = useState(false);
  const currentMal = maler.find(m=>m.id===valgtMal);

  useEffect(()=>{
    if(currentMal) {
      let t="";
      if(type==="komite") t=currentMal.tekst(kontekst?.navn||"Familie- og kulturkomiteen");
      else if(type==="politiker") t=currentMal.tekst(kontekst||{navn:"[Politikernavn]"});
      else t=currentMal.tekst(kontekst);
      setTekst(applyUserFill(t));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  function velgMal(id) {
    setValgtMal(id);
    const mal = maler.find(m=>m.id===id);
    if(!mal) return;
    let t="";
    if(type==="komite") t=mal.tekst(kontekst?.navn||"Familie- og kulturkomiteen");
    else if(type==="politiker") t=mal.tekst(kontekst||{navn:"[Politikernavn]"});
    else t=mal.tekst(kontekst);
    setTekst(applyUserFill(t));
    setSendt(false);
  }

  const titler: Record<string,string> = {komite:"Kontakt komité",politiker:"Kontakt politiker",horing:"Skriv høringssvar",pressem:"Pressemelding",sosiale:"Sosiale medier"};
  const sendLabel: Record<string,string> = {komite:"Send til komiteen",politiker:`Send til ${kontekst?.navn||"politikeren"}`,horing:"Send høringssvar",pressem:"Kopier og send til media",sosiale:"Kopier tekst"};
  const canSend = ["komite","politiker","horing"].includes(type);

  return (
    <Dialog tittel={titler[type]||"Mal"} onClose={onClose}>
      {kontekst&&(type==="komite"||type==="politiker")&&(
        <p className="kv-meta">{kontekst.navn}{kontekst.rolle?` · ${kontekst.rolle}`:""}{kontekst.kontakt?` · ${kontekst.kontakt}`:""}</p>
      )}
      <p className="kv-feltnavn">Mal</p>
      <Enkeltvalg valg={maler} valgt={valgtMal} onVelg={velgMal} />
      <p className="kv-meta">Tekst i klammer skal byttes ut. {user?.org?"Navn og kontakt er hentet fra profilen.":""}</p>
      {sendt ? (
        <div className="kv-stakk">
          <p className="kv-brod">Meldingen er registrert.</p>
          <Knapp variant="linje" onClick={()=>setSendt(false)}>Skriv ny melding</Knapp>
        </div>
      ) : (
        <div className="kv-stakk">
          <textarea className="kv-input" value={tekst} onChange={e=>setTekst(e.target.value)} rows={16} aria-label="Melding" />
          <div className="kv-klynge">
            {canSend&&(
              <Knapp onClick={()=>{
                setSendt(true);
                onSend({type,tittel:`${type==="horing"?"Høringssvar":type==="komite"?"Komitéhenvendelse":"Politikerkontakt"}: ${kontekst?.tittel||kontekst?.navn||"Ukjent"}`,mottaker:kontekst?.kontakt||kontekst?.navn||null});
              }}>
                {sendLabel[type]}
              </Knapp>
            )}
            <Knapp variant="linje" onClick={()=>{navigator.clipboard?.writeText(tekst);setKopiert(true);setTimeout(()=>setKopiert(false),2000);}}>
              {kopiert?"Kopiert":"Kopier tekst"}
            </Knapp>
            {type==="politiker"&&kontekst?.kontakt&&(
              <Knapp variant="linje" onClick={()=>window.open(`mailto:${kontekst.kontakt}?body=${encodeURIComponent(tekst)}`)}>Åpne i e-post</Knapp>
            )}
          </div>
          <p className="kv-meta">{tekst.length} tegn. {Math.max(0, tekst.split(/\[.*?\]/).length-1)} felt i klammer står igjen.</p>
        </div>
      )}
    </Dialog>
  );
}

const KOMITEER_DATA = [
  {id:"familie", navn:"Familie- og kulturkomiteen", kontakt:"familie-og-kulturkomiteen@stortinget.no", leder:"Knut Storberget (Ap)", felt:["Scenekunst","Musikk","Dans","Opera","Film","Litteratur","Visuell kunst","Museer","Spill","Kulturarv"], url:"https://www.stortinget.no/no/Representanter-og-komiteer/Komiteene/Familie-og-kulturkomiteen/"},
  {id:"finans",  navn:"Finanskomiteen",              kontakt:"finanskomiteen@stortinget.no",           leder:"Marianne Lunde (H)",   felt:["Budsjett","Tilskudd","Skatt"], url:"https://www.stortinget.no/no/Representanter-og-komiteer/Komiteene/Finanskomiteen/"},
  {id:"naering", navn:"Næringskomiteen",              kontakt:"naeringskomiteen@stortinget.no",         leder:"Geir Pollestad (Sp)",  felt:["Spill","Film","Kultureksport"], url:"https://www.stortinget.no/no/Representanter-og-komiteer/Komiteene/Naeringskomiteen/"},
  {id:"utd",     navn:"Utdannings- og forskningskomiteen", kontakt:"utdanning@stortinget.no",          leder:"Iselin Nybø (V)",      felt:["Museer","Kulturarv","Arkiver"], url:"https://www.stortinget.no/no/Representanter-og-komiteer/Komiteene/Utdannings-og-forskningskomiteen/"},
];

function BrukerMobiliser({loggAktivitet=()=>{},user=null,varslerData=[],kampanjerData=[]}:{loggAktivitet?:(entry:any)=>void;user?:any;varslerData?:any[];kampanjerData?:any[]}) {
  const [tab,setTab]=useState("oversikt");
  const [malModal,setMalModal]=useState<any>(null);
  const handlinger=[
    {tittel:"Kontakt stortingskomité",tekst:"Familie- og kulturkomiteen behandler de fleste kultursaker. Åpner en brevmal.",type:"komite"},
    {tittel:"Skriv til en politiker",tekst:"Henvendelse med mal til en politiker.",type:"politiker_oversikt"},
    {tittel:"Send høringssvar",tekst:"Formelt innspill til en åpen sak.",type:"horing_oversikt"},
    {tittel:"Skriv pressemelding",tekst:"Mal for pressemelding.",type:"pressem"},
    {tittel:"Del på sosiale medier",tekst:"Tekst til deling, med tittel, sammendrag og frist.",type:"sosiale"},
    {tittel:"Signer kampanjer",tekst:`${kampanjerData.length} åpne kampanjer.`,type:"kampanje"},
  ];
  function åpneHandling(type: string){
    if(type==="komite") setMalModal({type:"komite",kontekst:KOMITEER_DATA[0]});
    else if(type==="politiker_oversikt") setTab("politikere");
    else if(type==="horing_oversikt") setTab("horinger");
    else if(type==="pressem") setMalModal({type:"pressem",kontekst:null});
    else if(type==="sosiale") setMalModal({type:"sosiale",kontekst:varslerData[0]??null});
    else if(type==="kampanje") setTab("oversikt");
  }
  const kritisk = varslerData.filter(v=>v.status==="kritisk");

  return (
    <div className="kv-stakk">
      {malModal&&<MalModal type={malModal.type} kontekst={malModal.kontekst} user={user} onClose={()=>setMalModal(null)} onSend={(entry)=>loggAktivitet(entry)}/>}
      <Faner
        faner={[
          {id:"oversikt",label:"Oversikt"},
          {id:"komiteer",label:"Komiteer"},
          {id:"politikere",label:"Politikere"},
          {id:"horinger",label:"Høringer"},
        ]}
        valgt={tab}
        onVelg={setTab}
      />

      {tab==="oversikt"&&(
        <div className="kv-stakk">
          {kritisk.length>0&&(
            <section>
              <h2 className="kv-undertittel">Saker med status kritisk</h2>
              <ul className="kv-liste">
                {kritisk.map(v=>(
                  <li key={v.id} className="kv-rad">
                    <p>{v.tittel}</p>
                    <p className="kv-meta">{v.instans} · {v.dager} dager igjen</p>
                    <div className="kv-klynge">
                      <Knapp variant="linje" onClick={()=>setMalModal({type:"horing",kontekst:v})}>Skriv innspill</Knapp>
                      <Knapp variant="linje" onClick={()=>setTab("politikere")}>Kontakt politiker</Knapp>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <ul className="kv-liste">
            {handlinger.map(c=>(
              <li key={c.type} className="kv-rad">
                <button type="button" className="kv-knapp stille" onClick={()=>åpneHandling(c.type)}>{c.tittel}</button>
                <p className="kv-meta">{c.tekst}</p>
              </li>
            ))}
          </ul>
          {kampanjerData.length>0&&(
            <section>
              <h2 className="kv-undertittel">Åpne kampanjer</h2>
              <div className="kv-rutenett">
                {kampanjerData.map(k=><KampanjeKort key={k.id} k={k} user={user}/>)}
              </div>
            </section>
          )}
        </div>
      )}

      {tab==="komiteer"&&(
        <div>
          <p className="kv-brod">Åpne brevmal for en komité. Saker i arkivet kan knyttes til riktig komité derfra.</p>
          <ul className="kv-liste">
            {KOMITEER_DATA.map(k=>(
              <li key={k.id} className="kv-rad">
                <h3 className="kv-undertittel">{k.navn}</h3>
                <p className="kv-meta">Leder: {k.leder}</p>
                <p className="kv-meta">{k.kontakt}</p>
                <p><a className="kv-lenke" href={k.url} target="_blank" rel="noreferrer">Stortinget</a></p>
                <p className="kv-brod">{k.felt.join(", ")}</p>
                <Knapp variant="linje" onClick={()=>setMalModal({type:"komite",kontekst:k})}>Åpne brev</Knapp>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab==="politikere"&&(
        <p className="kv-brod">Liste over politikere kommer.</p>
      )}

      {tab==="horinger"&&(
        <div className="kv-stakk">
          <p className="kv-brod">Velg en sak og skriv et høringssvar, eller del teksten.</p>
          {varslerData.length===0&&<p className="kv-tom">Ingen åpne saker.</p>}
          <ul className="kv-liste">
            {varslerData.map(v=>(
              <li key={v.id} className="kv-rad">
                <p className="kv-meta">{metaLinje([katNavn(v.kategori), nivaaNavn(v.nivå, v.sted), fristEtikett(v), v.instans])}</p>
                <h3 className="kv-undertittel">{v.tittel}</h3>
                <p className="kv-brod">{v.sammendrag}</p>
                <div className="kv-klynge">
                  <a className="kv-lenke" href={v.kilde} target="_blank" rel="noreferrer">Les saken</a>
                  <Knapp variant="linje" onClick={()=>setMalModal({type:"horing",kontekst:v})}>Skriv høringssvar</Knapp>
                  <Knapp variant="linje" onClick={()=>setMalModal({type:"sosiale",kontekst:v})}>Del</Knapp>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PremiumVerktøy({varslerData=[],user=null}:{varslerData?:any[];user?:any}) {
  const [tool,setTool]=useState("budsjett");
  const [nivå,setNivå]=useState("kommune");
  const [kommuner,setKommuner]=useState<any[]>([]);
  const [valgtKommune,setValgtKommune]=useState("");
  const [valgtFylke,setValgtFylke]=useState(user?.fylkesnr||"");
  const [resultat,setResultat]=useState<any>(null);
  const [loading,setLoading]=useState(false);
  const [feil,setFeil]=useState("");

  useEffect(()=>{
    let avbrutt=false;
    sb.functions.invoke("budsjett",{body:{list:true}}).then(({data})=>{
      if(!avbrutt&&data?.kommuner) setKommuner(data.kommuner);
    });
    return ()=>{avbrutt=true;};
  },[]);

  async function analyser(){
    let payload;
    if(nivå==="kommune"){ if(!valgtKommune) return; payload={kommunenr:valgtKommune}; }
    else if(nivå==="fylke"){ if(!valgtFylke) return; payload={fylkesnr:valgtFylke}; }
    else payload={nasjonalt:true};
    setLoading(true); setFeil(""); setResultat(null);
    const { data, error } = await sb.functions.invoke("budsjett",{body:payload});
    if(error||data?.feil){ setFeil(data?.feil||"Kunne ikke hente budsjettdata. Prøv igjen."); setLoading(false); return; }
    setResultat(data); setLoading(false);
  }

  return (
    <div className="kv-stakk">
      <Faner
        faner={[
          {id:"budsjett",label:"Budsjett"},
          {id:"trend",label:"Trender"},
          {id:"politikeraktivitet",label:"Politikeraktivitet"},
        ]}
        valgt={tool}
        onVelg={setTool}
      />

      {tool==="budsjett"&&(
        <div className="kv-stakk">
          <section className="kv-kort">
            <h2 className="kv-undertittel">Kulturbudsjett</h2>
            <p className="kv-brod">Tall fra SSB, KOSTRA eller nasjonalregnskapet. Tolkningsfeltet forklarer tallene som kommer tilbake.</p>
            <Enkeltvalg valg={NIVÅ_VALG} valgt={nivå} onVelg={(id)=>{setNivå(id);setResultat(null);}} />
            <div className="kv-klynge">
              {nivå==="kommune"&&(
                <Velger id="bud-kommune" label="Kommune" value={valgtKommune} onChange={e=>setValgtKommune(e.target.value)}>
                  <option value="">{kommuner.length?"Velg kommune":"Laster kommuner"}</option>
                  {kommuner.map(k=><option key={k.nr} value={k.nr}>{k.navn}</option>)}
                </Velger>
              )}
              {nivå==="fylke"&&(
                <Velger id="bud-fylke" label="Fylke" value={valgtFylke} onChange={e=>setValgtFylke(e.target.value)}>
                  <option value="">Velg fylke</option>
                  {FYLKER.map(f=><option key={f.nr} value={f.nr}>{f.navn}</option>)}
                </Velger>
              )}
              {nivå==="nasjonalt"&&<p className="kv-meta">Statens samlede kulturutgifter.</p>}
              <Knapp onClick={analyser} disabled={loading||(nivå==="kommune"&&!valgtKommune)||(nivå==="fylke"&&!valgtFylke)}>
                {loading?"Henter":"Analyser"}
              </Knapp>
            </div>
            {feil&&<p className="kv-feil" role="alert">{feil}</p>}
          </section>
          {loading&&<p className="kv-meta">Henter tall og tolkning.</p>}
          {resultat&&!loading&&(
            <div className="kv-stakk">
              <section>
                <h2 className="kv-undertittel">{resultat.kommune}: kulturøkonomi</h2>
                <ul className="kv-liste">
                  {resultat.nøkkeltall.map(n=>{
                    const siste=n.serie.filter(v=>v!=null).slice(-1)[0];
                    const forrige=n.serie.filter(v=>v!=null).slice(-2)[0];
                    const opp=siste!=null&&forrige!=null?siste-forrige:null;
                    const vsSnitt=siste!=null&&n.landssnitt!=null?siste-n.landssnitt:null;
                    return (
                      <li key={n.kode} className="kv-rad">
                        <p className="kv-meta">{n.navn}</p>
                        <p className="kv-tall">{siste??"—"} <span className="kv-meta">{n.enhet}</span></p>
                        <p className="kv-meta">
                          {opp!=null&&`${opp>0?"+":""}${Math.round(opp*10)/10} fra i fjor. `}
                          {vsSnitt!=null&&`Snitt ${n.landssnitt} (${vsSnitt>0?"+":""}${Math.round(vsSnitt*10)/10}).`}
                        </p>
                      </li>
                    );
                  })}
                </ul>
                <p className="kv-meta">Kilde: SSB {resultat.nivå==="nasjonalt"?"nasjonalregnskap (COFOG)":"KOSTRA"} · {resultat.aar[0]}–{resultat.aar[resultat.aar.length-1]}{resultat.cache?" · bufret":""}</p>
              </section>
              {resultat.tolkning&&(
                <section>
                  <p className="kv-steg">Tolkning</p>
                  <h3 className="kv-undertittel">{resultat.tolkning.overskrift}</h3>
                  {resultat.tolkning.skjulte_kutt&&(
                    <div>
                      <p className="kv-feltnavn">Skjulte kutt</p>
                      <p className="kv-brod">{resultat.tolkning.skjulte_kutt}</p>
                    </div>
                  )}
                  {resultat.tolkning.hovedtall&&(
                    <div>
                      <p className="kv-feltnavn">Tallene</p>
                      <p className="kv-brod">{resultat.tolkning.hovedtall}</p>
                    </div>
                  )}
                  {resultat.tolkning.hva_betyr_det&&(
                    <div>
                      <p className="kv-feltnavn">Hva det betyr</p>
                      <p className="kv-brod">{resultat.tolkning.hva_betyr_det}</p>
                    </div>
                  )}
                  {resultat.tolkning.sporsmaal_til_politikerne&&(
                    <div>
                      <p className="kv-feltnavn">Spørsmål</p>
                      <p className="kv-brod">{resultat.tolkning.sporsmaal_til_politikerne}</p>
                    </div>
                  )}
                  <Knapp variant="linje" onClick={()=>navigator.clipboard?.writeText(`${resultat.kommune} – kulturbudsjett\n\n${resultat.tolkning.overskrift}\n\n${resultat.tolkning.hovedtall}\n\n${resultat.tolkning.hva_betyr_det}\n\nSpørsmål: ${resultat.tolkning.sporsmaal_til_politikerne}`)}>Kopier</Knapp>
                </section>
              )}
            </div>
          )}
        </div>
      )}

      {tool==="trend"&&(
        <div>
          <h2 className="kv-undertittel">Saker per fagområde</h2>
          <ul className="kv-liste">
            {KATEGORIER.map(k=>{
              const n=varslerData.filter(v=>v.kategori===k.id).length;
              if(!n) return null;
              return <li key={k.id} className="kv-rad">{k.label}: {n}</li>;
            })}
          </ul>
          {varslerData.length===0&&<p className="kv-tom">Ingen saker i utvalget.</p>}
        </div>
      )}

      {tool==="politikeraktivitet"&&(
        <p className="kv-brod">Liste over politikere kommer.</p>
      )}
    </div>
  );
}

function VarselRegistreringModal({user,setUser,onClose,beOmInnlogging}: any) {
  const [epost,setEpost]=useState(user?.varselEpost||user?.epost||"");
  const [valgtKat,setValgtKat]=useState<string[]>(user?.fagfelt||user?.varselKat||[]);
  const [valgtNivå,setValgtNivå]=useState<string[]>(user?.varselNivå||["nasjonalt","fylke","kommune"]);
  const [frekvens,setFrekvens]=useState(user?.varselFrekvens||"daglig");
  const [lagret,setLagret]=useState(false);
  const [feil,setFeil]=useState("");
  const [lagrer,setLagrer]=useState(false);

  async function lagre() {
    if(!user?.id) {
      beOmInnlogging?.("Logg inn for å slå på varsler. Valget lagres på kontoen din.");
      return;
    }
    const geografisk = geografiskFraNivaa(valgtNivå, user?.geografisk||[]);
    const forrige = user;
    setFeil("");
    setUser(u=>({
      ...u, varselEpost:epost, varselKat:valgtKat, varselNivå:valgtNivå, varselFrekvens:frekvens,
      fagfelt:valgtKat, geografisk, varslerAktive:true,
    }));
    setLagrer(true);
    const ok = await lagreProfil(user.id, {
      epost, fagfelt: valgtKat, geografisk, varsel_frekvens: frekvens, varsler_aktive: true,
    });
    setLagrer(false);
    if(!ok) {
      setUser(forrige);
      setFeil("Kunne ikke lagre varslene. Prøv igjen.");
      return;
    }
    setLagret(true);
  }

  return (
    <Dialog tittel={lagret?"Varsler lagret":"E-postvarsler"} onClose={onClose} smal>
      {lagret?(
        <div className="kv-stakk">
          <p className="kv-brod">Valgene er lagret på {epost}. Ingenting sendes ut ennå.</p>
          <p className="kv-meta">Du kan endre innstillingene under Min profil.</p>
          <Knapp onClick={onClose}>Lukk</Knapp>
        </div>
      ):(
        <div className="kv-stakk">
          <p className="kv-brod">Varselet lagres på kontoen. Utsending er ikke startet.</p>
          <div>
            <p className="kv-feltnavn">Fagområde</p>
            <Flervalg valg={KATEGORIER} valgt={valgtKat} onToggle={(id)=>setValgtKat(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])} />
            <p className="kv-meta">Tomt utvalg betyr alle fagområder.</p>
          </div>
          <div>
            <p className="kv-feltnavn">Nivå</p>
            <Flervalg valg={NIVÅ_VALG} valgt={valgtNivå} onToggle={(id)=>setValgtNivå(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])} />
          </div>
          <div>
            <p className="kv-feltnavn">Frekvens</p>
            <Enkeltvalg valg={FREKVENS_VALG} valgt={frekvens} onVelg={setFrekvens} />
          </div>
          <Felt id="varsel-epost" label="E-postadresse for varsler" type="email" value={epost} onChange={e=>setEpost(e.target.value)} />
          {feil&&<p className="kv-feil" role="alert">{feil}</p>}
          <div className="kv-klynge">
            <Knapp className="vokse" onClick={lagre} disabled={!epost||lagrer}>{lagrer?"Lagrer":"Lagre varsler"}</Knapp>
            <Knapp variant="linje" onClick={onClose}>Senere</Knapp>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function SaksHistorikkSide({aktivitet=[],historiske=[]}:{aktivitet?:any[];historiske?:any[]}) {
  const [valgt,setValgt]=useState<any>(null);
  const arkivSaker = historiske.map(v=>({
    id:v.id, tittel:v.tittel, sammendrag:v.sammendrag, kategori:v.kategori,
    nivå:v.nivå||v.niva, sted:v.sted, kilde:v.kilde,
    utfall:"pågår",
    utfallTekst:"Fristen er passert og saken er arkivert. Utfallssporing (hva ble vedtatt?) er under utvikling — arkivet bygger datagrunnlaget.",
    avsluttet:v.frist||v.opprettet,
    hendelser:[
      {dato:v.opprettet?.slice(0,10)||v.frist,tekst:`Fanget opp av Kulturvarsling (${v.instans||"ukjent kilde"})`},
      ...(v.frist?[{dato:v.frist,tekst:"Fristen utløp"}]:[]),
    ],
  })).concat(SAK_HISTORIKK).sort((a,b)=>(b.avsluttet||"").localeCompare(a.avsluttet||""));
  const bidro = aktivitet.filter(a=>a.type==="horing"||a.type==="politiker").length;

  return (
    <div className="kv-stakk">
      <p className="kv-brod">Saker med passert frist, og saker uten frist som er eldre enn 90 dager.</p>
      {aktivitet.length>0&&<p className="kv-meta">Registrerte innspill i {bidro} saker.</p>}
      {arkivSaker.length===0&&<p className="kv-tom">Ingen arkiverte saker ennå. Saker flyttes hit når fristen er ute.</p>}
      <ul className="kv-liste">
        {arkivSaker.map(sak=>{
          const åpen=valgt===sak.id;
          const avsluttet = sak.avsluttet ? new Date(sak.avsluttet).toLocaleDateString("no-NO",{day:"numeric",month:"short",year:"numeric"}) : "";
          return (
            <li key={sak.id} className="kv-rad">
              <button type="button" className="kv-knapp stille" onClick={()=>setValgt(åpen?null:sak.id)}>{sak.tittel}</button>
              <p className="kv-meta">{metaLinje([UTFALL_NAVN[sak.utfall]||sak.utfall, katNavn(sak.kategori), nivaaNavn(sak.nivå, sak.sted), avsluttet])}</p>
              <p className="kv-brod">{sak.sammendrag}</p>
              {åpen&&(
                <div>
                  <p className="kv-steg">Utfall</p>
                  <p className="kv-brod">{sak.utfallTekst}</p>
                  <p className="kv-steg">Tidslinje</p>
                  {(sak.hendelser||[]).map((h,i)=>(
                    <div key={i} className="kv-rad">
                      <p className="kv-meta">{h.dato ? new Date(h.dato).toLocaleDateString("no-NO",{day:"numeric",month:"short",year:"numeric"}) : ""}</p>
                      <p>{h.tekst}</p>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PremiumModal({user,onClose,onLogin}:{user:any;onClose:()=>void;onLogin?:()=>void}) {
  const [plan,setPlan]=useState("monthly");
  const [loading,setLoading]=useState(false);
  const [feil,setFeil]=useState("");

  async function tilBetaling() {
    if(!user?.id){ setFeil("Du må være innlogget for å oppgradere."); return; }
    setLoading(true); setFeil("");
    const { data, error } = await sb.functions.invoke("stripe-checkout",{ body:{ interval: plan } });
    if(error||!data?.url){
      let msg = data?.error || "Kunne ikke starte betaling. Prøv igjen om litt.";
      try { const d = await error?.context?.json?.(); if(d?.error) msg = d.error; } catch { /* behold standardmelding */ }
      setFeil(msg); setLoading(false); return;
    }
    window.location.href = data.url;
  }

  return (
    <Dialog tittel="Premium" onClose={onClose} smal>
      <div className="kv-stakk">
        <p className="kv-brod">Sakene, det geografiske filteret og forklaringen er gratis. Premium er verktøyene under. Kortbetalingen går til Stripe.</p>
        <div className="kv-valg">
          <button type="button" aria-pressed={plan==="monthly"} onClick={()=>setPlan("monthly")}>{PREMIUM_MAANED_KR} kr/mnd</button>
          <button type="button" aria-pressed={plan==="yearly"} onClick={()=>setPlan("yearly")}>{PREMIUM_AAR_KR} kr/år, spar {sparProsentArlig()} %</button>
        </div>
        <ul>
          <li>Budsjettolkning</li>
          <li>Utkast til høringssvar</li>
          <li>Trender og eksport</li>
          <li>Fristkalender</li>
          <li>E-post ved kort frist</li>
        </ul>
        {feil&&(
          <p className="kv-feil" role="alert">
            {feil}{" "}
            {!user?.id&&onLogin&&<button type="button" className="kv-knapp stille" onClick={onLogin}>Logg inn</button>}
          </p>
        )}
        <Knapp className="bred" onClick={tilBetaling} disabled={loading}>
          {loading?"Åpner betalingssiden":"Til betaling"}
        </Knapp>
        <p className="kv-meta">Stripe tar imot kortet. Vi lagrer ikke kortnummeret.</p>
      </div>
    </Dialog>
  );
}

function KommuneLogin({setScreen,setKommune}) {
  const [epost,setEpost]=useState("");
  const [pw,setPw]=useState("");
  const [kom,setKom]=useState("Oslo");
  const kommuner=["Oslo","Bergen","Trondheim","Stavanger","Tromsø","Kristiansand","Drammen","Fredrikstad"];
  return (
    <div className="kv-skjerm">
      <div className="kv-ark smal">
        <h1 className="kv-tittel">Kulturvarsling</h1>
        <p className="kv-ingress">Innlogging for kommuner</p>
        <Velger id="kom-kommune" label="Kommune" value={kom} onChange={e=>setKom(e.target.value)}>
          {kommuner.map(k=><option key={k}>{k}</option>)}
        </Velger>
        <Felt id="kom-epost" label="Tjenstlig e-post" type="email" value={epost} onChange={e=>setEpost(e.target.value)} />
        <Felt id="kom-pw" label="Passord" type="password" value={pw} onChange={e=>setPw(e.target.value)} />
        <Knapp className="bred" onClick={()=>{setKommune({navn:"Saksbehandler Hansen",kommune:kom,epost});setScreen("kommune-app");}}>
          Logg inn som {kom} kommune
        </Knapp>
        <p className="kv-meta">Ikke registrert? Be om tilgang.</p>
        <Knapp variant="stille" onClick={()=>setScreen("bruker-app")}>Tilbake</Knapp>
      </div>
    </div>
  );
}

function KommuneApp({kommune,setScreen}) {
  const [view,setView]=useState("oversikt");
  const [høringer,setHøringer]=useState<any[]>(KOM_HØRINGER_INIT);
  const [visPubliser,setVisPubliser]=useState(false);
  const VIEWS=[
    {id:"oversikt",label:"Oversikt"},
    {id:"høringer",label:"Mine høringer"},
    {id:"svar",label:"Mottatte innspill"},
    {id:"statistikk",label:"Statistikk"},
  ];
  const totalVarslet=høringer.reduce((s,h)=>s+h.varslet,0);
  const totalSvar=høringer.reduce((s,h)=>s+h.svar,0);
  const titler: Record<string,string> = {oversikt:"Oversikt",høringer:"Mine høringer",svar:"Mottatte innspill",statistikk:"Statistikk og rapporter"};

  return (
    <div className="kv-skjerm">
      {visPubliser&&<PubliserModal onClose={()=>setVisPubliser(false)} onPubliser={h=>{setHøringer(p=>[{...h,id:p.length+1,publisert:new Date().toISOString().split("T")[0],status:"aktiv",svar:0,varslet:Math.floor(Math.random()*200)+50},...p]);setVisPubliser(false);setView("høringer");}}/>}
      <header className="avis-mast">
        <button type="button" className="avis-tittel" onClick={()=>setScreen("bruker-app")}>Kultur<span>varsling</span></button>
        <p className="avis-under">{kommune?.kommune}</p>
      </header>
      <nav className="avis-meny" aria-label="Kommune">
        <div className="avis-wrap">
          {VIEWS.map(v=>(
            <button type="button" key={v.id} className={view===v.id?"aktiv":undefined} onClick={()=>setView(v.id)}>{v.label}</button>
          ))}
          <button type="button" onClick={()=>setVisPubliser(true)}>Publiser høring</button>
        </div>
      </nav>
      <main className="avis-wrap avis-annet">
        <h1>{titler[view]}</h1>
        <p className="kv-meta">{kommune?.navn} · {kommune?.kommune}</p>
        {view==="oversikt"&&<KommuneOversikt høringer={høringer} totalVarslet={totalVarslet} totalSvar={totalSvar} setView={setView} setVisPubliser={setVisPubliser}/>}
        {view==="høringer"&&<KommuneHøringer høringer={høringer} setVisPubliser={setVisPubliser}/>}
        {view==="svar"&&<KommuneSvar/>}
        {view==="statistikk"&&<KommuneStatistikk høringer={høringer} totalVarslet={totalVarslet} totalSvar={totalSvar}/>}
      </main>
    </div>
  );
}

function KommuneOversikt({høringer,totalVarslet,totalSvar,setView,setVisPubliser}) {
  const aktive=høringer.filter(h=>h.status==="aktiv").length;
  const respons = `${Math.round(totalSvar/Math.max(1,totalVarslet)*100)} prosent`;
  const aktiveHøringer = høringer.filter(h=>h.status==="aktiv");
  return (
    <div className="kv-stakk">
      <ul className="kv-liste">
        <li className="kv-rad kv-klynge mellom"><span>Aktive høringer</span><span className="kv-tall">{aktive}</span></li>
        <li className="kv-rad kv-klynge mellom"><span>Aktører varslet</span><span className="kv-tall">{totalVarslet}</span></li>
        <li className="kv-rad kv-klynge mellom"><span>Innspill mottatt</span><span className="kv-tall">{totalSvar}</span></li>
        <li className="kv-rad kv-klynge mellom"><span>Responsrate</span><span className="kv-tall">{respons}</span></li>
      </ul>
      <section className="kv-kort">
        <h2 className="kv-undertittel">Publiser en høring</h2>
        <p className="kv-brod">Høringen kan legges ut til kulturaktører i valgt fagområde.</p>
        <Knapp onClick={()=>setVisPubliser(true)}>Publiser høring</Knapp>
      </section>
      <div className="kv-rutenett">
        <section>
          <h2 className="kv-undertittel">Aktive høringer</h2>
          {aktiveHøringer.length===0&&<p className="kv-tom">Ingen aktive høringer.</p>}
          {aktiveHøringer.map(h=><HøringRad key={h.id} h={h}/>)}
        </section>
        <section>
          <h2 className="kv-undertittel">Siste innspill</h2>
          <ul className="kv-liste">
            {KOM_SVAR_MOCK.slice(0,3).map(s=>(
              <li key={s.id} className="kv-rad">
                <p>{s.org}</p>
                <p className="kv-brod">{s.tekst}</p>
                <p className="kv-meta">{s.dato} · {s.status==="ny"?"Ny":"Lest"}</p>
              </li>
            ))}
          </ul>
          <Knapp variant="stille" onClick={()=>setView("svar")}>Se alle innspill</Knapp>
        </section>
      </div>
    </div>
  );
}

function HøringRad({h}) {
  return (
    <article className="kv-rad">
      <h3 className="kv-undertittel">{h.tittel}</h3>
      <p className="kv-meta">{metaLinje([katNavn(h.kategori), h.status==="aktiv"?"Aktiv":"Avsluttet", h.frist&&`Frist ${new Date(h.frist).toLocaleDateString("no-NO",{day:"numeric",month:"short"})}`, `${h.svar} svar`])}</p>
    </article>
  );
}

function KommuneHøringer({høringer,setVisPubliser}) {
  return (
    <div className="kv-stakk">
      <Knapp onClick={()=>setVisPubliser(true)}>Publiser høring</Knapp>
      {høringer.length===0&&<p className="kv-tom">Ingen høringer er publisert.</p>}
      <ul className="kv-liste">
        {høringer.map(h=>(
          <li key={h.id} className="kv-rad">
            <h3 className="kv-undertittel">{h.tittel}</h3>
            <p className="kv-meta">{metaLinje([katNavn(h.kategori), h.status==="aktiv"?"Aktiv":"Avsluttet", `Publisert ${h.publisert}`, `Frist ${h.frist}`])}</p>
            <p className="kv-brod">{h.varslet} aktører varslet. {h.svar} innspill. Respons {Math.round(h.svar/Math.max(1,h.varslet)*100)} prosent.</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function KommuneSvar() {
  const [valgtHøring,setValgtHøring]=useState("alle");
  const [svar,setSvar]=useState<any[]>(KOM_SVAR_MOCK.map(s=>({...s})));
  const [svarTekst,setSvarTekst]=useState<any>({});
  const [åpenSvar,setÅpenSvar]=useState<any>(null);
  const [sendt,setSendt]=useState<any>({});
  const TAGGER=["Støtte","Motstand","Nøytral","Detaljert","Kort","Forslag"];
  const [tags,setTags]=useState<any>({});
  const filtered=valgtHøring==="alle"?svar:svar.filter(s=>s.høringId===parseInt(valgtHøring));

  function merkLest(id){ setSvar(s=>s.map(x=>x.id===id?{...x,status:"lest"}:x)); }
  function sendSvar(id){
    setSendt(p=>({...p,[id]:true}));
    setÅpenSvar(null);
    merkLest(id);
  }
  function toggleTag(svId,t){ setTags(p=>({...p,[svId]:p[svId]?.includes(t)?p[svId].filter(x=>x!==t):[...(p[svId]||[]),t]})); }

  function eksporter(){
    const csv=["Org,Dato,Høring,Status,Tags,Tekst",...filtered.map(s=>`"${s.org}","${s.dato}","Høring #${s.høringId}","${s.status}","${(tags[s.id]||[]).join("|")}","${s.tekst.replace(/"/g,"'")}"`)].join("\n");
    const b=new Blob([csv],{type:"text/csv"});
    const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="innspill.csv";a.click();
  }

  const filterValg=[{id:"alle",label:"Alle"},...KOM_HØRINGER_INIT.map(h=>({id:String(h.id),label:h.tittel}))];

  return (
    <div className="kv-stakk">
      <div className="kv-klynge mellom">
        <Enkeltvalg valg={filterValg} valgt={valgtHøring} onVelg={setValgtHøring} />
        <Knapp variant="linje" onClick={eksporter}>Eksporter CSV</Knapp>
      </div>
      <p className="kv-meta">{filtered.length} innspill. {filtered.filter(s=>s.status==="ny").length} uleste.</p>
      <ul className="kv-liste">
        {filtered.map(s=>(
          <li key={s.id} className="kv-rad">
            <p>{s.org} <span className="kv-meta">{s.status==="ny"?"Ny":"Lest"}</span></p>
            <p className="kv-meta">Høring #{s.høringId} · {s.dato}</p>
            <p className="kv-brod">{s.tekst}</p>
            <div className="kv-valg">
              {TAGGER.map(t=>(
                <button type="button" key={t} aria-pressed={!!tags[s.id]?.includes(t)} onClick={()=>toggleTag(s.id,t)}>{t}</button>
              ))}
            </div>
            {åpenSvar===s.id?(
              <div>
                <Tekstfelt id={`svar-${s.id}`} label="Svar" rows={3} value={svarTekst[s.id]||""} onChange={e=>setSvarTekst(p=>({...p,[s.id]:e.target.value}))} placeholder={"Svar til "+s.org} />
                <div className="kv-klynge">
                  <Knapp onClick={()=>sendSvar(s.id)}>Send svar</Knapp>
                  <Knapp variant="linje" onClick={()=>setÅpenSvar(null)}>Avbryt</Knapp>
                </div>
              </div>
            ):sendt[s.id]?(
              <p className="kv-meta">Svar sendt til {s.org}.</p>
            ):(
              <div className="kv-klynge">
                <Knapp variant="linje" onClick={()=>setÅpenSvar(s.id)}>Svar på innspill</Knapp>
                {s.status==="ny"&&<Knapp variant="stille" onClick={()=>merkLest(s.id)}>Merk lest</Knapp>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function KommuneStatistikk({høringer,totalVarslet,totalSvar}) {
  const respons = Math.round(totalSvar/Math.max(1,totalVarslet)*100);
  return (
    <div className="kv-stakk">
      <p className="kv-brod">{totalVarslet} aktører nådd. {totalSvar} innspill mottatt. Responsrate {respons} prosent.</p>
      <h2 className="kv-undertittel">Per høring</h2>
      {høringer.length===0&&<p className="kv-tom">Ingen høringer å vise.</p>}
      <ul className="kv-liste">
        {høringer.map(h=>(
          <li key={h.id} className="kv-rad">
            <p>{h.tittel}</p>
            <p className="kv-meta">{h.svar} innspill. {h.varslet} varslet.</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PubliserModal({onClose,onPubliser}) {
  const [tittel,setTittel]=useState("");
  const [beskrivelse,setBeskrivelse]=useState("");
  const [frist,setFrist]=useState("");
  const [kategori,setKategori]=useState("scenekunst");
  const [steg,setSteg]=useState(1);

  function publiser() {
    onPubliser({tittel,beskrivelse,frist,kategori});
  }

  return (
    <Dialog tittel="Publiser høring" onClose={onClose}>
      <p className="kv-steg">Steg {steg} av 2</p>
      {steg===1&&(
        <div className="kv-stakk">
          <Felt id="pub-tittel" label="Tittel" value={tittel} onChange={e=>setTittel(e.target.value)} placeholder="Revisjon av tilskudd til lokale kulturlokaler" />
          <Tekstfelt id="pub-beskrivelse" label="Beskrivelse" value={beskrivelse} onChange={e=>setBeskrivelse(e.target.value)} rows={4} placeholder="Hva høringen handler om, og hva dere ønsker innspill på." />
          <Velger id="pub-fag" label="Fagområde" value={kategori} onChange={e=>setKategori(e.target.value)}>
            {KATEGORIER.map(k=><option key={k.id} value={k.id}>{k.label}</option>)}
          </Velger>
          <Felt id="pub-frist" label="Høringsfrist" type="date" value={frist} onChange={e=>setFrist(e.target.value)} />
          <Knapp onClick={()=>setSteg(2)} disabled={!tittel||!frist}>Neste</Knapp>
        </div>
      )}
      {steg===2&&(
        <div className="kv-stakk">
          <p className="kv-feltnavn">Forhåndsvisning</p>
          <h3 className="kv-undertittel">{tittel||"(ingen tittel)"}</h3>
          <p className="kv-brod">{beskrivelse||"(ingen beskrivelse)"}</p>
          <p className="kv-meta">{metaLinje([katNavn(kategori), frist&&`Frist ${new Date(frist).toLocaleDateString("no-NO",{day:"numeric",month:"short"})}`])}</p>
          <p className="kv-brod">Registrerte aktører i fagområdet {katNavn(kategori)} kan varsles om høringen.</p>
          <div className="kv-klynge">
            <Knapp variant="linje" onClick={()=>setSteg(1)}>Tilbake</Knapp>
            <Knapp onClick={publiser}>Publiser</Knapp>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export default function App() {
  const vis = forhandsvisning();
  const [screen,setScreen]=useState("bruker-app");
  const [user,setUser]=useState<any>(vis && vis !== "innlogging" ? FORHANDSBRUKER : null);
  const [kommune,setKommune]=useState<any>(null);
  const [sessionSjekket,setSessionSjekket]=useState(false);
  const [loginGrunn,setLoginGrunn]=useState("");
  function beOmInnlogging(grunn: any) {
    setLoginGrunn(grunn);
    setScreen("bruker-login");
  }

  useEffect(()=>{
    if (forhandsvisning()) {
      setSessionSjekket(true);
      return;
    }
    sb.auth.getSession().then(async ({data:{session}})=>{
      if(session?.user) {
        const profil = await hentProfil(session.user.id);
        setUser(brukerFraSesjon(session.user, profil));
      }
      setSessionSjekket(true);
    });

    const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
      if(event==="SIGNED_OUT" || !session) setUser(null);
    });
    return () => subscription.unsubscribe();
  },[]);

  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    const premium = params.get("premium");
    if(!premium) return;
    window.history.replaceState({}, "", window.location.pathname);
    if(premium==="avbrutt"){ showToast("Betalingen ble avbrutt","info"); return; }
    if(premium!=="suksess") return;
    showToast("Betaling mottatt – aktiverer Premium ...","info");
    let forsøk=0;
    const intervall=setInterval(async()=>{
      forsøk++;
      const {data:{session}}=await sb.auth.getSession();
      if(session?.user){
        const profil=await hentProfil(session.user.id);
        if(profil?.plan==="premium"){
          clearInterval(intervall);
          setUser(u=>u?{...u,plan:"premium"}:u);
          showToast("Premium er aktivert.","ok");
          return;
        }
      }
      if(forsøk>=10){
        clearInterval(intervall);
        showToast("Betalingen er registrert – logg ut og inn hvis Premium ikke vises","info");
      }
    },2000);
    return ()=>clearInterval(intervall);
  },[]);

  if(!sessionSjekket) return (
    <div className="kv-skjerm">
      <div className="kv-ark smal">
        <p className="kv-meta">Henter</p>
      </div>
    </div>
  );

  if(screen==="bruker-login")    return <><ToastContainer/><BrukerLogin setScreen={setScreen} setUser={setUser} grunn={loginGrunn}/></>;
  if(screen==="bruker-app")      return <><ToastContainer/><BrukerApp user={user} setUser={setUser} setScreen={setScreen} beOmInnlogging={beOmInnlogging}/></>;
  if(kommuneLoginSynlig && screen==="kommune-login") return <><ToastContainer/><KommuneLogin setScreen={setScreen} setKommune={setKommune}/></>;
  if(kommuneLoginSynlig && screen==="kommune-app")   return <><ToastContainer/><KommuneApp kommune={kommune} setScreen={setScreen}/></>;
  return <><ToastContainer/><BrukerApp user={user} setUser={setUser} setScreen={setScreen} beOmInnlogging={beOmInnlogging}/></>;
}
