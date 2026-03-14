import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Supabase klient ──────────────────────────────────────────────────────
// Bytt ut disse to verdiene med dine egne fra Supabase → Settings → API
const SUPABASE_URL  = "https://zyyijlvmgoanjdzngmon.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp5eWlqbHZtZ29hbmpkem5nbW9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNDI1NzMsImV4cCI6MjA4ODkxODU3M30.k2WWIg_7STiIOPSGojZ2zH_QCShvvSw8Ax0hk1yGjOI";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// ─── Hjelpefunksjoner ─────────────────────────────────────────────────────
async function lastVarsler() {
  const { data, error } = await sb.from("varsler")
    .select("*")
    .eq("publisert", true)
    .order("frist", { ascending: true });
  if (error) { console.error("Varsler-feil:", error); return null; }
  return data.map(v => ({
    ...v,
    nivå: v.niva,  // map db snake_case → app camelCase
    dager: v.dager ?? Math.max(0, Math.floor((new Date(v.frist) - new Date()) / 86400000))
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

async function lagreProfil(userId, oppdateringer) {
  const { error } = await sb.from("profiler")
    .update({ ...oppdateringer, oppdatert: new Date().toISOString() })
    .eq("id", userId);
  return !error;
}

async function toggleFølgSak(brukerId, sakId, følger) {
  if (følger) {
    await sb.from("fulgte_saker").delete()
      .eq("bruker_id", brukerId).eq("sak_id", sakId);
  } else {
    await sb.from("fulgte_saker").insert({ bruker_id: brukerId, sak_id: sakId });
  }
}

async function hentFulgte(brukerId) {
  const { data } = await sb.from("fulgte_saker")
    .select("sak_id").eq("bruker_id", brukerId);
  return (data ?? []).map(r => r.sak_id);
}

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
  await sb.from("feedback").insert({
    bruker_id: brukerId ?? null,
    type,
    tekst,
    sak_tittel: sakTittel ?? null
  });
}

// ─── Tokens ────────────────────────────────────────────────────────────────
const C = {
  red:"#8C1C13", redDark:"#5C1009", redLight:"#B02A20",
  bg:"#F6F3EF", bgAlt:"#EDE8E2", bgCard:"#FEFCFA",
  text:"#1A1512", muted:"#6B5F57", border:"#D9D0C7",
  green:"#1A6B3C", amber:"#A05C00", blue:"#1D4ED8", purple:"#7C3AED",
  komBg:"#F0F4FF", komBorder:"#C7D2FE", komBlue:"#1E3A8A",
};

// ─── Static data ────────────────────────────────────────────────────────────
const KATEGORIER = [
  {id:"scenekunst",label:"Scenekunst",ikon:"🎭"},{id:"musikk",label:"Musikk",ikon:"🎵"},
  {id:"dans",label:"Dans",ikon:"💃"},{id:"opera",label:"Opera",ikon:"🎼"},
  {id:"litteratur",label:"Litteratur",ikon:"📚"},{id:"film",label:"Film & TV",ikon:"🎬"},
  {id:"visuell",label:"Visuell kunst",ikon:"🖼️"},{id:"museer",label:"Museer",ikon:"🏛️"},
  {id:"spill",label:"Spill",ikon:"🎮"},{id:"kulturarv",label:"Kulturarv & bygg",ikon:"🏗️"},
];

const POLITIKERE = [
  {id:1,navn:"Anette Hansen",parti:"Ap",rolle:"Kulturbyråd",nivå:"kommune",sted:"Oslo",kategori:["scenekunst","musikk"],kontakt:"anette.hansen@oslo.kommune.no"},
  {id:2,navn:"Per Kristian Dahl",parti:"H",rolle:"Familie- og kulturkomiteen",nivå:"nasjonalt",sted:"Nasjonalt",kategori:["scenekunst","film"],kontakt:"pkdahl@stortinget.no"},
  {id:3,navn:"Silje Moe",parti:"SV",rolle:"Kulturpolitisk talsmann",nivå:"nasjonalt",sted:"Nasjonalt",kategori:["musikk","dans"],kontakt:"silje.moe@sv.no"},
];
const PARTIFARGE = {Ap:"#E4002B",H:"#0070C0",SV:"#E8003D",Sp:"#00843D",KrF:"#FBBC04",V:"#006D3B"};

const VARSLER = [];

const KAMPANJER = [];

const SAK_HISTORIKK = [];

// Bruker-aktivitet (sendte meldinger, signerte kampanjer, fulgte saker)
const AKTIVITET_INIT = [];

// Kommune mock-data
const KOM_HØRINGER_INIT = [];

const KOM_SVAR_MOCK = [];

// Budget texts for premium analysis mock
const BUDSJETT_ANALYSE_MOCK = `**Analyse av kulturbudsjettet**

**Overordnet bilde**
Budsjettet viser en nominell økning på 2,1 %, men justert for forventet prisvekst (3,4 %) er dette et reelt kutt på om lag 1,3 prosentpoeng. Kulturfeltet taper kjøpekraft for tredje år på rad.

**Nøkkelfunn**
- Frie midler til scenekunst reduseres med 4,2 mill kr (–8 %)
- Stipendordninger for visuelle kunstnere er uendret nominelt, men søkermassen har økt med 23 %
- Tilskudd til lokale musikklokaler er fjernet som egen post og slått sammen med bredere kulturpott
- Investeringsmidler til kulturbygg øker med 12 %, men er øremerket to navngitte prosjekter

**Risikopunkter**
⚠ Sammenslåingen av musikktilskudd skaper uforutsigbarhet og favoriserer større aktører
⚠ Ingen deflatorjustering er synlig i dokumentet – det bør etterlyses
⚠ Fleksibilitetsposten (15 mill) gir stor skjønnsmessig makt til administrasjonen

**Anbefalte tiltak**
Kulturfeltet bør kreve: (1) real-prisjusterte rammer, (2) gjeninnføring av øremerket musikktilskudd, (3) innsyn i kriteriene for fleksibilitetsposten.`;

// ─── Utility ──────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800;900&family=DM+Sans:wght@400;500;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  button{transition:all .15s;cursor:pointer}
  button:hover{opacity:.85}
  input:focus,textarea:focus,select:focus{border-color:#8C1C13!important;box-shadow:0 0 0 3px rgba(140,28,19,.1)!important;outline:none!important}
  ::-webkit-scrollbar{width:5px;height:5px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:#D9D0C7;border-radius:99px}
  a{text-decoration:none}
  .grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:900px){
    .grid-4{grid-template-columns:1fr 1fr!important}
    .grid-3{grid-template-columns:1fr 1fr!important}
  }
  @media(max-width:640px){
    .grid-4{grid-template-columns:1fr 1fr!important}
    .grid-3{grid-template-columns:1fr!important}
    .grid-2{grid-template-columns:1fr!important}
    .mob-hide{display:none!important}
    .mob-stack{flex-direction:column!important}
    .mob-full{max-width:100%!important;border-radius:14px 14px 0 0!important;position:fixed!important;bottom:0!important;top:auto!important;left:0!important;right:0!important}
    .nav-txt{display:none!important}
    .hero-side{display:none!important}
  }
`;

function Badge({children,color=C.red,bg,style={}}) {
  return <span style={{background:bg||color+"18",color,padding:"2px 9px",borderRadius:99,fontSize:11,fontWeight:700,whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:3,...style}}>{children}</span>;
}
function Btn({children,variant="primary",size="md",onClick,style={},disabled}) {
  const base = {border:"none",borderRadius:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,transition:"all .15s",...style};
  const variants = {
    primary:{background:C.red,color:"#fff",padding:size==="sm"?"7px 14px":size==="lg"?"14px 28px":"10px 20px",fontSize:size==="sm"?12:size==="lg"?16:14},
    secondary:{background:C.bgCard,color:C.text,border:`1.5px solid ${C.border}`,padding:size==="sm"?"7px 14px":size==="lg"?"14px 28px":"10px 20px",fontSize:size==="sm"?12:size==="lg"?16:14},
    ghost:{background:"none",color:C.red,border:`1.5px solid ${C.red}`,padding:size==="sm"?"7px 14px":"10px 20px",fontSize:size==="sm"?12:14},
    kom:{background:C.komBlue,color:"#fff",padding:size==="sm"?"7px 14px":size==="lg"?"14px 28px":"10px 20px",fontSize:size==="sm"?12:size==="lg"?16:14},
    premium:{background:"linear-gradient(135deg,#7C3AED,#4F46E5)",color:"#fff",padding:size==="sm"?"7px 14px":"10px 20px",fontSize:size==="sm"?12:14},
  };
  return <button style={{...base,...variants[variant],...style}} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Input({label,placeholder,value,onChange,type="text",rows}) {
  const s = {width:"100%",padding:"10px 14px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:14,color:C.text,background:C.bgCard,fontFamily:"inherit"};
  return (
    <div style={{marginBottom:14}}>
      {label&&<div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:".04em"}}>{label}</div>}
      {rows ? <textarea placeholder={placeholder} value={value} onChange={onChange} rows={rows} style={{...s,resize:"vertical",lineHeight:1.55}}/> : <input type={type} placeholder={placeholder} value={value} onChange={onChange} style={s}/>}
    </div>
  );
}
function Card({children,style={}}) {
  return <div style={{background:C.bgCard,border:`1px solid ${C.border}`,borderRadius:14,padding:"20px 22px",...style}}>{children}</div>;
}
function Progress({value,max,color=C.red}) {
  return (
    <div style={{background:C.bgAlt,borderRadius:99,height:6,overflow:"hidden"}}>
      <div style={{background:color,width:`${Math.min(100,Math.round(value/max*100))}%`,height:"100%",borderRadius:99,transition:"width .4s"}}/>
    </div>
  );
}
function StatusDot({status}) {
  const cfg={kritisk:"#DC2626",viktig:C.amber,normal:C.green}[status]||C.muted;
  return <span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:cfg,marginRight:5}}/>;
}
function NivåBadge({nivå,sted}) {
  const cfg={nasjonalt:[C.blue,"#DBEAFE"],fylke:[C.purple,"#EDE9FE"],kommune:[C.green,"#D1FAE5"]}[nivå]||[C.muted,C.bgAlt];
  return <Badge color={cfg[0]} bg={cfg[1]}>{nivå==="nasjonalt"?"🏛":nivå==="fylke"?"🗺":"📍"} {nivå==="nasjonalt"?"Nasjonalt":sted}</Badge>;
}

// ─── LANDING PAGE ─────────────────────────────────────────────────────────
function Landing({setScreen}) {
  const [valgt,setValgt]=useState(null);
const [varslerData, setVarslerData] = useState([]);
useEffect(()=>{
  sb.from("varsler").select("*")
    .then(({data})=>{ if(data) setVarslerData(data); });
},[]);
  const filtered = varslerData;
  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'DM Sans',sans-serif",color:C.text}}>
      <style>{css}</style>

      {/* Nav */}
      <nav style={{background:C.bgCard,borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,zIndex:100,boxShadow:"0 1px 8px rgba(0,0,0,.06)"}}>
        <div style={{maxWidth:1100,margin:"0 auto",padding:"0 24px",height:58,display:"flex",alignItems:"center",justifyContent:"space-between",gap:16}}>
          <div style={{display:"flex",alignItems:"center",gap:9,flexShrink:0}}>
            <div style={{width:30,height:30,background:C.red,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{color:"#fff",fontWeight:900,fontSize:15,fontFamily:"serif"}}>K</span>
            </div>
            <span style={{fontWeight:800,fontSize:15,fontFamily:"'Playfair Display',serif",color:C.redDark}}>Kulturvarsling.no</span>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button onClick={()=>setScreen("kommune-login")}
              style={{padding:"6px 14px",borderRadius:7,border:`1px solid ${C.komBorder}`,background:C.komBg,color:C.komBlue,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              🏛 Kommune
            </button>
            <Btn variant="secondary" size="sm" onClick={()=>setScreen("bruker-login")}>Logg inn</Btn>
            <Btn variant="primary" size="sm" onClick={()=>setScreen("bruker-login")}>Kom i gang gratis</Btn>
          </div>
        </div>
      </nav>

      {/* Hero – kompakt banner øverst */}
      <div style={{background:"#1A1512",color:"#fff"}}>
        <div style={{maxWidth:1100,margin:"0 auto",padding:"48px 24px 40px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:40,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:280}}>
            <div style={{display:"inline-flex",alignItems:"center",gap:7,background:"rgba(140,28,19,.3)",border:"1px solid rgba(140,28,19,.5)",borderRadius:99,padding:"4px 12px",marginBottom:18}}>
              <span style={{fontSize:11,color:"#FCA5A5",fontWeight:700,letterSpacing:".03em"}}>🔔 KI-DREVET VARSLINGSSYSTEM</span>
            </div>
            <h1 style={{fontSize:38,fontWeight:900,fontFamily:"'Playfair Display',serif",lineHeight:1.1,marginBottom:14,letterSpacing:"-.02em"}}>
              Aldri gå glipp av<br/>
              <span style={{color:"#FCA5A5"}}>en viktig kulturpolitisk sak</span>
            </h1>
            <p style={{fontSize:15,color:"rgba(255,255,255,.65)",lineHeight:1.65,marginBottom:22,maxWidth:480}}>
              Kulturvarsling samler og analyserer politiske prosesser – nasjonalt, regionalt og lokalt – og varsler deg før fristene løper ut.
            </p>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <Btn variant="primary" onClick={()=>setScreen("bruker-login")}>Registrer deg gratis →</Btn>
              <button style={{padding:"10px 18px",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.18)",borderRadius:9,color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                Se hvordan det fungerer ↓
              </button>
            </div>
          </div>
          {/* Mini-stats */}
          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
            {[
              {n:varslerData.length, lbl:"Aktive saker",ikon:"📋"},
              {n:varslerData.filter(v=>v.status==="kritisk").length, lbl:"Kritiske frister",ikon:"⚠️"},
              {n:"4 288", lbl:"Signaturer",ikon:"✍️"},
            ].map((s,i)=>(
              <div key={i} style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:12,padding:"14px 18px",textAlign:"center",minWidth:90}}>
                <div style={{fontSize:11,marginBottom:4}}>{s.ikon}</div>
                <div style={{fontSize:22,fontWeight:800,fontFamily:"'Playfair Display',serif"}}>{s.n}</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,.5)",marginTop:2}}>{s.lbl}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Feed */}
      <div style={{maxWidth:1100,margin:"0 auto",padding:"32px 24px"}}>

        {/* Siste varsler */}
        <div style={{marginBottom:36}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <h2 style={{fontSize:17,fontWeight:800,fontFamily:"'Playfair Display',serif",color:C.redDark}}>Siste varsler</h2>
            <Btn variant="secondary" size="sm" onClick={()=>setScreen("bruker-login")}>Se alle og filtrer →</Btn>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
            {varslerData.map(v=>{
              const ki=KATEGORIER.find(k=>k.id===v.kategori);
              const bc={kritisk:"#DC2626",viktig:"#D97706",normal:"#16A34A"}[v.status];
              return (
                <div key={v.id} onClick={()=>setValgt(v)}
                  style={{background:C.bgCard,border:`1px solid ${C.border}`,borderLeft:`4px solid ${bc}`,borderRadius:14,padding:"14px 16px",cursor:"pointer",transition:"box-shadow .15s"}}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow="0 4px 18px rgba(0,0,0,.1)"}
                  onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
                  <div style={{display:"flex",gap:5,marginBottom:7,flexWrap:"wrap"}}>
                    {ki&&<Badge color={C.muted} style={{fontSize:10}}>{ki.ikon} {ki.label}</Badge>}
                    <NivåBadge nivå={v.nivå} sted={v.sted}/>
                  </div>
                  <div style={{fontSize:13,fontWeight:700,lineHeight:1.3,marginBottom:4}}>{v.tittel}</div>
                  <div style={{fontSize:11,color:C.muted,lineHeight:1.4,marginBottom:8,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{v.sammendrag}</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:10,color:C.muted}}>{v.instans}</span>
                    <span style={{background:bc+"18",color:bc,padding:"2px 8px",borderRadius:99,fontSize:11,fontWeight:700}}>{v.dager}d igjen</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Aktive kampanjer */}
        <div style={{marginBottom:36}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <h2 style={{fontSize:17,fontWeight:800,fontFamily:"'Playfair Display',serif",color:C.redDark}}>Aktive kampanjer</h2>
            <Btn variant="secondary" size="sm" onClick={()=>setScreen("bruker-login")}>Signer og følg →</Btn>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
            {KAMPANJER.map(k=>(
              <div key={k.id} style={{background:C.bgCard,border:`1px solid ${C.border}`,borderRadius:14,padding:"16px 18px"}}>
                <div style={{display:"flex",gap:5,marginBottom:8,flexWrap:"wrap"}}>
                  {k.tags.map(t=><Badge key={t} color={C.muted} style={{fontSize:10}}>{t}</Badge>)}
                </div>
                <div style={{fontSize:13,fontWeight:700,marginBottom:10,lineHeight:1.3}}>{k.tittel}</div>
                <Progress value={k.sig} max={k.mal}/>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted,marginTop:4,marginBottom:12}}>
                  <span><strong style={{color:C.text}}>{k.sig.toLocaleString("no")}</strong> / {k.mal.toLocaleString("no")}</span>
                  <span>{k.dager}d igjen</span>
                </div>
                <Btn variant="primary" size="sm" style={{width:"100%"}} onClick={()=>setScreen("bruker-login")}>
                  Signer kampanjen
                </Btn>
              </div>
            ))}
          </div>
        </div>

        {/* Nedre CTA */}
        <div style={{background:"#1A1512",borderRadius:16,padding:"32px 36px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:24,flexWrap:"wrap"}}>
          <div>
            <div style={{fontWeight:800,fontSize:18,fontFamily:"'Playfair Display',serif",color:"#fff",marginBottom:6}}>
              Vil du mobilisere, sende høringssvar og få varsler?
            </div>
            <div style={{fontSize:14,color:"rgba(255,255,255,.6)"}}>Gratis for alle kulturaktører. Logg inn eller registrer deg på ett minutt.</div>
          </div>
          <div style={{display:"flex",gap:10}}>
            <Btn variant="primary" onClick={()=>setScreen("bruker-login")}>Kom i gang gratis →</Btn>
            <button onClick={()=>setScreen("kommune-login")}
              style={{padding:"10px 18px",background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.2)",borderRadius:9,color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              🏛 For kommuner
            </button>
          </div>
        </div>
      </div>

      {valgt&&<SaksModal sak={valgt} kampanjer={KAMPANJER} onClose={()=>setValgt(null)}/>}
    </div>
  );
}


// ─── PERSONVERN MODAL ────────────────────────────────────────────────────────
function PersonvernModal({onClose}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:700,display:"flex",alignItems:"flex-end",justifyContent:"center",padding:"0"}} onClick={onClose}>
      <div style={{background:C.bgCard,borderRadius:"18px 18px 0 0",width:"100%",maxWidth:680,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 -8px 48px rgba(0,0,0,.2)"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"20px 24px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:C.bgCard}}>
          <h2 style={{fontSize:17,fontWeight:800,fontFamily:"'Playfair Display',serif",color:C.redDark}}>🔒 Personvern og databehandling</h2>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,color:C.muted,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{padding:"24px",fontSize:14,lineHeight:1.75,color:C.text}}>
          <div style={{background:"#F0FDF4",border:"1px solid #86EFAC",borderRadius:10,padding:"12px 16px",marginBottom:20,fontSize:13,color:C.green}}>
            ✓ Kulturvarsling.no behandler dine data i henhold til GDPR og norsk personopplysningslov.
          </div>
          {[
            ["Hvem er behandlingsansvarlig?","Åndsverkstedet AS er behandlingsansvarlig for alle personopplysninger som samles inn gjennom Kulturvarsling.no. Kontakt: personvern@kulturvarsling.no"],
            ["Hvilke data samler vi inn?","Vi samler inn e-postadresse, navn og organisasjonstilknytning ved registrering. Ved bruk av tjenesten lagres hvilke saker du følger, kampanjer du har signert, og høringssvar du har sendt. Vi samler ikke inn sensitiv informasjon."],
            ["Hva bruker vi dataene til?","E-postadresse brukes til å sende varselnotifikasjoner du selv har aktivert. Navn og organisasjon brukes til å identifisere deg i høringssvar. Vi deler aldri dine data med tredjeparter til kommersielle formål."],
            ["Cookies og sporingsverktøy","Vi bruker kun funksjonelle informasjonskapsler som er nødvendige for at tjenesten skal fungere. Vi bruker ingen annonse- eller atferdssporingsverktøy."],
            ["Dine rettigheter","Du har rett til innsyn, retting og sletting av dine data. Du kan når som helst trekke tilbake samtykket og slette kontoen din under Min side → Innstillinger. For henvendelser: personvern@kulturvarsling.no"],
            ["Datalagring","Data lagres på servere i EU/EØS-området. Vi oppbevarer data så lenge kontoen er aktiv, eller i inntil 12 måneder etter siste innlogging."],
          ].map(([tittel,tekst])=>(
            <div key={tittel} style={{marginBottom:20}}>
              <div style={{fontWeight:700,fontSize:14,color:C.redDark,marginBottom:6}}>{tittel}</div>
              <div style={{color:C.muted,fontSize:13,lineHeight:1.65}}>{tekst}</div>
            </div>
          ))}
          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:16,marginTop:4,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
            <span style={{fontSize:12,color:C.muted}}>Sist oppdatert: januar 2025</span>
            <Btn variant="primary" size="sm" onClick={onClose}>Lukk</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ONBOARDING WIZARD ───────────────────────────────────────────────────────
function OnboardingWizard({user,setUser,onDone}) {
  const [steg,setSteg]=useState(0);
  const [org,setOrg]=useState(user?.org||"");
  const [orgType,setOrgType]=useState(user?.orgType||"");
  const [valgtKat,setValgtKat]=useState(user?.varselKat||[]);
  const [valgtNivå,setValgtNivå]=useState(["nasjonalt","fylke","kommune"]);
  const [frekvens,setFrekvens]=useState("daglig");
  const [samtykke,setSamtykke]=useState(false);
  const [visPersonvern,setVisPersonvern]=useState(false);

  const stegListe=[
    {tittel:"Hvem er du?",sub:"Fortell oss litt om deg og din organisasjon."},
    {tittel:"Hva følger du med på?",sub:"Velg fagfeltene som er relevante for deg – vi filtrerer saker deretter."},
    {tittel:"Varsler",sub:"Hvor ofte vil du høre fra oss?"},
    {tittel:"Personvern og samtykke",sub:"Les gjennom og bekreft."},
  ];

  function fullfør() {
    setUser(u=>({...u,org,orgType,varselKat:valgtKat,varselNivå:valgtNivå,varselFrekvens:frekvens,onboardingDone:true}));
    onDone();
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.65)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      {visPersonvern&&<PersonvernModal onClose={()=>setVisPersonvern(false)}/>}
      <div style={{background:C.bgCard,borderRadius:20,width:"100%",maxWidth:520,boxShadow:"0 32px 80px rgba(0,0,0,.35)",overflow:"hidden"}}>
        {/* Progress */}
        <div style={{background:C.red,padding:"20px 24px 16px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,.7)",textTransform:"uppercase",letterSpacing:".06em"}}>
              Steg {steg+1} av {stegListe.length}
            </div>
            <div style={{display:"flex",gap:5}}>
              {stegListe.map((_,i)=>(
                <div key={i} style={{width:i<=steg?24:8,height:6,borderRadius:99,background:i<=steg?"#fff":"rgba(255,255,255,.3)",transition:"width .3s"}}/>
              ))}
            </div>
          </div>
          <h2 style={{fontSize:20,fontWeight:800,fontFamily:"'Playfair Display',serif",color:"#fff",marginBottom:3}}>{stegListe[steg].tittel}</h2>
          <p style={{fontSize:13,color:"rgba(255,255,255,.75)"}}>{stegListe[steg].sub}</p>
        </div>

        <div style={{padding:"24px"}}>
          {/* Steg 0 – Hvem er du */}
          {steg===0&&(
            <div>
              <div style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:6,textTransform:"uppercase",letterSpacing:".04em"}}>Navn / organisasjon</div>
                <input value={org} onChange={e=>setOrg(e.target.value)} placeholder="Eks: Norsk Musikerforbund"
                  style={{width:"100%",padding:"10px 14px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:14,fontFamily:"inherit",color:C.text,background:C.bgCard}}/>
              </div>
              <div style={{marginBottom:4}}>
                <div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:8,textTransform:"uppercase",letterSpacing:".04em"}}>Type aktør</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {[["organisasjon","🏢 Organisasjon"],["kunstner","🎨 Frilanser/kunstner"],["institusjon","🏛 Institusjon"],["annet","👤 Annet"]].map(([id,lbl])=>(
                    <button key={id} onClick={()=>setOrgType(id)}
                      style={{padding:"10px 12px",borderRadius:9,border:`1.5px solid ${orgType===id?C.red:C.border}`,background:orgType===id?"#FFF0EF":C.bgCard,color:orgType===id?C.red:C.text,fontSize:13,fontWeight:orgType===id?700:400,fontFamily:"inherit",textAlign:"left"}}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Steg 1 – Fagfelt */}
          {steg===1&&(
            <div>
              <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                {KATEGORIER.map(k=>(
                  <button key={k.id} onClick={()=>setValgtKat(p=>p.includes(k.id)?p.filter(x=>x!==k.id):[...p,k.id])}
                    style={{padding:"8px 13px",borderRadius:99,border:`1.5px solid ${valgtKat.includes(k.id)?C.red:C.border}`,background:valgtKat.includes(k.id)?C.red:"none",color:valgtKat.includes(k.id)?"#fff":C.text,fontSize:13,cursor:"pointer",fontFamily:"inherit",fontWeight:valgtKat.includes(k.id)?700:400}}>
                    {k.ikon} {k.label}
                  </button>
                ))}
              </div>
              <div style={{marginTop:14,fontSize:12,color:C.muted}}>La stå tomt for å motta alle fagfelt.</div>
              <div style={{marginTop:16,paddingTop:16,borderTop:`1px solid ${C.border}`}}>
                <div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:8,textTransform:"uppercase",letterSpacing:".04em"}}>Geografisk nivå</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {[["nasjonalt","🏛 Nasjonalt"],["fylke","🗺 Fylke"],["kommune","📍 Kommune"]].map(([id,lbl])=>(
                    <button key={id} onClick={()=>setValgtNivå(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])}
                      style={{padding:"8px 14px",borderRadius:8,border:`1.5px solid ${valgtNivå.includes(id)?C.red:C.border}`,background:valgtNivå.includes(id)?C.red:"none",color:valgtNivå.includes(id)?"#fff":C.text,fontSize:13,cursor:"pointer",fontFamily:"inherit",fontWeight:valgtNivå.includes(id)?700:400}}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Steg 2 – Frekvens */}
          {steg===2&&(
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {[
                ["straks","⚡ Straks","Kun varsler med under 7 dager til frist og status kritisk"],
                ["daglig","📅 Daglig oppsummering","Én e-post per dag med alle nye saker – anbefalt"],
                ["ukentlig","📬 Ukentlig digest","Én e-post per uke – oversikt over siste 7 dager"],
              ].map(([id,lbl,sub])=>(
                <div key={id} onClick={()=>setFrekvens(id)}
                  style={{display:"flex",gap:14,alignItems:"center",padding:"14px 16px",borderRadius:12,border:`1.5px solid ${frekvens===id?C.red:C.border}`,background:frekvens===id?"#FFF0EF":"none",cursor:"pointer"}}>
                  <div style={{width:20,height:20,borderRadius:"50%",border:`2.5px solid ${frekvens===id?C.red:C.border}`,background:frekvens===id?C.red:"none",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {frekvens===id&&<div style={{width:7,height:7,background:"#fff",borderRadius:"50%"}}/>}
                  </div>
                  <div>
                    <div style={{fontWeight:700,fontSize:14,color:C.text}}>{lbl}</div>
                    <div style={{fontSize:12,color:C.muted,marginTop:2}}>{sub}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Steg 3 – Samtykke */}
          {steg===3&&(
            <div>
              <div style={{background:C.bgAlt,borderRadius:12,padding:"16px",marginBottom:16,fontSize:13,color:C.muted,lineHeight:1.65}}>
                Du registrerer deg med <strong style={{color:C.text}}>{user?.epost}</strong> som representant for <strong style={{color:C.text}}>{org||"din organisasjon"}</strong>.
                <br/><br/>
                Kulturvarsling.no vil bruke e-postadressen din til å sende varsler du har abonnert på. Vi deler aldri dine data med tredjeparter til kommersielle formål.
              </div>
              <div onClick={()=>setSamtykke(s=>!s)} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"14px 16px",borderRadius:12,border:`1.5px solid ${samtykke?C.green:C.border}`,background:samtykke?"#F0FDF4":"none",cursor:"pointer",marginBottom:14}}>
                <div style={{width:20,height:20,borderRadius:5,border:`2px solid ${samtykke?C.green:C.border}`,background:samtykke?C.green:"none",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",marginTop:1}}>
                  {samtykke&&<span style={{color:"#fff",fontSize:12,fontWeight:900}}>✓</span>}
                </div>
                <div style={{fontSize:13,color:C.text,lineHeight:1.55}}>
                  Jeg har lest og akseptert{" "}
                  <button onClick={e=>{e.stopPropagation();setVisPersonvern(true);}} style={{background:"none",border:"none",color:C.red,fontWeight:700,fontSize:13,cursor:"pointer",padding:0,textDecoration:"underline"}}>
                    personvernerklæringen
                  </button>
                  {" "}og samtykker til at Kulturvarsling.no kan behandle mine personopplysninger.
                </div>
              </div>
              <div style={{fontSize:11,color:C.muted,lineHeight:1.55}}>
                Du kan når som helst trekke tilbake samtykket og slette kontoen din. Kontakt personvern@kulturvarsling.no for spørsmål.
              </div>
            </div>
          )}

          {/* Navigasjon */}
          <div style={{display:"flex",gap:10,marginTop:24}}>
            {steg>0&&<Btn variant="secondary" onClick={()=>setSteg(s=>s-1)}>← Tilbake</Btn>}
            {steg<stegListe.length-1&&(
              <Btn variant="primary" style={{flex:1}} onClick={()=>setSteg(s=>s+1)}>
                Neste →
              </Btn>
            )}
            {steg===stegListe.length-1&&(
              <Btn variant="primary" style={{flex:1}} onClick={fullfør} disabled={!samtykke}>
                Fullfør registrering →
              </Btn>
            )}
          </div>
          {steg===0&&(
            <button onClick={onDone} style={{display:"block",width:"100%",marginTop:10,background:"none",border:"none",fontSize:12,color:C.muted,cursor:"pointer"}}>
              Hopp over – sett opp profil senere
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── BRUKER LOGIN ─────────────────────────────────────────────────────────

// ─── FEEDBACK MODAL ──────────────────────────────────────────────────────────
function FeedbackModal({onClose, kontekst=null}) {
  const [type,setType]=useState(kontekst?.type||"feil");
  const [tekst,setTekst]=useState("");
  const [sendt,setSendt]=useState(false);

  if(sendt) return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div style={{background:C.bgCard,borderRadius:16,padding:"40px 32px",textAlign:"center",maxWidth:400}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:40,marginBottom:12}}>🙏</div>
        <div style={{fontWeight:800,fontSize:17,color:C.green,marginBottom:6}}>Takk for tilbakemeldingen!</div>
        <div style={{fontSize:13,color:C.muted,marginBottom:20,lineHeight:1.6}}>Vi bruker innspill som dette til å forbedre plattformen og kvaliteten på sakene vi overvåker.</div>
        <Btn variant="secondary" onClick={onClose}>Lukk</Btn>
      </div>
    </div>
  );

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div style={{background:C.bgCard,borderRadius:16,width:"100%",maxWidth:480,padding:"24px 28px",boxShadow:"0 24px 64px rgba(0,0,0,.25)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h2 style={{fontSize:17,fontWeight:800,fontFamily:"'Playfair Display',serif",color:C.redDark,margin:0}}>📬 Send oss tilbakemelding</h2>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,color:C.muted,cursor:"pointer"}}>✕</button>
        </div>

        {kontekst?.sakTittel&&(
          <div style={{background:C.bgAlt,borderRadius:8,padding:"8px 12px",marginBottom:16,fontSize:12,color:C.muted}}>
            Gjelder saken: <strong style={{color:C.text}}>{kontekst.sakTittel}</strong>
          </div>
        )}

        <div style={{marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".04em",marginBottom:8}}>Type tilbakemelding</div>
          <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
            {[["feil","⚠️ Feil i saken"],["mangler","🔍 Manglende sak"],["utdatert","🗓 Utdatert info"],["forslag","💡 Forslag til forbedring"],["annet","💬 Annet"]].map(([id,lbl])=>(
              <button key={id} onClick={()=>setType(id)}
                style={{padding:"6px 12px",borderRadius:99,border:"1.5px solid "+(type===id?C.red:C.border),background:type===id?C.red:"none",color:type===id?"#fff":C.text,fontSize:12,cursor:"pointer",fontWeight:type===id?700:400,fontFamily:"inherit"}}>
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".04em",marginBottom:6}}>
            {type==="feil"?"Hva er feil?":type==="mangler"?"Hvilken sak mangler?":type==="utdatert"?"Hva er utdatert?":type==="forslag"?"Ditt forslag":("Beskriv")}
          </div>
          <textarea value={tekst} onChange={e=>setTekst(e.target.value)} rows={4}
            placeholder={type==="feil"?"F.eks. feil frist, feil instans, faktafeil i sammendrag...":type==="mangler"?"Beskriv saken og hvem som behandler den...":type==="forslag"?"Hva ville gjort plattformen bedre for deg?":"..."}
            style={{width:"100%",padding:"10px 14px",borderRadius:8,border:"1px solid "+C.border,fontSize:13,lineHeight:1.6,resize:"vertical",boxSizing:"border-box",fontFamily:"inherit"}}/>
        </div>

        <div style={{display:"flex",gap:8}}>
          <Btn variant="primary" style={{flex:1}} disabled={!tekst.trim()} onClick={()=>setSendt(true)}>
            Send tilbakemelding
          </Btn>
          <Btn variant="secondary" onClick={onClose}>Avbryt</Btn>
        </div>
      </div>
    </div>
  );
}

function BrukerLogin({setScreen,setUser}) {
  const [epost,setEpost]=useState("");
  const [pw,setPw]=useState("");
  const [navn,setNavn]=useState("");
  const [mode,setMode]=useState("login");
  const [visPersonvern,setVisPersonvern]=useState(false);
  const [feil,setFeil]=useState("");
  const [laster,setLaster]=useState(false);
  const [bekreftSendt,setBekreftSendt]=useState(false);

  async function loggInn() {
    setLaster(true); setFeil("");
    const { data, error } = await sb.auth.signInWithPassword({ email:epost, password:pw });
    if(error) { setFeil("Feil e-post eller passord."); setLaster(false); return; }
    const profil = await hentProfil(data.user.id);
    setUser({
      id: data.user.id,
      navn: profil?.navn || epost.split("@")[0],
      epost: data.user.email,
      org: profil?.org || "",
      orgType: profil?.org_type || "",
      fagfelt: profil?.fagfelt || [],
      plan: profil?.plan || "gratis",
      onboardingDone: profil?.onboarding_done || false,
      varselFrekvens: profil?.varsel_frekvens || "daglig",
    });
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
      await new Promise(r=>setTimeout(r,500));
      setUser({
        id: data.user.id, navn, epost: data.user.email,
        org:"", orgType:"", fagfelt:[],
        plan:"gratis", onboardingDone:false, varselFrekvens:"daglig"
      });
      setScreen("bruker-app");
    } else { setBekreftSendt(true); }
    setLaster(false);
  }

  if(bekreftSendt) return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <style>{css}</style>
      <div style={{background:C.bgCard,borderRadius:16,padding:"40px 32px",maxWidth:420,textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:12}}>📧</div>
        <h2 style={{fontFamily:"'Playfair Display',serif",color:C.redDark,marginBottom:8}}>Sjekk e-posten din</h2>
        <p style={{color:C.muted,fontSize:14,lineHeight:1.6}}>Vi har sendt en bekreftelseslenke til <strong>{epost}</strong>.</p>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif",padding:16}}>
      <style>{css}</style>
      {visPersonvern&&<PersonvernModal onClose={()=>setVisPersonvern(false)}/>}
      <div style={{width:"100%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{width:44,height:44,background:C.red,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}>
            <span style={{color:"#fff",fontWeight:900,fontSize:22,fontFamily:"serif"}}>K</span>
          </div>
          <h1 style={{fontSize:24,fontWeight:800,fontFamily:"'Playfair Display',serif",color:C.redDark}}>{mode==="login"?"Logg inn":"Opprett konto"}</h1>
          <p style={{fontSize:14,color:C.muted,marginTop:6}}>Kulturvarsling.no – gratis for alle kulturaktører</p>
        </div>
        <Card>
          <Input label="E-postadresse" placeholder="deg@eksempel.no" value={epost} onChange={e=>setEpost(e.target.value)} type="email"/>
          <Input label="Passord" placeholder="••••••••" value={pw} onChange={e=>setPw(e.target.value)} type="password"/>
          {mode==="register"&&<Input label="Navn / organisasjon" placeholder="Frode Gjerløw / Åndsverkstedet" value={navn} onChange={e=>setNavn(e.target.value)}/>}
          {mode==="register"&&(
            <div style={{fontSize:12,color:C.muted,lineHeight:1.55,marginBottom:8}}>
              Ved å opprette konto aksepterer du{" "}
              <button onClick={()=>setVisPersonvern(true)} style={{background:"none",border:"none",color:C.red,fontWeight:700,fontSize:12,cursor:"pointer",padding:0,textDecoration:"underline"}}>
                personvernerklæringen
              </button>.
            </div>
          )}
          {feil&&<div style={{background:"#FEE2E2",border:"1px solid #FECACA",borderRadius:8,padding:"8px 12px",marginBottom:8,fontSize:13,color:"#991B1B"}}>{feil}</div>}
          <Btn variant="primary" size="lg" style={{width:"100%",marginTop:4}} onClick={mode==="login"?loggInn:registrer} disabled={laster}>
            {laster?"Laster...":(mode==="login"?"Logg inn →":"Opprett gratis konto →")}
          </Btn>
          <div style={{textAlign:"center",marginTop:14,fontSize:13,color:C.muted}}>
            {mode==="login"?"Har du ikke konto?":"Har du allerede konto?"}
            <button onClick={()=>setMode(m=>m==="login"?"register":"login")} style={{background:"none",border:"none",color:C.red,fontWeight:700,fontSize:13,marginLeft:5}}>{mode==="login"?"Registrer deg":"Logg inn"}</button>
          </div>
        </Card>
        <div style={{textAlign:"center",marginTop:16}}>
          <button onClick={()=>setScreen("kommune-login")} style={{background:"none",border:"none",color:C.muted,fontSize:12}}>Er du fra en kommune? →</button>
        </div>
        <div style={{textAlign:"center",marginTop:8}}>
          <button onClick={()=>setScreen("bruker-app")} style={{background:"none",border:"none",color:C.muted,fontSize:12}}>← Tilbake</button>
        </div>
      </div>
    </div>
  );
}

// ─── BRUKER APP ───────────────────────────────────────────────────────────
function BrukerApp({user,setUser,setScreen}) {
  const [view,setView]=useState("forside");
  const [showPremium,setShowPremium]=useState(false);
  const [showVarselReg,setShowVarselReg]=useState(false);
  const [showOnboarding,setShowOnboarding]=useState(user&&!user.onboardingDone);
  const [showPersonvern,setShowPersonvern]=useState(false);
  const [showFeedback,setShowFeedback]=useState(false);
  const [fulgte,setFullgte]=useState([]);
  const isPremium = user?.plan==="premium";
  const [aktivitet,setAktivitet]=useState(AKTIVITET_INIT);

  // ── Last data fra Supabase ved oppstart ──────────────────
  const [varsler,setVarsler]=useState(VARSLER);
  const [kampanjer,setKampanjer]=useState(KAMPANJER);
  const [dataLastet,setDataLastet]=useState(false);

  useEffect(()=>{
    async function lastData() {
      // Last varsler
      const v = await lastVarsler();
      if(v && v.length > 0) setVarsler(v);
      // Last kampanjer
      const k = await lastKampanjer();
      if(k && k.length > 0) setKampanjer(k);
      // Last brukerens fulgte saker
      if(user?.id) {
        const f = await hentFulgte(user.id);
        setFullgte(f);
        // Last aktivitet
        const a = await hentAktivitet(user.id);
        if(a.length > 0) setAktivitet(a.map(x=>({
          ...x, type:x.type, tittel:x.tittel, dato:x.opprettet?.slice(0,10)||"",
          sakId:x.sak_id, mottaker:x.mottaker, status:x.status||"sendt"
        })));
      }
      setDataLastet(true);
    }
    lastData();
  },[]);

  async function loggAktivitet(entry) {
    const ny = {...entry, id:Date.now(), dato:new Date().toLocaleDateString("no-NO")};
    setAktivitet(a=>[ny,...a]);
    if(user?.id) await loggAktivitetDB(user.id, entry);
  }

  async function toggleFølg(sakId) {
    const følger = fulgte.includes(sakId);
    setFullgte(f=>følger?f.filter(x=>x!==sakId):[...f,sakId]);
    if(user?.id) await toggleFølgSak(user.id, sakId, følger);
  }

  // Logg ut
  async function loggUt() {
    await sb.auth.signOut();
    setUser(null);
    setScreen("bruker-app");
  }

  const VIEWS=[
    {id:"forside",label:"Forside",ikon:"🏠"},
    {id:"varsler",label:"Varsler",ikon:"🔔"},
    {id:"kampanjer",label:"Kampanjer",ikon:"✊"},
    {id:"mobiliser",label:"Mobiliser",ikon:"📬"},
    {id:"historikk",label:"Historikk",ikon:"📖"},
    ...(user ? [{id:"profil",label:"Min profil",ikon:"👤"}] : []),
    {id:"premium",label:"Premium",ikon:"⭐",premium:true},
  ];

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'DM Sans',sans-serif",color:C.text}}>
      <style>{css}</style>

      {showPremium&&<PremiumModal user={user} setUser={setUser} onClose={()=>setShowPremium(false)} onSuccess={()=>{setUser(u=>({...u,plan:"premium"}));setShowPremium(false);setView("premium");}}/>}
      {showVarselReg&&<VarselRegistreringModal user={user} setUser={setUser} onClose={()=>setShowVarselReg(false)}/>}
      {showOnboarding&&user&&<OnboardingWizard user={user} setUser={setUser} onDone={()=>setShowOnboarding(false)}/>}
      {showPersonvern&&<PersonvernModal onClose={()=>setShowPersonvern(false)}/>}

      <header style={{background:C.bgCard,borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,zIndex:100,boxShadow:"0 1px 8px rgba(0,0,0,.06)"}}>
        <div style={{maxWidth:1100,margin:"0 auto",padding:"0 16px",display:"flex",alignItems:"center",height:58,gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0,cursor:"pointer"}} onClick={()=>setView("forside")}>
            <div style={{width:28,height:28,background:C.red,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{color:"#fff",fontWeight:900,fontSize:14,fontFamily:"serif"}}>K</span>
            </div>
            <span className="mob-hide" style={{fontWeight:800,fontSize:14,fontFamily:"'Playfair Display',serif",color:C.redDark}}>Kulturvarsling.no</span>
          </div>
          <nav style={{display:"flex",gap:1,flex:1,overflowX:"auto"}}>
            {VIEWS.map(v=>(
              <button key={v.id}
                onClick={()=>{ if(v.premium&&!isPremium){setShowPremium(true);}else{setView(v.id);}}}
                style={{padding:"6px 10px",borderRadius:7,border:"none",background:view===v.id?(v.premium?"linear-gradient(135deg,#7C3AED,#4F46E5)":C.red):"none",color:view===v.id?"#fff":v.premium?C.purple:C.muted,fontSize:13,fontWeight:view===v.id?700:500,whiteSpace:"nowrap",flexShrink:0,fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
                <span>{v.ikon}</span><span className="nav-txt">{v.label}</span>
              </button>
            ))}
          </nav>
          <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
            <button onClick={()=>setScreen("kommune-login")}
              style={{padding:"5px 10px",borderRadius:7,border:`1px solid ${C.komBorder}`,background:C.komBg,color:C.komBlue,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
              🏛 <span className="nav-txt">Kommune</span>
            </button>
            {user ? (
              <>
                {!isPremium&&<Btn variant="premium" size="sm" onClick={()=>setShowPremium(true)} style={{whiteSpace:"nowrap"}}>⭐</Btn>}
                {isPremium&&<Badge color={C.purple} bg="#EDE9FE">⭐</Badge>}
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <div onClick={()=>setView("profil")} title={user.navn} style={{width:30,height:30,background:C.red,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",flexShrink:0}}>
                    {(user.org||user.navn||"?")[0].toUpperCase()}
                  </div>
                  <button onClick={loggUt} title="Logg ut" style={{background:"none",border:"1px solid "+C.border,borderRadius:6,padding:"3px 8px",fontSize:11,color:C.muted,cursor:"pointer",fontFamily:"inherit"}}>Logg ut</button>
                </div>
              </>
            ) : (
              <>
                <Btn variant="secondary" size="sm" onClick={()=>setScreen("bruker-login")}>Logg inn</Btn>
                <Btn variant="primary" size="sm" onClick={()=>setScreen("bruker-login")}>Registrer</Btn>
              </>
            )}
          </div>
        </div>
      </header>

      <main style={{maxWidth:1100,margin:"0 auto",padding:"24px 16px"}}>
        {view==="forside"&&(
          <div style={{marginBottom:20}}>
            <div style={{display:"inline-flex",alignItems:"center",gap:7,background:C.red+"15",border:`1px solid ${C.red}30`,borderRadius:99,padding:"4px 12px",marginBottom:10}}>
              <span style={{fontSize:11,color:C.red,fontWeight:700,letterSpacing:".03em"}}>🔔 KI-DREVET VARSLINGSSYSTEM</span>
            </div>
            <h1 style={{fontSize:26,fontWeight:900,fontFamily:"'Playfair Display',serif",color:C.redDark,lineHeight:1.15,marginBottom:5,letterSpacing:"-.02em"}}>
              Aldri gå glipp av en viktig kulturpolitisk sak
            </h1>
            <p style={{fontSize:14,color:C.muted,lineHeight:1.6,maxWidth:560}}>
              Kulturvarsling samler politiske prosesser – nasjonalt, regionalt og lokalt – og varsler deg om høringer og vedtak som angår ditt fagfelt, før fristene løper ut.
            </p>
          </div>
        )}
        {view!=="forside"&&(
          <div style={{marginBottom:20}}>
            <h1 style={{margin:"0 0 4px",fontSize:22,fontWeight:800,fontFamily:"'Playfair Display',serif",color:C.redDark}}>
              {({varsler:"Politiske varsler",historikk:"Sakshistorikk",kampanjer:"Kampanjer",mobiliser:"Mobiliser",profil:"Min profil",premium:"Premium-verktøy"})[view]}
            </h1>
            <div style={{height:3,width:40,background:C.red,borderRadius:99}}/>
          </div>
        )}
        {view==="forside"   &&<BrukerForside setView={setView} setShowPremium={setShowPremium} isPremium={isPremium} fulgte={fulgte} toggleFølg={toggleFølg} onLogin={()=>setScreen("bruker-login")} varslerData={varsler} kampanjerData={kampanjer}/>}
        {view==="varsler"   &&<BrukerVarsler fulgte={fulgte} toggleFølg={toggleFølg} varslerData={varsler}/>}
        {view==="historikk" &&<SaksHistorikkSide aktivitet={aktivitet}/>}
        {view==="kampanjer" &&<BrukerKampanjer kampanjerData={kampanjer} varslerData={varsler} user={user}/>}
        {view==="mobiliser" &&<BrukerMobiliser loggAktivitet={loggAktivitet} user={user} varslerData={varsler}/>}
        {view==="profil"    &&<MinProfilSide user={user} setUser={setUser} aktivitet={aktivitet} fulgte={fulgte} toggleFølg={toggleFølg} setShowVarselReg={setShowVarselReg} setShowPremium={setShowPremium} setShowOnboarding={setShowOnboarding} setShowPersonvern={setShowPersonvern}/>}
        {view==="premium"   &&<PremiumVerktøy/>}
      </main>

      {/* Footer */}
      {showFeedback&&<FeedbackModal onClose={()=>setShowFeedback(false)}/>}
      <footer style={{borderTop:`1px solid ${C.border}`,padding:"20px 24px",textAlign:"center",fontSize:12,color:C.muted,background:C.bgCard}}>
        <div style={{display:"flex",justifyContent:"center",gap:20,flexWrap:"wrap"}}>
          <span>© 2025 Åndsverkstedet AS</span>
          <button onClick={()=>setShowPersonvern(true)} style={{background:"none",border:"none",color:C.red,fontSize:12,fontWeight:600,cursor:"pointer"}}>🔒 Personvern</button>
          <button onClick={()=>setShowFeedback(true)} style={{background:"none",border:"none",color:C.muted,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>📬 Gi tilbakemelding</button>
          <span>personvern@kulturvarsling.no</span>
        </div>
      </footer>
    </div>
  );
}


// ─── FØLG-KNAPP ──────────────────────────────────────────────────────────────
function FølgKnapp({sakId,fulgte,toggleFølg,size="sm"}) {
  const følger = fulgte.includes(sakId);
  return (
    <button onClick={e=>{e.stopPropagation();toggleFølg(sakId);}}
      style={{padding:size==="sm"?"5px 10px":"8px 14px",borderRadius:7,border:`1.5px solid ${følger?C.red:C.border}`,background:følger?"#FFF0EF":"none",color:følger?C.red:C.muted,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4,flexShrink:0,transition:"all .15s"}}>
      {følger?"🔔 Følger":"🔕 Følg saken"}
    </button>
  );
}

// ─── MIN PROFIL SIDE ─────────────────────────────────────────────────────────
function MinProfilSide({user,setUser,aktivitet,fulgte,toggleFølg,setShowVarselReg,setShowPremium,setShowOnboarding,setShowPersonvern}) {
  const [tab,setTab]=useState("profil");
  const [redigerOrg,setRedigerOrg]=useState(false);
  const [orgVal,setOrgVal]=useState(user?.org||"");
  const [orgTypeVal,setOrgTypeVal]=useState(user?.orgType||"");

  return (
    <div>
      <div style={{display:"flex",gap:0,marginBottom:24,borderBottom:`1px solid ${C.border}`}}>
        {[["profil","👤 Organisasjonsprofil"],["fulgte","🔔 Saker jeg følger"],["aktivitet","📋 Aktivitet"],["innstillinger","⚙️ Innstillinger"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)} style={{padding:"8px 14px",border:"none",borderBottom:`2.5px solid ${tab===id?C.red:"transparent"}`,background:"none",fontSize:13,color:tab===id?C.red:C.muted,fontWeight:tab===id?700:500,marginBottom:-1,fontFamily:"inherit",whiteSpace:"nowrap"}}>
            {lbl}
          </button>
        ))}
      </div>

      {/* Organisasjonsprofil */}
      {tab==="profil"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}} className="grid-2">
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontWeight:700,fontSize:14}}>Organisasjonsinfo</div>
              <Btn variant="secondary" size="sm" onClick={()=>setRedigerOrg(r=>!r)}>{redigerOrg?"Lagre":"Rediger"}</Btn>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16}}>
              <div style={{width:52,height:52,background:C.red,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:900,fontSize:22,fontFamily:"serif"}}>
                {(user?.org||user?.navn||"K")[0].toUpperCase()}
              </div>
              <div>
                <div style={{fontWeight:700,fontSize:16}}>{user?.org||user?.navn||"Ikke satt"}</div>
                <div style={{fontSize:12,color:C.muted,marginTop:2}}>{user?.epost}</div>
                {user?.orgType&&<div style={{fontSize:11,marginTop:4}}><Badge color={C.muted}>{({organisasjon:"🏢 Organisasjon",kunstner:"🎨 Frilanser/kunstner",institusjon:"🏛 Institusjon",annet:"👤 Annet"})[user.orgType]||user.orgType}</Badge></div>}
              </div>
            </div>
            {redigerOrg&&(
              <div>
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:".03em"}}>Organisasjonsnavn</div>
                  <input value={orgVal} onChange={e=>setOrgVal(e.target.value)} style={{width:"100%",padding:"9px 12px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,boxSizing:"border-box",fontFamily:"inherit"}}/>
                </div>
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:".03em"}}>Type aktør</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                    {[["organisasjon","🏢 Org."],["kunstner","🎨 Frilanser"],["institusjon","🏛 Inst."],["annet","👤 Annet"]].map(([id,lbl])=>(
                      <button key={id} onClick={()=>setOrgTypeVal(id)}
                        style={{padding:"7px 8px",borderRadius:7,border:`1.5px solid ${orgTypeVal===id?C.red:C.border}`,background:orgTypeVal===id?"#FFF0EF":"none",color:orgTypeVal===id?C.red:C.text,fontSize:12,fontFamily:"inherit",cursor:"pointer"}}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
                <Btn variant="primary" size="sm" style={{width:"100%"}} onClick={()=>{setUser(u=>({...u,org:orgVal,orgType:orgTypeVal}));setRedigerOrg(false);}}>
                  Lagre endringer
                </Btn>
              </div>
            )}
            {!redigerOrg&&(
              <div style={{fontSize:12,color:C.muted,lineHeight:1.55}}>
                Organisasjonsprofilen brukes til å forhåndsutfylle høringssvar og brevmaler.
              </div>
            )}
          </Card>
          <Card>
            <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>Aktivitetsoppsummering</div>
            {[
              ["Saker fulgt",fulgte.length,"🔔"],
              ["Høringssvar sendt",aktivitet.filter(a=>a.type==="horingssvar").length,"📝"],
              ["Politikere kontaktet",aktivitet.filter(a=>a.type==="kontakt").length,"📬"],
              ["Kampanjer signert",aktivitet.filter(a=>a.type==="signatur").length,"✊"],
            ].map(([lbl,n,ikon])=>(
              <div key={lbl} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:`1px solid ${C.border}`}}>
                <span style={{fontSize:13,color:C.muted}}>{ikon} {lbl}</span>
                <span style={{fontWeight:800,fontSize:16,fontFamily:"'Playfair Display',serif",color:C.text}}>{n}</span>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Saker jeg følger */}
      {tab==="fulgte"&&(
        <div>
          {fulgte.length===0?(
            <div style={{textAlign:"center",padding:"48px 24px",color:C.muted}}>
              <div style={{fontSize:36,marginBottom:12}}>🔕</div>
              <div style={{fontWeight:700,fontSize:15,marginBottom:6}}>Du følger ingen saker ennå</div>
              <div style={{fontSize:13,lineHeight:1.55}}>Klikk "Følg saken" på varsler du vil holde øye med – de dukker opp her.</div>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {varslerData.filter(v=>fulgte.includes(v.id)).map(v=>{
                const ki=KATEGORIER.find(k=>k.id===v.kategori);
                const bc={kritisk:"#DC2626",viktig:"#D97706",normal:"#16A34A"}[v.status];
                return (
                  <div key={v.id} style={{background:C.bgCard,border:`1px solid ${C.border}`,borderLeft:`4px solid ${bc}`,borderRadius:12,padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",gap:5,marginBottom:5,flexWrap:"wrap"}}>
                        {ki&&<Badge color={C.muted} style={{fontSize:10}}>{ki.ikon} {ki.label}</Badge>}
                        <Badge color={bc} bg={bc+"15"} style={{fontSize:10}}>{v.dager}d igjen</Badge>
                      </div>
                      <div style={{fontWeight:700,fontSize:14,marginBottom:3}}>{v.tittel}</div>
                      <div style={{fontSize:12,color:C.muted}}>{v.instans}</div>
                    </div>
                    <FølgKnapp sakId={v.id} fulgte={fulgte} toggleFølg={toggleFølg}/>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Aktivitetslogg */}
      {tab==="aktivitet"&&(
        <Card>
          <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>Siste aktivitet</div>
          {aktivitet.length===0&&<div style={{fontSize:13,color:C.muted}}>Ingen aktivitet registrert ennå.</div>}
          {aktivitet.map(a=>(
            <div key={a.id} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
              <span style={{fontSize:16,flexShrink:0}}>{a.type==="horingssvar"?"📝":a.type==="kontakt"?"📬":a.type==="signatur"?"✊":"🔔"}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text}}>{a.tekst}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>{a.dato}</div>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Innstillinger */}
      {tab==="innstillinger"&&(
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <Card>
            <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>Varselinnstillinger</div>
            <Btn variant="secondary" onClick={()=>setShowVarselReg(true)}>⚙️ Endre varsler og fagfelt</Btn>
          </Card>
          <Card>
            <div style={{fontWeight:700,fontSize:14,marginBottom:6}}>Profil og onboarding</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:12}}>Gå gjennom oppsett på nytt og oppdater organisasjonsinformasjon.</div>
            <Btn variant="secondary" onClick={()=>setShowOnboarding(true)}>🔄 Gjennomfør oppsett på nytt</Btn>
          </Card>
          <Card>
            <div style={{fontWeight:700,fontSize:14,marginBottom:6}}>Personvern og data</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:12}}>Les personvernerklæringen eller be om sletting av dine data.</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <Btn variant="secondary" onClick={()=>setShowPersonvern(true)}>🔒 Les personvernerklæring</Btn>
              <Btn variant="secondary" style={{color:"#991B1B",border:"1px solid #FECACA"}}>🗑 Slett min konto</Btn>
            </div>
          </Card>
          {!user?.plan==="premium"&&(
            <Card style={{background:"linear-gradient(135deg,#EDE9FE,#DDD6FE)",border:"1px solid #C4B5FD"}}>
              <div style={{fontWeight:700,fontSize:14,color:C.purple,marginBottom:6}}>Oppgrader til Premium</div>
              <div style={{fontSize:13,color:C.muted,marginBottom:12}}>Budsjettanalyse, trendrapporter og politikeraktivitet.</div>
              <Btn variant="primary" style={{background:C.purple}} onClick={()=>setShowPremium(true)}>Se Premium-planer</Btn>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ─── BRUKER FORSIDE ───────────────────────────────────────────────────────
function BrukerForside({setView,setShowPremium,isPremium,fulgte=[],toggleFølg=()=>{},onLogin=()=>{}}) {
  const [valgt,setValgt]=useState(null);
  const [søk,setSøk]=useState("");
  const [aktivBoks,setAktivBoks]=useState(null); // null | "kritisk" | "saker" | "kampanjer" | "signaturer"
  const [varslerData, setVarslerData] = useState([]);
  useEffect(()=>{
  sb.from("varsler").select("*")
    .then(({data,error})=>{ console.log("varsler:",data,error); if(data) setVarslerData(data); });
},[]);
  
  const filtered = useMemo(()=>varslerData.filter(v=>!søk||v.tittel?.toLowerCase().includes(søk.toLowerCase())||v.sammendrag?.toLowerCase().includes(søk.toLowerCase())),[søk,varslerData]);
  const kritiskeVarsler = varslerData.filter(v=>v.status==="kritisk");

  const statBokser = [
    {
      id:"kritisk",
      n:kritiskeVarsler.length,
      label:"Kritiske frister",
      bg:"#FEE2E2",
      color:"#991B1B",
      border:"#FECACA",
      ikon:"⚠️",
      innhold: () => (
        <div>
          <div style={{fontSize:13,color:"#991B1B",fontWeight:700,marginBottom:12}}>⚠️ Saker med under 10 dager til frist</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {kritiskeVarsler.map(v=>{
              const ki=KATEGORIER.find(k=>k.id===v.kategori);
              return (
                <div key={v.id} onClick={()=>{setValgt(v);setAktivBoks(null);}} style={{background:"#fff",border:"1px solid #FECACA",borderRadius:10,padding:"10px 14px",cursor:"pointer",transition:"box-shadow .12s"}}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow="0 2px 10px rgba(0,0,0,.08)"}
                  onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:13,color:C.text,marginBottom:3}}>{v.tittel}</div>
                      <div style={{fontSize:11,color:C.muted}}>{v.instans}</div>
                    </div>
                    <span style={{background:"#FEE2E2",color:"#991B1B",padding:"2px 8px",borderRadius:99,fontSize:11,fontWeight:800,flexShrink:0,marginLeft:8}}>{v.dager}d igjen</span>
                  </div>
                  {ki&&<div style={{marginTop:5}}><Badge color={C.muted} style={{fontSize:10}}>{ki.ikon} {ki.label}</Badge></div>}
                </div>
              );
            })}
            {kritiskeVarsler.length===0&&<div style={{fontSize:13,color:C.muted,textAlign:"center",padding:"12px 0"}}>Ingen kritiske frister akkurat nå 🎉</div>}
          </div>
        </div>
      )
    },
    {
      id:"saker",
      n:VARSLER.length,
      label:"Aktive saker",
      bg:"#FEF3C7",
      color:C.amber,
      border:"#FDE68A",
      ikon:"📋",
      innhold: () => (
        <div>
          <div style={{fontSize:13,color:C.amber,fontWeight:700,marginBottom:12}}>📋 Alle aktive saker</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {VARSLER.map(v=>{
              const ki=KATEGORIER.find(k=>k.id===v.kategori);
              const bc={kritisk:"#DC2626",viktig:"#D97706",normal:"#16A34A"}[v.status];
              return (
                <div key={v.id} onClick={()=>{setValgt(v);setAktivBoks(null);}} style={{background:"#fff",border:"1px solid #FDE68A",borderLeft:`3px solid ${bc}`,borderRadius:10,padding:"10px 14px",cursor:"pointer",transition:"box-shadow .12s"}}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow="0 2px 10px rgba(0,0,0,.08)"}
                  onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:13,color:C.text,marginBottom:3}}>{v.tittel}</div>
                      <div style={{fontSize:11,color:C.muted}}>{v.instans}</div>
                    </div>
                    <span style={{fontSize:11,fontWeight:700,color:bc,flexShrink:0,marginLeft:8}}>{v.dager}d</span>
                  </div>
                  {ki&&<div style={{marginTop:5}}><Badge color={C.muted} style={{fontSize:10}}>{ki.ikon} {ki.label}</Badge></div>}
                </div>
              );
            })}
          </div>
          <button onClick={()=>{setView("varsler");setAktivBoks(null);}} style={{width:"100%",marginTop:12,padding:"9px",background:"none",border:`1px solid ${C.border}`,borderRadius:8,fontSize:12,color:C.amber,fontWeight:700,cursor:"pointer"}}>Se alle varsler →</button>
        </div>
      )
    },
    {
      id:"kampanjer",
      n:KAMPANJER.length,
      label:"Aktive kampanjer",
      bg:"#EDE9FE",
      color:C.purple,
      border:"#DDD6FE",
      ikon:"✊",
      innhold: () => (
        <div>
          <div style={{fontSize:13,color:C.purple,fontWeight:700,marginBottom:12}}>✊ Pågående kampanjer</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {KAMPANJER.map(k=>(
              <div key={k.id} style={{background:"#fff",border:"1px solid #DDD6FE",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:6}}>{k.tittel}</div>
                <Progress value={k.sig} max={k.mal} color={C.purple}/>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted,marginTop:4}}>
                  <span><strong style={{color:C.text}}>{k.sig.toLocaleString("no")}</strong> / {k.mal.toLocaleString("no")} signaturer</span>
                  <span>{k.dager}d igjen</span>
                </div>
              </div>
            ))}
          </div>
          <button onClick={()=>{setView("kampanjer");setAktivBoks(null);}} style={{width:"100%",marginTop:12,padding:"9px",background:"none",border:`1px solid ${C.border}`,borderRadius:8,fontSize:12,color:C.purple,fontWeight:700,cursor:"pointer"}}>Se alle kampanjer →</button>
        </div>
      )
    },
    {
      id:"signaturer",
      n:"4 288",
      label:"Signaturer totalt",
      bg:"#F0FDF4",
      color:C.green,
      border:"#BBF7D0",
      ikon:"✍️",
      innhold: () => (
        <div>
          <div style={{fontSize:13,color:C.green,fontWeight:700,marginBottom:12}}>✍️ Signaturer per kampanje</div>
          {KAMPANJER.map(k=>(
            <div key={k.id} style={{marginBottom:14}}>
              <div style={{fontSize:12,fontWeight:600,marginBottom:5,color:C.text}}>{k.tittel}</div>
              <Progress value={k.sig} max={k.mal} color={C.green}/>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted,marginTop:3}}>
                <span>{k.sig.toLocaleString("no")} signaturer</span>
                <span>{Math.round(k.sig/k.mal*100)}% av mål</span>
              </div>
            </div>
          ))}
          <div style={{background:"#D1FAE5",borderRadius:10,padding:"12px",textAlign:"center",marginTop:4}}>
            <div style={{fontSize:20,fontWeight:800,color:C.green,fontFamily:"'Playfair Display',serif"}}>4 288</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>totalt på tvers av alle kampanjer</div>
          </div>
        </div>
      )
    },
  ];

  return (
    <div>
      {/* Stat-bokser – kompakt og klikkbare */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:aktivBoks?0:20}}>
        {statBokser.map(s=>(
          <div key={s.id}
            onClick={()=>setAktivBoks(aktivBoks===s.id?null:s.id)}
            style={{background:s.bg,borderRadius:11,padding:"10px 14px",border:`1.5px solid ${aktivBoks===s.id?s.color:s.border}`,cursor:"pointer",transition:"all .15s",boxShadow:aktivBoks===s.id?`0 0 0 2px ${s.color}30`:"none"}}
            onMouseEnter={e=>{ if(aktivBoks!==s.id) e.currentTarget.style.borderColor=s.color; }}
            onMouseLeave={e=>{ if(aktivBoks!==s.id) e.currentTarget.style.borderColor=s.border; }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:20,fontWeight:800,color:s.color,fontFamily:"'Playfair Display',serif",lineHeight:1}}>{s.n}</div>
              <span style={{fontSize:15}}>{s.ikon}</span>
            </div>
            <div style={{fontSize:11,color:C.muted,marginTop:3,fontWeight:500,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span>{s.label}</span>
              <span style={{color:s.color,fontSize:10}}>{aktivBoks===s.id?"▲":"▼"}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Drill-down panel */}
      {aktivBoks&&(()=>{
        const boks = statBokser.find(s=>s.id===aktivBoks);
        return (
          <div style={{background:boks.bg,border:`1.5px solid ${boks.color}`,borderTop:"none",borderRadius:"0 0 14px 14px",padding:"16px 20px",marginBottom:20,maxHeight:360,overflowY:"auto"}}>
            {boks.innhold()}
          </div>
        );
      })()}

      {/* Søk */}
      <div style={{position:"relative",marginBottom:24}}>
        <span style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",fontSize:16,opacity:.4}}>🔍</span>
        <input placeholder="Søk i varsler, kampanjer og politikere..." value={søk} onChange={e=>setSøk(e.target.value)}
          style={{width:"100%",padding:"12px 16px 12px 42px",borderRadius:12,border:`1.5px solid ${C.border}`,fontSize:14,background:C.bgCard,color:C.text,fontFamily:"inherit"}}/>
      </div>

      {/* Mine fulgte saker */}
      {fulgte.length>0&&(
        <div style={{marginBottom:28}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <h2 style={{fontSize:16,fontWeight:800,fontFamily:"'Playfair Display',serif",color:C.redDark,margin:0}}>🔔 Saker jeg følger</h2>
            <button onClick={()=>setView("varsler")} style={{background:"none",border:"none",color:C.red,fontSize:12,fontWeight:700,cursor:"pointer"}}>Se i varselsoversikt →</button>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {VARSLER.filter(v=>fulgte.includes(v.id)).map(v=>(
              <div key={v.id} onClick={()=>setValgt(v)} style={{background:C.bgCard,border:"1px solid "+C.border,borderLeft:"3px solid "+(v.status==="kritisk"?C.red:v.status==="viktig"?C.amber:C.green),borderRadius:10,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,cursor:"pointer",flexWrap:"wrap"}}
                onMouseEnter={e=>e.currentTarget.style.boxShadow="0 2px 10px rgba(0,0,0,.07)"}
                onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:13,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v.tittel}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>{v.instans} · {v.dager}d igjen</div>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                  <span style={{fontSize:11,fontWeight:700,background:v.status==="kritisk"?"#FEE2E2":v.status==="viktig"?"#FEF3C7":"#F0FDF4",color:v.status==="kritisk"?C.red:v.status==="viktig"?C.amber:C.green,padding:"3px 9px",borderRadius:99}}>{v.status}</span>
                  <FølgKnapp sakId={v.id} fulgte={fulgte} toggleFølg={toggleFølg}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Nyeste varsler */}
      <div style={{marginBottom:32}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <h2 style={{fontSize:17,fontWeight:800,fontFamily:"'Playfair Display',serif",color:C.redDark}}>Nyeste varsler</h2>
          <button onClick={()=>setView("varsler")} style={{background:"none",border:"none",color:C.red,fontSize:13,fontWeight:700}}>Se alle {VARSLER.length} →</button>
        </div>
        <div style={{display:"flex",gap:14,overflowX:"auto",paddingBottom:8}}>
          {varslerData.slice(0,5).map(v=><VarselKort key={v.id} v={v} compact onClick={setValgt} fulgte={[]} toggleFølg={()=>{}}/>)}
          {filtered.length===0&&<div style={{fontSize:13,color:C.muted,padding:"20px 0"}}>Ingen saker matcher søket.</div>}
        </div>
      </div>

      {/* Nyeste kampanjer */}
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <h2 style={{fontSize:17,fontWeight:800,fontFamily:"'Playfair Display',serif",color:C.redDark}}>Aktive kampanjer</h2>
          <button onClick={()=>setView("kampanjer")} style={{background:"none",border:"none",color:C.red,fontSize:13,fontWeight:700}}>Se alle →</button>
        </div>
        <div style={{display:"flex",gap:14,overflowX:"auto",paddingBottom:8}}>
          {KAMPANJER.map(k=><KampanjeKort key={k.id} k={k} compact/>)}
        </div>
      </div>

      {valgt&&<SaksModal sak={valgt} kampanjer={KAMPANJER} onClose={()=>setValgt(null)}/>}
    </div>
  );
}

// ─── VarselKort ────────────────────────────────────────────────────────────
function VarselKort({v,compact=false,onClick,fulgte=[],toggleFølg=()=>{}}) {
  const ki=KATEGORIER.find(k=>k.id===v.kategori);
  const bc=v.status==="kritisk"?"#DC2626":v.status==="viktig"?"#D97706":"#16A34A";
  return (
    <div style={{background:C.bgCard,border:`1px solid ${C.border}`,borderRadius:14,padding:compact?"12px 14px":"16px 20px",borderLeft:`4px solid ${bc}`,flexShrink:0,width:compact?310:undefined,transition:"box-shadow .15s"}}
      onMouseEnter={e=>e.currentTarget.style.boxShadow="0 4px 20px rgba(0,0,0,.1)"}
      onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
      <div onClick={()=>onClick(v)} style={{cursor:"pointer"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:10}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",gap:5,marginBottom:6,flexWrap:"wrap",alignItems:"center"}}>
              {v.dager>=58&&<Badge color="#059669" bg="#D1FAE5" style={{fontSize:10,fontWeight:800}}>🆕 Ny</Badge>}
              {ki&&<Badge color={C.muted}>{ki.ikon} {ki.label}</Badge>}
              <NivåBadge nivå={v.nivå} sted={v.sted}/>
            </div>
            <div style={{fontSize:compact?13:14,fontWeight:700,lineHeight:1.35,color:C.text}}>{v.tittel}</div>
            {!compact&&<p style={{margin:"5px 0 0",fontSize:12,color:C.muted,lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{v.sammendrag}</p>}
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <Badge color={v.status==="kritisk"?C.red:v.status==="viktig"?C.amber:C.green} bg={v.status==="kritisk"?"#FEE2E2":v.status==="viktig"?"#FEF3C7":"#F0FDF4"}>{v.dager}d</Badge>
            <div style={{fontSize:10,color:C.muted,marginTop:4}}>{v.instans}</div>
          </div>
        </div>
      </div>
      {!compact&&(
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10,paddingTop:8,borderTop:`1px solid ${C.border}`}}>
          <span style={{fontSize:11,color:C.red,fontWeight:600,cursor:"pointer"}} onClick={()=>onClick(v)}>Åpne sak og mobiliser →</span>
          <FølgKnapp sakId={v.id} fulgte={fulgte} toggleFølg={toggleFølg}/>
        </div>
      )}
    </div>
  );
}

function KampanjeKort({k,compact=false}) {
  const [sig,setSig]=useState(k.sig);
  const [vis,setVis]=useState(false);
  const [signert,setSignert]=useState(false);
  const [navn,setNavn]=useState("");const [epost,setEpost]=useState("");
  return (
    <div style={{background:C.bgCard,border:`1px solid ${C.border}`,borderRadius:14,padding:"16px 18px",flexShrink:0,width:compact?290:undefined}}>
      <div style={{display:"flex",gap:5,marginBottom:7,flexWrap:"wrap"}}>
        {k.tags.map(t=><Badge key={t} color={C.muted}>{t}</Badge>)}
      </div>
      <h3 style={{margin:"0 0 6px",fontSize:compact?13:14,fontWeight:700,lineHeight:1.3}}>{k.tittel}</h3>
      {!compact&&<p style={{margin:"0 0 10px",fontSize:12,color:C.muted,lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{k.beskrivelse}</p>}
      <Progress value={sig} max={k.mal}/>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted,marginTop:4,marginBottom:10}}>
        <span><strong style={{color:C.text}}>{sig.toLocaleString("no")}</strong> / {k.mal.toLocaleString("no")}</span>
        <span>{k.dager}d igjen</span>
      </div>
      {signert?(
        <div style={{textAlign:"center",padding:"8px",background:"#F0FDF4",borderRadius:8,color:C.green,fontWeight:700,fontSize:12}}>✓ Du har signert!</div>
      ):vis?(
        <div>
          <input placeholder="Navn" value={navn} onChange={e=>setNavn(e.target.value)} style={{width:"100%",padding:"7px 10px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,marginBottom:6,boxSizing:"border-box",fontFamily:"inherit"}}/>
          <input placeholder="E-post" value={epost} onChange={e=>setEpost(e.target.value)} style={{width:"100%",padding:"7px 10px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,marginBottom:8,boxSizing:"border-box",fontFamily:"inherit"}}/>
          <div style={{display:"flex",gap:6}}>
            <Btn variant="primary" size="sm" style={{flex:1}} onClick={()=>{if(navn&&epost){setSig(s=>s+1);setSignert(true);setVis(false);}}}>Signer</Btn>
            <Btn variant="secondary" size="sm" onClick={()=>setVis(false)}>✕</Btn>
          </div>
        </div>
      ):(
        <Btn variant="primary" size="sm" style={{width:"100%"}} onClick={()=>setVis(true)}>Signer kampanjen</Btn>
      )}
    </div>
  );
}

// ─── Saksmodal ─────────────────────────────────────────────────────────────
function SaksModal({sak,onClose}) {
  const [tab,setTab]=useState("info");
  const [malModal,setMalModal]=useState(null);
  const [visNyKampanje,setVisNyKampanje]=useState(false);
  const [visFeedback,setVisFeedback]=useState(false);
  const [nyKampTittel,setNyKampTittel]=useState(`Stopp: ${sak.tittel}`);
  const [nyKampBeskr,setNyKampBeskr]=useState("");
  const [nyKampOpprettet,setNyKampOpprettet]=useState(false);
  const ki=KATEGORIER.find(k=>k.id===sak.kategori);
  const relPol=POLITIKERE.filter(p=>p.kategori.includes(sak.kategori)||p.nivå===sak.nivå);
  const relKampanjer=KAMPANJER.filter(k=>k.kategori===sak.kategori||k.sakId===sak.id);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      {malModal&&<MalModal type={malModal.type} kontekst={malModal.kontekst} onClose={()=>setMalModal(null)}/>}
      {visFeedback&&<FeedbackModal onClose={()=>setVisFeedback(false)} kontekst={{sakTittel:sak.tittel,type:"feil"}}/>}
      <div style={{background:C.bgCard,borderRadius:18,width:"100%",maxWidth:700,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(0,0,0,.3)"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"20px 24px 0",position:"sticky",top:0,background:C.bgCard,zIndex:1}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div style={{flex:1}}>
              <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                <Badge color={sak.status==="kritisk"?C.red:sak.status==="viktig"?C.amber:C.green} bg={sak.status==="kritisk"?"#FEE2E2":sak.status==="viktig"?"#FEF3C7":"#F0FDF4"}>{sak.dager}d igjen</Badge>
                {ki&&<Badge color={C.muted}>{ki.ikon} {ki.label}</Badge>}
                <NivåBadge nivå={sak.nivå} sted={sak.sted}/>
              </div>
              <h2 style={{margin:"0 0 5px",fontSize:18,fontWeight:800,fontFamily:"'Playfair Display',serif",color:C.redDark,lineHeight:1.25}}>{sak.tittel}</h2>
              <p style={{margin:"0 0 4px",fontSize:13,color:C.muted,lineHeight:1.5}}>{sak.sammendrag}</p>
            </div>
            <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:C.muted,marginLeft:12,flexShrink:0,padding:4}}>✕</button>
          </div>
          <div style={{display:"flex",gap:0,marginTop:16,borderBottom:`1px solid ${C.border}`}}>
            {[["info","ℹ️ Info"],["mobiliser","📬 Mobiliser"],["kampanje","✊ Kampanje"],["horingssvar","📝 Høringssvar"],["del","🔗 Del"]].map(([id,lbl])=>(
              <button key={id} onClick={()=>setTab(id)} style={{padding:"8px 14px",border:"none",borderBottom:`2.5px solid ${tab===id?C.red:"transparent"}`,background:"none",fontSize:12,color:tab===id?C.red:C.muted,fontWeight:tab===id?700:500,marginBottom:-1,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                {lbl}{id==="kampanje"&&relKampanjer.length>0&&<span style={{marginLeft:4,background:C.red,color:"#fff",borderRadius:99,fontSize:10,padding:"1px 6px"}}>{relKampanjer.length}</span>}
              </button>
            ))}
          </div>
        </div>
        <div style={{padding:"20px 24px 24px"}}>

          {/* INFO */}
          {tab==="info"&&(
            <div>
              <div style={{background:C.bgAlt,borderRadius:12,padding:"14px 18px",marginBottom:16,fontSize:14,lineHeight:1.65,color:C.text}}>{sak.sammendrag}</div>
              <a href={sak.kilde} target="_blank" rel="noreferrer" style={{display:"flex",alignItems:"center",gap:8,background:"#EEF2FF",border:"1px solid #C7D2FE",borderRadius:10,padding:"12px 16px",color:C.komBlue,fontWeight:600,fontSize:14,marginBottom:14}}>
                🔗 Les fullstendig sak hos {sak.instans} <span style={{marginLeft:"auto",opacity:.6}}>↗</span>
              </a>
              <div style={{display:"flex",gap:8}}>
                <Btn variant="primary" style={{flex:1}} onClick={()=>setTab("mobiliser")}>📬 Kontakt politikere →</Btn>
                <Btn variant="secondary" style={{flex:1}} onClick={()=>setTab("horingssvar")}>📝 Skriv høringssvar →</Btn>
              </div>
              {relKampanjer.length>0&&(
                <div style={{marginTop:12,background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#C2410C",display:"flex",alignItems:"center",gap:8,cursor:"pointer"}} onClick={()=>setTab("kampanje")}>
                  ✊ <strong>{relKampanjer.length} aktiv kampanje</strong> på denne saken – klikk for å signe →
                </div>
              )}
              <div style={{marginTop:16,borderTop:"1px solid "+C.border,paddingTop:12,display:"flex",justifyContent:"flex-end"}}>
                <button onClick={()=>setVisFeedback(true)} style={{background:"none",border:"none",color:C.muted,fontSize:12,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:5}}>
                  ⚠️ Rapporter feil eller mangler i denne saken
                </button>
              </div>
            </div>
          )}

          {/* MOBILISER – politikere med malkoblinger */}
          {tab==="mobiliser"&&(
            <div>
              <div style={{background:"#EEF2FF",border:"1px solid #C7D2FE",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:C.komBlue}}>
                💡 Klikk på en politiker for å åpne forhåndsutfylt brevmal. Tilpass og send direkte fra dialogen.
              </div>
              {relPol.length===0&&(
                <div style={{fontSize:13,color:C.muted,padding:"16px 0"}}>Ingen direkte treff – gå til Mobiliser-siden for å søke opp politikere.</div>
              )}
              {relPol.map(p=>(
                <div key={p.id} style={{background:C.bgCard,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 14px",marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:14}}>{p.navn}</div>
                      <div style={{fontSize:12,color:C.muted}}>{p.rolle} · {p.sted}</div>
                      <div style={{fontSize:11,color:C.muted,marginTop:1}}>{p.kontakt}</div>
                    </div>
                    <span style={{background:PARTIFARGE[p.parti]||C.red,color:"#fff",padding:"3px 10px",borderRadius:99,fontSize:12,fontWeight:700}}>{p.parti}</span>
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <Btn variant="ghost" size="sm" style={{flex:1}} onClick={()=>setMalModal({type:"politiker",kontekst:{...p,sakTittel:sak.tittel}})}>
                      ✍️ Skriv brev med mal
                    </Btn>
                    <button onClick={()=>window.open(`mailto:${p.kontakt}`)}
                      style={{padding:"7px 12px",borderRadius:7,border:`1px solid ${C.border}`,background:C.bgAlt,fontSize:12,fontWeight:600,cursor:"pointer",color:C.muted,fontFamily:"inherit"}}>
                      📧 E-post direkte
                    </button>
                  </div>
                </div>
              ))}

              {/* Stortingskomité-snarveier */}
              <div style={{marginTop:16,borderTop:`1px solid ${C.border}`,paddingTop:16}}>
                <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".04em",marginBottom:10}}>Anbefalt komité for denne saken</div>
                <div style={{background:"#EEF2FF",border:"1px solid #C7D2FE",borderRadius:12,padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:13,color:C.komBlue}}>Familie- og kulturkomiteen</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:2}}>familie-og-kulturkomiteen@stortinget.no</div>
                  </div>
                  <Btn variant="kom" size="sm" onClick={()=>setMalModal({type:"komite",kontekst:{navn:"Familie- og kulturkomiteen",kontakt:"familie-og-kulturkomiteen@stortinget.no"}})}>
                    Kontakt komiteen
                  </Btn>
                </div>
              </div>
            </div>
          )}

          {/* KAMPANJE */}
          {tab==="kampanje"&&(
            <div>
              {/* Eksisterende kampanjer koblet til saken */}
              {relKampanjer.length>0&&(
                <div style={{marginBottom:20}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:12}}>✊ Aktive kampanjer på denne saken</div>
                  {relKampanjer.map(k=>(
                    <div key={k.id} style={{background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:12,padding:"14px 16px",marginBottom:10}}>
                      <h3 style={{fontSize:14,fontWeight:700,marginBottom:8}}>{k.tittel}</h3>
                      <p style={{fontSize:12,color:C.muted,lineHeight:1.5,marginBottom:10}}>{k.beskrivelse}</p>
                      <Progress value={k.sig} max={k.mal} color="#EA580C"/>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted,marginTop:4,marginBottom:12}}>
                        <span><strong style={{color:C.text}}>{k.sig.toLocaleString("no")}</strong> / {k.mal.toLocaleString("no")} signaturer</span>
                        <span>{k.dager}d igjen</span>
                      </div>
                      <KampanjeSignerMini k={k}/>
                    </div>
                  ))}
                </div>
              )}

              {/* Ingen kampanje – opprett */}
              <div style={{borderTop:relKampanjer.length>0?`1px solid ${C.border}`:"none",paddingTop:relKampanjer.length>0?16:0}}>
                <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:6}}>
                  {relKampanjer.length>0?"➕ Opprett en ny kampanje på denne saken":"Ingen aktiv kampanje ennå"}
                </div>
                <div style={{fontSize:12,color:C.muted,marginBottom:12,lineHeight:1.5}}>
                  Kampanjer samler underskrifter og gir politisk tyngde. Du kan starte en kampanje direkte koblet til denne saken.
                </div>
                {!visNyKampanje&&!nyKampOpprettet&&(
                  <Btn variant="primary" style={{width:"100%"}} onClick={()=>setVisNyKampanje(true)}>
                    ✊ Start kampanje på denne saken
                  </Btn>
                )}
                {visNyKampanje&&!nyKampOpprettet&&(
                  <div style={{background:C.bgAlt,borderRadius:12,padding:"16px"}}>
                    <div style={{marginBottom:10}}>
                      <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".04em",marginBottom:5}}>Kampanjetittel</div>
                      <input value={nyKampTittel} onChange={e=>setNyKampTittel(e.target.value)}
                        style={{width:"100%",padding:"9px 12px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,boxSizing:"border-box",fontFamily:"inherit",background:C.bgCard}}/>
                    </div>
                    <div style={{marginBottom:14}}>
                      <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".04em",marginBottom:5}}>Hva krever dere? (vises til underskrivere)</div>
                      <textarea value={nyKampBeskr} onChange={e=>setNyKampBeskr(e.target.value)} rows={3}
                        style={{width:"100%",padding:"9px 12px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,resize:"vertical",lineHeight:1.5,boxSizing:"border-box",fontFamily:"inherit",background:C.bgCard}}
                        placeholder={`Vi krever at ${sak.instans} trekker tilbake forslaget og sikrer...`}/>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <Btn variant="primary" style={{flex:1}} onClick={()=>{if(nyKampTittel)setNyKampOpprettet(true);}}>Opprett kampanje</Btn>
                      <Btn variant="secondary" size="sm" onClick={()=>setVisNyKampanje(false)}>Avbryt</Btn>
                    </div>
                  </div>
                )}
                {nyKampOpprettet&&(
                  <div style={{background:"#F0FDF4",border:"1px solid #86EFAC",borderRadius:12,padding:"20px",textAlign:"center"}}>
                    <div style={{fontSize:32,marginBottom:8}}>🎉</div>
                    <div style={{fontWeight:800,fontSize:15,color:C.green,marginBottom:4}}>Kampanje opprettet!</div>
                    <div style={{fontSize:12,color:C.muted,marginBottom:12}}>"{nyKampTittel}" er nå aktiv og synlig for alle som følger denne saken.</div>
                    <Btn variant="secondary" size="sm" onClick={()=>navigator.clipboard?.writeText(`https://kulturvarsling.no/kampanje/ny`)}>Kopier lenke</Btn>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab==="horingssvar"&&<HøringssvarMini sak={sak}/>}
          {tab==="del"&&<DelMini sak={sak}/>}
        </div>
      </div>
    </div>
  );
}

function KampanjeSignerMini({k}) {
  const [sig,setSig]=useState(k.sig);
  const [signert,setSignert]=useState(false);
  const [vis,setVis]=useState(false);
  const [navn,setNavn]=useState(""); const [epost,setEpost]=useState("");
  if(signert) return <div style={{textAlign:"center",padding:"8px",background:"#F0FDF4",borderRadius:8,color:C.green,fontWeight:700,fontSize:12}}>✓ Du har signert!</div>;
  if(vis) return (
    <div>
      <input placeholder="Navn" value={navn} onChange={e=>setNavn(e.target.value)} style={{width:"100%",padding:"7px 10px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,marginBottom:6,boxSizing:"border-box",fontFamily:"inherit"}}/>
      <input placeholder="E-post" value={epost} onChange={e=>setEpost(e.target.value)} style={{width:"100%",padding:"7px 10px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,marginBottom:8,boxSizing:"border-box",fontFamily:"inherit"}}/>
      <div style={{display:"flex",gap:6}}>
        <Btn variant="primary" size="sm" style={{flex:1,background:"#EA580C"}} onClick={()=>{if(navn&&epost){setSig(s=>s+1);setSignert(true);}}}>Signer</Btn>
        <Btn variant="secondary" size="sm" onClick={()=>setVis(false)}>✕</Btn>
      </div>
    </div>
  );
  return <Btn variant="primary" size="sm" style={{width:"100%",background:"#EA580C"}} onClick={()=>setVis(true)}>✊ Signer denne kampanjen</Btn>;
}

function HøringssvarMini({sak}) {
  const [visHjelp,setVisHjelp]=useState(false);
  const [tekst,setTekst]=useState(
    "Høringssvar \u2013 "+sak.tittel+"\n\nFra: [Organisasjonsnavn]\nTil: "+sak.instans+"\nDato: "+new Date().toLocaleDateString("no-NO")+"\n\n--- Vår vurdering ---\n[Skriv din vurdering her. Vær konkret og bruk fakta.]\n\n--- Konsekvenser for vårt felt ---\n[Hva betyr dette for din organisasjon eller gruppe?]\n\n--- Konklusjon og krav ---\n[Skriv tydelig hva dere krever eller anbefaler]\n\nMed vennlig hilsen,\n[Navn, tittel]\n[Organisasjon]\n[E-post / telefon]"
  );
  const [kopiert,setKopiert]=useState(false);
  const [sendt,setSendt]=useState(false);
  if(sendt) return (
    <div style={{textAlign:"center",padding:"32px 0"}}>
      <div style={{fontSize:36,marginBottom:10}}>✅</div>
      <div style={{fontWeight:700,color:C.green,marginBottom:6}}>Høringssvar åpnet i e-postklient!</div>
      <div style={{fontSize:13,color:C.muted,lineHeight:1.55}}>Sjekk at e-posten gikk til riktig adresse hos {sak.instans}.<br/>Finner du ikke adressen? Gå til <a href={sak.kilde} target="_blank" rel="noreferrer" style={{color:C.komBlue}}>{sak.instans} ↗</a></div>
    </div>
  );
  return (
    <div>
      <div onClick={()=>setVisHjelp(v=>!v)} style={{background:"#EEF2FF",border:"1px solid #C7D2FE",borderRadius:10,padding:"10px 14px",marginBottom:12,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:13,fontWeight:600,color:C.komBlue}}>💡 Hva er et høringssvar – og hvorfor nytter det?</span>
        <span style={{color:C.komBlue,fontSize:12}}>{visHjelp?"▲":"▼"}</span>
      </div>
      {visHjelp&&(
        <div style={{background:"#EEF2FF",borderRadius:10,padding:"14px 16px",marginBottom:12,fontSize:13,color:C.text,lineHeight:1.65}}>
          <p style={{marginBottom:8}}>Et <strong>høringssvar</strong> er et formelt skriftlig innspill til en offentlig prosess. Når myndigheter eller kommuner vurderer en beslutning, sendes forslaget på «høring» – en periode der alle kan uttale seg.</p>
          <p style={{marginBottom:8}}><strong>Hvorfor nytter det?</strong> Høringssvar er offentlige dokumenter som politikere er lovpålagt å vurdere. Mange innspill med sammenfallende syn kan endre utfall – særlig lokalt og regionalt.</p>
          <p style={{color:C.muted,fontSize:12,marginBottom:0}}>Tips: Vær konkret, bruk tall og fakta, og avslutt med tydelige krav – ikke bare generell protest.</p>
        </div>
      )}
      <div style={{background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:13,color:"#92400E"}}>
        <strong>📬 Lever svaret til:</strong> {sak.instans} –{" "}
        <a href={sak.kilde} target="_blank" rel="noreferrer" style={{color:C.komBlue,fontWeight:600}}>finn offisiell innleveringsside ↗</a>
      </div>
      <textarea value={tekst} onChange={e=>setTekst(e.target.value)} rows={12}
        style={{width:"100%",padding:12,borderRadius:8,border:"1px solid "+C.border,fontSize:12,lineHeight:1.65,resize:"vertical",boxSizing:"border-box",fontFamily:"monospace",color:C.text}}/>
      <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
        <Btn variant="primary" style={{flex:1,background:C.green,minWidth:160}} onClick={()=>{
          window.open("mailto:?subject="+encodeURIComponent("Høringssvar \u2013 "+sak.tittel)+"&body="+encodeURIComponent(tekst));
          setSendt(true);
        }}>📧 Åpne i e-postklient</Btn>
        <Btn variant="secondary" onClick={()=>{navigator.clipboard?.writeText(tekst);setKopiert(true);setTimeout(()=>setKopiert(false),2500);}}>
          {kopiert?"✓ Kopiert!":"📋 Kopier tekst"}
        </Btn>
      </div>
      <div style={{fontSize:11,color:C.muted,marginTop:8,lineHeight:1.5}}>Ingen e-postklient? Kopier teksten og lim inn i webmail. Adressen finner du hos {sak.instans}.</div>
    </div>
  );
}

function DelMini({sak}) {
  const [kopiert,setKopiert]=useState(false);
  const [epostSendt,setEpostSendt]=useState(false);
  const url="https://kulturvarsling.no/sak/"+sak.id;
  const delTekst="🔔 "+sak.tittel+"\nFrist: "+new Date(sak.frist).toLocaleDateString("no-NO")+" ("+sak.dager+"d igjen)\n"+sak.instans+"\n"+url;
  const epostBody="Hei,\n\nJeg vil dele en sak fra Kulturvarsling.no som kan være relevant for deg:\n\n"+sak.tittel+"\nFrist: "+new Date(sak.frist).toLocaleDateString("no-NO")+"\n\nLes mer og bidra: "+url+"\n\nSaken kort:\n"+sak.sammendrag;
  return (
    <div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".04em",marginBottom:6}}>Direktelenke</div>
        <div style={{display:"flex",gap:8,alignItems:"center",background:C.bgAlt,borderRadius:8,padding:"9px 12px"}}>
          <span style={{fontFamily:"monospace",fontSize:11,color:C.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{url}</span>
          <Btn variant="secondary" size="sm" onClick={()=>{navigator.clipboard?.writeText(url);setKopiert(true);setTimeout(()=>setKopiert(false),2000);}}>
            {kopiert?"✓":"Kopier"}
          </Btn>
        </div>
      </div>
      <div style={{background:C.bgAlt,borderRadius:10,padding:12,fontFamily:"monospace",fontSize:12,lineHeight:1.6,whiteSpace:"pre-wrap",marginBottom:12,color:C.text}}>{delTekst}</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <Btn variant="primary" style={{background:kopiert?C.green:C.red}} onClick={()=>{navigator.clipboard?.writeText(delTekst);setKopiert(true);setTimeout(()=>setKopiert(false),2000);}}>
          {kopiert?"✓ Kopiert!":"📋 Kopier innlegg"}
        </Btn>
        <button onClick={()=>{window.open("mailto:?subject="+encodeURIComponent("Viktig kultursak: "+sak.tittel)+"&body="+encodeURIComponent(epostBody));setEpostSendt(true);}}
          style={{padding:"9px 14px",background:"#fff",border:"1px solid "+C.border,borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",color:epostSendt?C.green:C.text,fontFamily:"inherit"}}>
          {epostSendt?"✓ Åpnet":"📧 Del via e-post"}
        </button>
        {[["Facebook","#1877F2","https://www.facebook.com/sharer/sharer.php?u="],["LinkedIn","#0A66C2","https://www.linkedin.com/sharing/share-offsite/?url="]].map(([n,c,u])=>(
          <button key={n} style={{padding:"9px 14px",background:c,color:"#fff",border:"none",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}
            onClick={()=>window.open(u+encodeURIComponent(url))}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── VARSLER / KAMPANJER / MOBILISER (forenklet) ──────────────────────────
function BrukerVarsler({fulgte=[],toggleFølg=()=>{},varslerData=VARSLER}) {
  const [valgt,setValgt]=useState(null);
  const [søk,setSøk]=useState("");
  const [katFilter,setKatFilter]=useState([]);
  const [nivåFilter,setNivåFilter]=useState([]);
  const [statusFilter,setStatusFilter]=useState([]);
  const [visFulgte,setVisFulgte]=useState(false);
  const filtered=useMemo(()=>varslerData.filter(v=>{
    if(katFilter.length>0&&!katFilter.includes(v.kategori)) return false;
    if(nivåFilter.length>0&&!nivåFilter.includes(v.nivå)) return false;
    if(statusFilter.length>0&&!statusFilter.includes(v.status)) return false;
    if(visFulgte&&!fulgte.includes(v.id)) return false;
    if(søk){
      const q=søk.toLowerCase();
      if(!v.tittel.toLowerCase().includes(q)&&!v.sammendrag.toLowerCase().includes(q)&&!v.instans.toLowerCase().includes(q)&&!v.sted.toLowerCase().includes(q)) return false;
    }
    return true;
  }),[søk,katFilter,nivåFilter,statusFilter,visFulgte,fulgte,varslerData]);

  const antallFilter=katFilter.length+nivåFilter.length+statusFilter.length+(visFulgte?1:0);

  return (
    <div>
      {/* Søk + filter */}
      <div style={{background:C.bgCard,border:`1px solid ${C.border}`,borderRadius:14,padding:"16px 18px",marginBottom:18}}>
        <div style={{position:"relative",marginBottom:12}}>
          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",opacity:.4}}>🔍</span>
          <input placeholder="Søk i tittel, sammendrag, instans, sted..." value={søk} onChange={e=>setSøk(e.target.value)}
            style={{width:"100%",padding:"10px 14px 10px 36px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:14,boxSizing:"border-box",background:C.bg,fontFamily:"inherit"}}/>
        </div>

        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
          <span style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".04em",alignSelf:"center",marginRight:4}}>Fagfelt</span>
          {KATEGORIER.map(k=>(
            <button key={k.id} onClick={()=>setKatFilter(p=>p.includes(k.id)?p.filter(x=>x!==k.id):[...p,k.id])}
              style={{padding:"4px 10px",borderRadius:99,border:`1.5px solid ${katFilter.includes(k.id)?C.red:C.border}`,background:katFilter.includes(k.id)?C.red:"none",color:katFilter.includes(k.id)?"#fff":C.text,fontSize:12,cursor:"pointer",fontWeight:katFilter.includes(k.id)?700:400,fontFamily:"inherit"}}>
              {k.ikon} {k.label}
            </button>
          ))}
        </div>

        <div style={{display:"flex",gap:6,flexWrap:"wrap",paddingTop:8,borderTop:`1px solid ${C.border}`}}>
          <span style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".04em",alignSelf:"center",marginRight:4}}>Nivå</span>
          {[["nasjonalt","🏛 Nasjonalt"],["fylke","🗺 Fylke"],["kommune","📍 Kommune"]].map(([id,lbl])=>(
            <button key={id} onClick={()=>setNivåFilter(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])}
              style={{padding:"4px 10px",borderRadius:99,border:`1.5px solid ${nivåFilter.includes(id)?C.komBlue:C.border}`,background:nivåFilter.includes(id)?C.komBlue:"none",color:nivåFilter.includes(id)?"#fff":C.text,fontSize:12,cursor:"pointer",fontWeight:nivåFilter.includes(id)?700:400,fontFamily:"inherit"}}>
              {lbl}
            </button>
          ))}
          <span style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".04em",alignSelf:"center",marginLeft:8,marginRight:4}}>Status</span>
          {[["kritisk","⚠️ Kritisk","#DC2626"],["viktig","📌 Viktig","#D97706"],["normal","📄 Normal","#16A34A"]].map(([id,lbl,c])=>(
            <button key={id} onClick={()=>setStatusFilter(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])}
              style={{padding:"4px 10px",borderRadius:99,border:`1.5px solid ${statusFilter.includes(id)?c:C.border}`,background:statusFilter.includes(id)?c+"18":"none",color:statusFilter.includes(id)?c:C.text,fontSize:12,cursor:"pointer",fontWeight:statusFilter.includes(id)?700:400,fontFamily:"inherit"}}>
              {lbl}
            </button>
          ))}
          {fulgte.length>0&&(
            <button onClick={()=>setVisFulgte(v=>!v)}
              style={{padding:"4px 10px",borderRadius:99,border:`1.5px solid ${visFulgte?C.red:C.border}`,background:visFulgte?C.red:"none",color:visFulgte?"#fff":C.text,fontSize:12,cursor:"pointer",fontWeight:visFulgte?700:400,fontFamily:"inherit",marginLeft:8}}>
              🔔 Mine fulgte ({fulgte.length})
            </button>
          )}
          {antallFilter>0&&(
            <button onClick={()=>{setKatFilter([]);setNivåFilter([]);setStatusFilter([]);setVisFulgte(false);}}
              style={{padding:"4px 10px",borderRadius:99,border:`1px solid ${C.red}`,background:"none",color:C.red,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>
              ✕ Nullstill filter ({antallFilter})
            </button>
          )}
        </div>
      </div>

      <div style={{fontSize:12,color:C.muted,marginBottom:10}}>{filtered.length} saker{antallFilter>0?" (filtrert)":""}</div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {filtered.map(v=><VarselKort key={v.id} v={v} onClick={setValgt} fulgte={fulgte} toggleFølg={toggleFølg}/>)}
        {filtered.length===0&&<div style={{textAlign:"center",padding:"40px",color:C.muted,fontSize:14}}>Ingen saker matcher filteret. <button onClick={()=>{setKatFilter([]);setNivåFilter([]);setStatusFilter([]);setSøk("");setVisFulgte(false);}} style={{background:"none",border:"none",color:C.red,fontWeight:700,cursor:"pointer"}}>Nullstill</button></div>}
      </div>
      {valgt&&<SaksModal sak={valgt} kampanjer={KAMPANJER} onClose={()=>setValgt(null)}/>}
    </div>
  );
}

function BrukerKampanjer({kampanjerData=KAMPANJER,varslerData=VARSLER,user=null}) {
  const [valgt,setValgt]=useState(null);
  const [sort,setSort]=useState("frist");
  const sorted=useMemo(()=>[...kampanjerData].sort((a,b)=>{
    if(sort==="frist") return a.dager-b.dager;
    if(sort==="fremgang") return (b.sig/b.mal)-(a.sig/a.mal);
    if(sort==="signaturer") return b.sig-a.sig;
    return 0;
  }),[sort]);
  return (
    <div>
      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:16,flexWrap:"wrap"}}>
        <span style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".04em"}}>Sorter:</span>
        {[["frist","⏰ Frist"],["fremgang","📈 Fremgang"],["signaturer","✍️ Signaturer"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setSort(id)}
            style={{padding:"5px 12px",borderRadius:99,border:"1.5px solid "+(sort===id?C.red:C.border),background:sort===id?C.red:"none",color:sort===id?"#fff":C.text,fontSize:12,cursor:"pointer",fontWeight:sort===id?700:400,fontFamily:"inherit"}}>
            {lbl}
          </button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}} className="grid-2">
        {sorted.map(k=>{
          const relSak=k.sakId?varslerData.find(v=>v.id===k.sakId):null;
          return (
            <div key={k.id} style={{background:C.bgCard,border:"1px solid "+C.border,borderRadius:14,padding:"16px 18px"}}>
              <div style={{display:"flex",gap:5,marginBottom:8,flexWrap:"wrap"}}>
                {k.tags.map(t=><Badge key={t} color={C.muted}>{t}</Badge>)}
              </div>
              <h3 style={{fontSize:14,fontWeight:700,marginBottom:6,lineHeight:1.3}}>{k.tittel}</h3>
              <p style={{fontSize:12,color:C.muted,lineHeight:1.5,marginBottom:10,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{k.beskrivelse}</p>
              {relSak&&(
                <div onClick={()=>setValgt(relSak)} style={{background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:8,padding:"7px 11px",marginBottom:10,cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:11}}>📋</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#92400E",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>Tilknyttet sak: {relSak.tittel}</div>
                    <div style={{fontSize:10,color:C.muted,marginTop:1}}>{relSak.instans} · {relSak.dager}d igjen</div>
                  </div>
                  <span style={{fontSize:10,color:"#92400E",fontWeight:700,flexShrink:0}}>Åpne →</span>
                </div>
              )}
              <KampanjeKort k={k} compact/>
            </div>
          );
        })}
      </div>
      {valgt&&<SaksModal sak={valgt} kampanjer={KAMPANJER} onClose={()=>setValgt(null)}/>}
    </div>
  );
}

// ─── MAL-MODAL ────────────────────────────────────────────────────────────────
const MAL_TEMPLATES = {
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
    { id:"seier", label:"Pressemelding – seier / positiv sak", tekst:()=>`PRESSEMELDING\n${new Date().toLocaleDateString("no-NO")}\n\n[TITTEL: Positiv nyhet for kulturfeltet]\n\n[Organisasjon] er glad for at [beslutning/vedtak] nå er [fattet/vedtatt/bekreftet].\n\n«[Sitat fra leder]», sier [navn og tittel].\n\nDette betyr at [konkret konsekvens for feltet].\n\nBakgrunn: [Kort historikk om saken]\n\nFor mer informasjon:\n[Kontaktinfo]\n\n###` },
  ],
  sosiale: [
    { id:"facebook", label:"Facebook-innlegg", tekst:(sak)=>`🔔 VIKTIG SAK FOR KULTURFELTET!\n\n${sak?.tittel||"[Sakstittel]"}\n\n${sak?.sammendrag||"[Kort beskrivelse av saken]"}\n\nFrist: ${sak?.frist?new Date(sak.frist).toLocaleDateString("no-NO"):"[dato]"} – det er bare ${sak?.dager||"X"} dager igjen!\n\nHva kan du gjøre?\n✅ Signer kampanjen\n✅ Send høringssvar\n✅ Kontakt din lokale politiker\n\nDel gjerne – jo flere vi er, jo sterkere stemme har vi! 💪\n\n#kulturvarsling #kulturpolitikk #norskkultur` },
    { id:"twitter", label:"X/Twitter-tråd (3 tweets)", tekst:(sak)=>`TRÅD 🧵\n\n1/ ${sak?.tittel||"Viktig sak"}: ${sak?.sammendrag?.slice(0,100)||"[Beskrivelse]"}... Frist om ${sak?.dager||"X"} dager. Her er hva du bør vite 👇\n\n2/ Saken behandles av ${sak?.instans||"[instans]"}. Det betyr at [forklaring av hvem som bestemmer og hvordan]. Ditt høringssvar teller!\n\n3/ Hva gjør du nå? → Gå til kulturvarsling.no/sak/${sak?.id||"1"} for ferdig mal til høringssvar og direkte kontakt med ansvarlig politiker. Ta 5 minutter – det nytter! #kulturpolitikk` },
    { id:"instagram", label:"Instagram-caption", tekst:(sak)=>`⚠️ ${sak?.dager||"X"} DAGER IGJEN\n\n${sak?.tittel||"Viktig sak for kulturfeltet"}\n\n${sak?.sammendrag||"Beskriv saken her"}\n\nVil du gjøre noe? Link i bio → kulturvarsling.no\n\n.\n.\n.\n#kulturvarsling #norskkultur #kulturpolitikk #kunst #musikk #scenekunst #demokrati` },
  ],
};

function MalModal({type, kontekst, onClose, onSend=()=>{}, user=null}) {
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

  useState(()=>{
    if(currentMal) {
      let t="";
      if(type==="komite") t=currentMal.tekst(kontekst?.navn||"Familie- og kulturkomiteen");
      else if(type==="politiker") t=currentMal.tekst(kontekst||{navn:"[Politikernavn]"});
      else t=currentMal.tekst(kontekst);
      setTekst(applyUserFill(t));
    }
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

  const titler = {komite:"📬 Kontakt stortingskomité",politiker:"👤 Kontakt politiker",horing:"📝 Skriv høringssvar",pressem:"📰 Pressemelding",sosiale:"📱 Sosiale medier"};
  const sendLabel = {komite:"Send til komiteen",politiker:`Send til ${kontekst?.navn||"politikeren"}`,horing:"Send høringssvar",pressem:"Kopier og send til media",sosiale:"Kopier tekst"};
  const canSend = ["komite","politiker","horing"].includes(type);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.58)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div style={{background:C.bgCard,borderRadius:18,width:"100%",maxWidth:680,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 28px 70px rgba(0,0,0,.3)",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{padding:"20px 24px",borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,background:C.bgCard,zIndex:1}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <h2 style={{fontSize:17,fontWeight:800,fontFamily:"'Playfair Display',serif",color:C.redDark}}>{titler[type]}</h2>
            <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,color:C.muted,cursor:"pointer"}}>✕</button>
          </div>
          {kontekst&&(type==="komite"||type==="politiker")&&(
            <div style={{background:type==="komite"?"#EEF2FF":C.bgAlt,border:`1px solid ${type==="komite"?"#C7D2FE":C.border}`,borderRadius:10,padding:"10px 14px",fontSize:13}}>
              <strong style={{color:type==="komite"?C.komBlue:C.text}}>{kontekst.navn}</strong>
              {kontekst.rolle&&<span style={{color:C.muted}}> · {kontekst.rolle}</span>}
              {kontekst.kontakt&&<div style={{fontSize:11,color:C.muted,marginTop:2}}>{kontekst.kontakt}</div>}
            </div>
          )}
        </div>

        <div style={{padding:"20px 24px",flex:1}}>
          {/* Malvalg */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".05em",marginBottom:8}}>Velg mal</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {maler.map(m=>(
                <button key={m.id} onClick={()=>velgMal(m.id)}
                  style={{padding:"7px 14px",borderRadius:8,border:`1.5px solid ${valgtMal===m.id?C.red:C.border}`,background:valgtMal===m.id?C.red:"none",color:valgtMal===m.id?"#fff":C.muted,fontSize:12,cursor:"pointer",fontWeight:valgtMal===m.id?700:400,fontFamily:"inherit",transition:"all .15s"}}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tips */}
          <div style={{background:"#FEF3C7",border:"1px solid #FCD34D",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:C.amber,display:"flex",gap:8,alignItems:"flex-start"}}>
            <span style={{flexShrink:0}}>💡</span>
            <span>Malen er forhåndsutfylt. Tekst i <strong>[klammer]</strong> skal erstattes med dine egne ord. Jo mer konkret og personlig, jo bedre effekt.</span>
          {user?.org&&<div style={{background:"#F0FDF4",border:"1px solid #86EFAC",borderRadius:7,padding:"8px 12px",marginTop:8,fontSize:12,color:C.green}}>✓ Organisasjonsnavn og kontaktinfo er fylt inn automatisk fra din profil.</div>}
          </div>

          {/* Textarea */}
          {sendt ? (
            <div style={{textAlign:"center",padding:"48px 20px"}}>
              <div style={{fontSize:48,marginBottom:12}}>✅</div>
              <div style={{fontSize:18,fontWeight:800,color:C.green,fontFamily:"'Playfair Display',serif",marginBottom:6}}>Sendt!</div>
              <div style={{fontSize:13,color:C.muted,marginBottom:20}}>Meldingen er registrert og sendt.</div>
              <Btn variant="secondary" onClick={()=>setSendt(false)}>Skriv ny melding</Btn>
            </div>
          ) : (
            <>
              <textarea value={tekst} onChange={e=>setTekst(e.target.value)} rows={16}
                style={{width:"100%",padding:14,borderRadius:10,border:`1.5px solid ${C.border}`,fontSize:13,lineHeight:1.65,resize:"vertical",boxSizing:"border-box",fontFamily:"'DM Sans',monospace",color:C.text,background:C.bg}}/>
              <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
                {canSend&&(
                  <Btn variant="primary" style={{flex:1}} onClick={()=>{
                    setSendt(true);
                    onSend({type,tittel:`${type==="horing"?"Høringssvar":type==="komite"?"Komitéhenvendelse":"Politikerkontakt"}: ${kontekst?.tittel||kontekst?.navn||"Ukjent"}`,mottaker:kontekst?.kontakt||kontekst?.navn||null});
                  }}>
                    📤 {sendLabel[type]}
                  </Btn>
                )}
                <Btn variant="secondary" onClick={()=>{navigator.clipboard?.writeText(tekst);setKopiert(true);setTimeout(()=>setKopiert(false),2000);}}>
                  {kopiert?"✓ Kopiert!":"📋 Kopier tekst"}
                </Btn>
                {type==="politiker"&&kontekst?.kontakt&&(
                  <Btn variant="secondary" onClick={()=>window.open(`mailto:${kontekst.kontakt}?body=${encodeURIComponent(tekst)}`)}>
                    📧 Åpne i e-post
                  </Btn>
                )}
              </div>
              <div style={{marginTop:12,fontSize:11,color:C.muted,textAlign:"center"}}>
                Meldingen inneholder {tekst.length} tegn · {tekst.split(/\[.*?\]/).length-1} felt gjenstår å fylle ut
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MOBILISER ────────────────────────────────────────────────────────────────
const KOMITEER_DATA = [
  {id:"familie", navn:"Familie- og kulturkomiteen", kontakt:"familie-og-kulturkomiteen@stortinget.no", leder:"Knut Storberget (Ap)", felt:["Scenekunst","Musikk","Dans","Opera","Film","Litteratur","Visuell kunst","Museer","Spill","Kulturarv"], url:"https://www.stortinget.no/no/Representanter-og-komiteer/Komiteene/Familie-og-kulturkomiteen/"},
  {id:"finans",  navn:"Finanskomiteen",              kontakt:"finanskomiteen@stortinget.no",           leder:"Marianne Lunde (H)",   felt:["Budsjett","Tilskudd","Skatt"], url:"https://www.stortinget.no/no/Representanter-og-komiteer/Komiteene/Finanskomiteen/"},
  {id:"naering", navn:"Næringskomiteen",              kontakt:"naeringskomiteen@stortinget.no",         leder:"Geir Pollestad (Sp)",  felt:["Spill","Film","Kultureksport"], url:"https://www.stortinget.no/no/Representanter-og-komiteer/Komiteene/Naeringskomiteen/"},
  {id:"utd",     navn:"Utdannings- og forskningskomiteen", kontakt:"utdanning@stortinget.no",          leder:"Iselin Nybø (V)",      felt:["Museer","Kulturarv","Arkiver"], url:"https://www.stortinget.no/no/Representanter-og-komiteer/Komiteene/Utdannings-og-forskningskomiteen/"},
];

function BrukerMobiliser({loggAktivitet=()=>{},user=null}) {
  const [tab,setTab]=useState("oversikt");
  const [sokPol,setSokPol]=useState("");
  const [malModal,setMalModal]=useState(null); // {type, kontekst}
  const [valgtSakForHoring,setValgtSakForHoring]=useState(null);
  const filtPol=POLITIKERE.filter(p=>`${p.navn} ${p.parti} ${p.rolle}`.toLowerCase().includes(sokPol.toLowerCase()));

  const ovCards=[
    {ikon:"🏛️",tittel:"Kontakt stortingskomité",tekst:"Familie- og kulturkomiteen behandler de fleste kultursaker. Send en strukturert henvendelse direkte til riktig komité.",farge:"#EEF2FF",kant:"#C7D2FE",tekst2:C.komBlue,type:"komite",tag:"4 maler"},
    {ikon:"👤",tittel:"Skriv til en politiker",tekst:"Direkte henvendelse til en lokalpolitiker, stortingsrepresentant eller kulturminister med forhåndsutfylt mal.",farge:C.bgAlt,kant:C.border,tekst2:C.text,type:"politiker_oversikt",tag:"4 maler"},
    {ikon:"📝",tittel:"Send høringssvar",tekst:"Formelt innspill til åpne høringer. Velg sak og mal – vi gjør det enkelt å si fra til riktig instans.",farge:"#F0FDF4",kant:"#86EFAC",tekst2:C.green,type:"horing_oversikt",tag:"4 maler"},
    {ikon:"📰",tittel:"Skriv pressemelding",tekst:"Nå media med en profesjonell pressemelding. Maler for protest, seier og generelle kulturpolitiske saker.",farge:"#FFF7ED",kant:"#FED7AA",tekst2:"#C2410C",type:"pressem",tag:"2 maler"},
    {ikon:"📱",tittel:"Del på sosiale medier",tekst:"Ferdige tekster for Facebook, Instagram og X/Twitter. Tilpass med én klokke og del videre.",farge:"#EDE9FE",kant:"#DDD6FE",tekst2:C.purple,type:"sosiale",tag:"3 maler"},
    {ikon:"✊",tittel:"Signer kampanjer",tekst:"Støtt aktive underskriftskampanjer og spre dem i nettverket ditt.",farge:"#FEF2F2",kant:"#FECACA",tekst2:C.red,type:"kampanje",tag:`${KAMPANJER.length} aktive`},
  ];

  return (
    <div>
      {malModal&&<MalModal type={malModal.type} kontekst={malModal.kontekst} user={user} onClose={()=>setMalModal(null)} onSend={(entry)=>loggAktivitet(entry)}/>}

      {/* Sub-nav */}
      <div style={{display:"flex",gap:0,marginBottom:24,borderBottom:`1px solid ${C.border}`}}>
        {[["oversikt","🗺 Oversikt"],["komiteer","🏛 Komiteer"],["politikere","👤 Politikere"],["horinger","📋 Høringer"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)}
            style={{padding:"9px 16px",border:"none",borderBottom:`2.5px solid ${tab===id?C.red:"transparent"}`,background:"none",fontSize:13,color:tab===id?C.red:C.muted,fontWeight:tab===id?700:500,marginBottom:-1,fontFamily:"inherit",whiteSpace:"nowrap"}}>
            {lbl}
          </button>
        ))}
      </div>

      {/* OVERSIKT */}
      {tab==="oversikt"&&(
        <div>
          {/* Hastesakene akkurat nå */}
          {VARSLER.filter(v=>v.status==="kritisk").length>0&&(
            <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:14,padding:"16px 20px",marginBottom:24}}>
              <div style={{fontWeight:800,fontSize:14,color:"#991B1B",marginBottom:12}}>⚠️ Hastesakene akkurat nå – disse trenger handling snarest</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {VARSLER.filter(v=>v.status==="kritisk").map(v=>(
                  <div key={v.id} style={{background:"#fff",borderRadius:10,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:13,color:C.text}}>{v.tittel}</div>
                      <div style={{fontSize:11,color:C.muted,marginTop:2}}>{v.instans} · {v.dager}d igjen</div>
                    </div>
                    <div style={{display:"flex",gap:6,flexShrink:0}}>
                      <button onClick={()=>setMalModal({type:"horing",kontekst:v})}
                        style={{padding:"6px 12px",background:C.red,color:"#fff",border:"none",borderRadius:7,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                        📝 Send høringssvar
                      </button>
                      <button onClick={()=>setMalModal({type:"politiker",kontekst:{...POLITIKERE[0],sakTittel:v.tittel}})}
                        style={{padding:"6px 12px",background:"#fff",color:C.red,border:`1.5px solid ${C.red}`,borderRadius:7,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                        📬 Kontakt politiker
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p style={{fontSize:14,color:C.muted,marginBottom:20,lineHeight:1.6}}>
            Velg mobiliseringsform nedenfor. Alle kortene inneholder ferdige maler du kan tilpasse og sende direkte.
          </p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
            {ovCards.map((c,i)=>(
              <div key={i}
                onClick={()=>{
                  if(c.type==="komite") setMalModal({type:"komite",kontekst:KOMITEER_DATA[0]});
                  else if(c.type==="politiker_oversikt") setTab("politikere");
                  else if(c.type==="horing_oversikt") setTab("horinger");
                  else if(c.type==="pressem") setMalModal({type:"pressem",kontekst:null});
                  else if(c.type==="sosiale") setMalModal({type:"sosiale",kontekst:VARSLER[0]});
                  else if(c.type==="kampanje") setTab("oversikt");
                }}
                style={{background:c.farge,border:`1.5px solid ${c.kant}`,borderRadius:14,padding:"18px 20px",cursor:"pointer",transition:"box-shadow .15s,transform .15s"}}
                onMouseEnter={e=>{e.currentTarget.style.boxShadow="0 6px 24px rgba(0,0,0,.1)";e.currentTarget.style.transform="translateY(-2px)";}}
                onMouseLeave={e=>{e.currentTarget.style.boxShadow="none";e.currentTarget.style.transform="translateY(0)";}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                  <span style={{fontSize:28}}>{c.ikon}</span>
                  <span style={{fontSize:10,fontWeight:700,background:c.tekst2+"18",color:c.tekst2,padding:"3px 8px",borderRadius:99}}>{c.tag}</span>
                </div>
                <h3 style={{fontSize:14,fontWeight:700,color:c.tekst2,marginBottom:6}}>{c.tittel}</h3>
                <p style={{fontSize:12,color:C.muted,lineHeight:1.55,marginBottom:12}}>{c.tekst}</p>
                <div style={{fontSize:12,color:c.tekst2,fontWeight:700}}>Klikk for maler →</div>
              </div>
            ))}
          </div>

          {/* Kampanjer inline */}
          <div style={{marginTop:28}}>
            <h3 style={{fontSize:15,fontWeight:800,fontFamily:"'Playfair Display',serif",color:C.redDark,marginBottom:14}}>✊ Aktive underskriftskampanjer</h3>
            <div style={{display:"flex",gap:14,overflowX:"auto",paddingBottom:8}}>
              {KAMPANJER.map(k=><KampanjeKort key={k.id} k={k} compact/>)}
            </div>
          </div>
        </div>
      )}

      {/* KOMITEER */}
      {tab==="komiteer"&&(
        <div>
          <div style={{background:"#EEF2FF",border:"1px solid #C7D2FE",borderRadius:12,padding:"12px 16px",marginBottom:20,fontSize:13,color:C.komBlue}}>
            💡 <strong>Tips:</strong> Klikk på en komité for å åpne ferdig brevmal. Åpne saker fra Varsler-fanen vil automatisk koble til riktig komité.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {KOMITEER_DATA.map(k=>(
              <Card key={k.id} style={{borderLeft:`4px solid ${C.komBlue}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                  <div>
                    <h3 style={{fontSize:15,fontWeight:800,marginBottom:4}}>{k.navn}</h3>
                    <div style={{fontSize:12,color:C.muted}}>Leder: {k.leder}</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:1}}>{k.kontakt}</div>
                  </div>
                  <a href={k.url} target="_blank" rel="noreferrer"
                    style={{padding:"6px 12px",background:"#1E3A8A",color:"#fff",borderRadius:7,fontSize:11,fontWeight:700}}>
                    Stortinget ↗
                  </a>
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
                  {k.felt.map(f=><Badge key={f} color={C.muted} style={{fontSize:10}}>{f}</Badge>)}
                </div>
                <Btn variant="kom" size="sm" onClick={()=>setMalModal({type:"komite",kontekst:k})}>
                  📬 Åpne brevmaler for denne komiteen
                </Btn>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* POLITIKERE */}
      {tab==="politikere"&&(
        <div>
          <div style={{background:C.bgAlt,borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:C.muted}}>
            Velg en politiker og klikk <strong>Åpne brevmaler</strong> for å se alle malalternativer og tilpasse meldingen din.
          </div>
          <input placeholder="Søk på navn, parti, sted..." value={sokPol} onChange={e=>setSokPol(e.target.value)}
            style={{width:"100%",padding:"10px 14px",borderRadius:9,border:`1.5px solid ${C.border}`,fontSize:14,marginBottom:16,boxSizing:"border-box",background:C.bgCard,fontFamily:"inherit"}}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {filtPol.map(p=>(
              <Card key={p.id} style={{display:"flex",flexDirection:"column",gap:0}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:14}}>{p.navn}</div>
                    <div style={{fontSize:12,color:C.muted}}>{p.rolle} · {p.sted}</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:1}}>{p.kontakt}</div>
                  </div>
                  <span style={{background:PARTIFARGE[p.parti]||C.red,color:"#fff",padding:"3px 10px",borderRadius:99,fontSize:12,fontWeight:700}}>{p.parti}</span>
                </div>
                <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
                  {p.kategori.map(k=>{const ki=KATEGORIER.find(c=>c.id===k);return ki?<Badge key={k} color={C.muted} style={{fontSize:10}}>{ki.ikon} {ki.label}</Badge>:null;})}
                </div>
                <Btn variant="ghost" size="sm" style={{width:"100%"}} onClick={()=>setMalModal({type:"politiker",kontekst:p})}>
                  📬 Åpne brevmaler (4 varianter)
                </Btn>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* HØRINGER */}
      {tab==="horinger"&&(
        <div>
          <div style={{background:C.bgAlt,borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:C.muted}}>
            Velg en sak og klikk <strong>Skriv høringssvar</strong> for å velge blant fire forskjellige høringssvar-maler.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {VARSLER.map(v=>{
              const ki=KATEGORIER.find(k=>k.id===v.kategori);
              return (
                <Card key={v.id} style={{borderLeft:`4px solid ${v.status==="kritisk"?"#DC2626":v.status==="viktig"?"#D97706":"#16A34A"}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:12}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",gap:5,marginBottom:6,flexWrap:"wrap"}}>
                        {ki&&<Badge color={C.muted}>{ki.ikon} {ki.label}</Badge>}
                        <NivåBadge nivå={v.nivå} sted={v.sted}/>
                      </div>
                      <div style={{fontSize:14,fontWeight:700,marginBottom:3}}>{v.tittel}</div>
                      <div style={{fontSize:12,color:C.muted,lineHeight:1.4}}>{v.sammendrag}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <Badge color={v.status==="kritisk"?C.red:v.status==="viktig"?C.amber:C.green} bg={v.status==="kritisk"?"#FEE2E2":v.status==="viktig"?"#FEF3C7":"#F0FDF4"}>{v.dager}d igjen</Badge>
                      <div style={{fontSize:10,color:C.muted,marginTop:3}}>{v.instans}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <a href={v.kilde} target="_blank" rel="noreferrer"
                      style={{padding:"7px 14px",background:C.bgAlt,color:C.text,border:`1px solid ${C.border}`,borderRadius:7,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                      Les saken ↗
                    </a>
                    <Btn variant="primary" size="sm" onClick={()=>setMalModal({type:"horing",kontekst:v})}>
                      📝 Skriv høringssvar (4 maler)
                    </Btn>
                    <Btn variant="secondary" size="sm" onClick={()=>setMalModal({type:"sosiale",kontekst:v})}>
                      📱 Del saken
                    </Btn>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PREMIUM VERKTØY ──────────────────────────────────────────────────────
function PremiumVerktøy() {
  const [tool,setTool]=useState("budsjett");
  const [budsjettTekst,setBudsjettTekst]=useState("");
  const [analyse,setAnalyse]=useState("");
  const [loading,setLoading]=useState(false);

  function analysér() {
    if(!budsjettTekst.trim()) return;
    setLoading(true);
    setTimeout(()=>{ setAnalyse(BUDSJETT_ANALYSE_MOCK); setLoading(false); },1800);
  }

  const tools=[
    {id:"budsjett",label:"📊 Budsjettanalyse",beskrivelse:"Lim inn eller skriv inn budsjettekst – få en KI-analyse av hva det betyr for kulturfeltet."},
    {id:"trend",label:"📈 Trendrapport",beskrivelse:"Se hvilke fagfelt og geografier som har flest aktive saker, og hvordan det utvikler seg."},
    {id:"politikeraktivitet",label:"🎤 Politikeraktivitet",beskrivelse:"Hvem er mest aktive i kulturspørsmål? Oversikt over spørsmål, svar og initiativ."},
  ];

  return (
    <div>
      <div style={{background:"linear-gradient(135deg,#4C1D95,#6D28D9)",borderRadius:16,padding:"20px 24px",marginBottom:24,color:"#fff",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontWeight:800,fontSize:18,fontFamily:"'Playfair Display',serif",marginBottom:4}}>⭐ Premium-verktøy</div>
          <div style={{fontSize:13,opacity:.8}}>Eksklusiv innsikt for deg som vil forstå mer enn bare overflaten.</div>
        </div>
        <Badge color="#fff" bg="rgba(255,255,255,.15)" style={{fontSize:13,padding:"6px 14px"}}>Aktivt abonnement</Badge>
      </div>

      <div style={{display:"flex",gap:10,marginBottom:24,flexWrap:"wrap"}}>
        {tools.map(t=>(
          <button key={t.id} onClick={()=>{setTool(t.id);setAnalyse("");}}
            style={{padding:"9px 16px",borderRadius:10,border:`1.5px solid ${tool===t.id?C.purple:C.border}`,background:tool===t.id?"#EDE9FE":C.bgCard,color:tool===t.id?C.purple:C.muted,fontSize:13,cursor:"pointer",fontWeight:tool===t.id?700:500,fontFamily:"inherit"}}>
            {t.label}
          </button>
        ))}
      </div>

      {tool==="budsjett"&&(
        <div>
          <Card style={{marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:12}}>📊 Budsjettanalyse</div>
            <p style={{fontSize:13,color:C.muted,marginBottom:14,lineHeight:1.55}}>Lim inn tekst fra et kulturbudsjett, budsjettforslag eller bevilgningsdokument. KI-en analyserer hva tallene faktisk betyr for kulturfeltet.</p>
            <textarea placeholder="Lim inn budsjettekst her... (f.eks. fra kommunebudsjett, statsbudsjettet, tilskuddsdokumenter)" value={budsjettTekst} onChange={e=>setBudsjettTekst(e.target.value)} rows={8}
              style={{width:"100%",padding:12,borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:13,lineHeight:1.55,resize:"vertical",boxSizing:"border-box",fontFamily:"inherit",marginBottom:12,color:C.text}}/>
            <div style={{display:"flex",gap:8}}>
              <Btn variant="premium" style={{flex:1}} onClick={analysér} disabled={loading||!budsjettTekst.trim()}>
                {loading?"Analyserer...":"🔍 Analyser budsjett"}
              </Btn>
              <Btn variant="secondary" size="sm" onClick={()=>{setBudsjettTekst("Oslo kommunes budsjettforslag 2026:\nKultur og idrett: 2 340 mill kr (+2,1%)\nFrie kulturmidler: 48 mill kr (-8%)\nScenekunst: 124 mill kr (uendret)\nMusikarrangement: 22 mill kr (-4 mill)\nStipendordninger: 8 mill kr (uendret)\nKulturbygg: 120 mill kr (+12%)"); }}>
                Prøv eksempel
              </Btn>
            </div>
          </Card>
          {loading&&(
            <Card style={{background:C.bgAlt,textAlign:"center",padding:"32px"}}>
              <div style={{fontSize:24,marginBottom:8}}>⏳</div>
              <div style={{fontSize:14,color:C.muted}}>Analyserer budsjettet...</div>
            </Card>
          )}
          {analyse&&!loading&&(
            <Card style={{borderLeft:`4px solid ${C.purple}`}}>
              <div style={{fontSize:13,fontWeight:700,color:C.purple,marginBottom:14,display:"flex",alignItems:"center",gap:6}}>
                ⭐ KI-analyse
                <Badge color={C.purple}>Kun Premium</Badge>
              </div>
              <div style={{fontSize:14,lineHeight:1.8,color:C.text,whiteSpace:"pre-line"}}>{analyse}</div>
              <div style={{display:"flex",gap:8,marginTop:16}}>
                <Btn variant="secondary" size="sm" onClick={()=>navigator.clipboard?.writeText(analyse)}>Kopier analyse</Btn>
                <Btn variant="secondary" size="sm">Last ned PDF</Btn>
              </div>
            </Card>
          )}
        </div>
      )}

      {tool==="trend"&&(
        <Card>
          <div style={{fontSize:13,fontWeight:700,marginBottom:16}}>📈 Aktive saker per fagfelt</div>
          {KATEGORIER.map(k=>{
            const n=VARSLER.filter(v=>v.kategori===k.id).length;
            if(!n) return null;
            return (
              <div key={k.id} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                <div style={{width:120,fontSize:13,color:C.text,flexShrink:0}}>{k.ikon} {k.label}</div>
                <div style={{flex:1,background:C.bgAlt,borderRadius:99,height:8,overflow:"hidden"}}>
                  <div style={{background:C.red,width:`${Math.round(n/VARSLER.length*100)*3}%`,maxWidth:"100%",height:"100%",borderRadius:99}}/>
                </div>
                <div style={{fontSize:12,fontWeight:700,color:C.text,width:30,textAlign:"right"}}>{n}</div>
              </div>
            );
          })}
          <div style={{marginTop:20,padding:"14px",background:"#EDE9FE",borderRadius:10,fontSize:13,color:C.purple}}>
            <strong>Trendvarsel:</strong> Scenekunst og musikk har flest saker med kritisk status denne måneden. Viken og Oslo er mest aktive geografier.
          </div>
        </Card>
      )}

      {tool==="politikeraktivitet"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {POLITIKERE.map((p,i)=>(
            <Card key={p.id}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <span style={{fontWeight:700,fontSize:15}}>{p.navn}</span>
                    <span style={{background:PARTIFARGE[p.parti]||C.red,color:"#fff",padding:"2px 8px",borderRadius:99,fontSize:11,fontWeight:700}}>{p.parti}</span>
                  </div>
                  <div style={{fontSize:12,color:C.muted,marginBottom:8}}>{p.rolle} · {p.sted}</div>
                  <div style={{display:"flex",gap:10,fontSize:12}}>
                    <span style={{color:C.green}}>✓ {3-i} spørsmål stilt</span>
                    <span style={{color:C.blue}}>📋 {2+i} saker behandlet</span>
                    <span style={{color:C.purple}}>🎤 {i+1} innlegg denne måneden</span>
                  </div>
                </div>
                <div style={{textAlign:"right",fontSize:12,color:C.muted}}>
                  <div style={{fontWeight:700,fontSize:18,color:C.text,fontFamily:"'Playfair Display',serif"}}>{95-i*12}%</div>
                  <div>aktivitetsscore</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── VARSEL-REGISTRERING MODAL ────────────────────────────────────────────
function VarselRegistreringModal({user,setUser,onClose}) {
  const [epost,setEpost]=useState(user?.epost||"");
  const [valgtKat,setValgtKat]=useState([]);
  const [valgtNivå,setValgtNivå]=useState(["nasjonalt","fylke","kommune"]);
  const [frekvens,setFrekvens]=useState("straks");
  const [lagret,setLagret]=useState(false);

  function lagre() {
    setUser(u=>({...u,varselEpost:epost,varselKat:valgtKat,varselNivå:valgtNivå,varselFrekvens:frekvens}));
    setLagret(true);
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div style={{background:C.bgCard,borderRadius:20,width:"100%",maxWidth:500,boxShadow:"0 24px 64px rgba(0,0,0,.3)",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
        {lagret?(
          <div style={{padding:"48px 32px",textAlign:"center"}}>
            <div style={{fontSize:48,marginBottom:14}}>🔔</div>
            <h2 style={{fontSize:20,fontWeight:800,fontFamily:"'Playfair Display',serif",color:C.redDark,marginBottom:8}}>Varsler aktivert!</h2>
            <p style={{fontSize:13,color:C.muted,marginBottom:6,lineHeight:1.6}}>Du vil motta varsler på <strong>{epost}</strong>.</p>
            <p style={{fontSize:12,color:C.muted,marginBottom:24}}>Du kan endre innstillingene når som helst under «Min side».</p>
            <Btn variant="primary" onClick={onClose}>Lukk</Btn>
          </div>
        ):(
          <>
            <div style={{background:C.red,padding:"22px 24px",color:"#fff"}}>
              <h2 style={{fontSize:18,fontWeight:800,fontFamily:"'Playfair Display',serif",marginBottom:4}}>🔔 Sett opp e-postvarsler</h2>
              <p style={{fontSize:13,opacity:.85}}>Få varsel direkte i innboksen når det dukker opp relevante saker – gratis for alle.</p>
            </div>
            <div style={{padding:"22px 24px"}}>
              <Input label="E-postadresse for varsler" placeholder="deg@eksempel.no" value={epost} onChange={e=>setEpost(e.target.value)} type="email"/>

              <div style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:8,textTransform:"uppercase",letterSpacing:".04em"}}>Fagfelt (la stå tomt = alle)</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {KATEGORIER.map(k=>(
                    <button key={k.id} onClick={()=>setValgtKat(p=>p.includes(k.id)?p.filter(x=>x!==k.id):[...p,k.id])}
                      style={{padding:"5px 10px",borderRadius:99,border:`1.5px solid ${valgtKat.includes(k.id)?C.red:C.border}`,background:valgtKat.includes(k.id)?C.red:"none",color:valgtKat.includes(k.id)?"#fff":C.text,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>
                      {k.ikon} {k.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:8,textTransform:"uppercase",letterSpacing:".04em"}}>Nivå</div>
                <div style={{display:"flex",gap:8}}>
                  {[["nasjonalt","🏛 Nasjonalt"],["fylke","🗺 Fylke"],["kommune","📍 Kommune"]].map(([id,lbl])=>(
                    <button key={id} onClick={()=>setValgtNivå(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])}
                      style={{padding:"7px 14px",borderRadius:8,border:`1.5px solid ${valgtNivå.includes(id)?C.red:C.border}`,background:valgtNivå.includes(id)?C.red:"none",color:valgtNivå.includes(id)?"#fff":C.text,fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:valgtNivå.includes(id)?700:400}}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{marginBottom:20}}>
                <div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:8,textTransform:"uppercase",letterSpacing:".04em"}}>Frekvens</div>
                <div style={{display:"flex",gap:8}}>
                  {[["straks","Straks (kritiske)"],["daglig","Daglig oppsummering"],["ukentlig","Ukentlig digest"]].map(([id,lbl])=>(
                    <button key={id} onClick={()=>setFrekvens(id)}
                      style={{padding:"7px 14px",borderRadius:8,border:`1.5px solid ${frekvens===id?C.red:C.border}`,background:frekvens===id?C.red:"none",color:frekvens===id?"#fff":C.text,fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:frekvens===id?700:400}}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{display:"flex",gap:10}}>
                <Btn variant="primary" size="lg" style={{flex:1}} onClick={lagre} disabled={!epost}>Aktiver varsler</Btn>
                <Btn variant="secondary" onClick={onClose}>Senere</Btn>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── SAKSHISTORIKK ────────────────────────────────────────────────────────
function SaksHistorikkSide({aktivitet=[]}) {
  const [valgt,setValgt]=useState(null);
  const utfallCfg={
    seier:{label:"Seier ✓",bg:"#D1FAE5",color:C.green,ikon:"🏆"},
    tap:{label:"Vedtatt mot vår vilje",bg:"#FEE2E2",color:C.red,ikon:"❌"},
    pågår:{label:"Pågår / uavklart",bg:"#FEF3C7",color:C.amber,ikon:"⏳"},
  };
  return (
    <div>
      <p style={{fontSize:14,color:C.muted,marginBottom:16,lineHeight:1.6}}>
        Her samles saker som er avsluttet – med utfall, tidslinje og hva som skjedde. Lær av hva som virker.
      </p>
      {aktivitet.length>0&&(
        <div style={{background:"#F0FDF4",border:"1px solid #86EFAC",borderRadius:12,padding:"12px 16px",marginBottom:20,fontSize:13,color:C.green}}>
          ✓ <strong>Du bidro i {aktivitet.filter(a=>a.type==="horing"||a.type==="politiker").length} saker</strong> – saker der du sendte høringssvar eller kontaktet politiker er markert nedenfor.
        </div>
      )}

      {/* Oppsummeringsstatistikk */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:28}}>
        {[
          {n:SAK_HISTORIKK.filter(s=>s.utfall==="seier").length,label:"Seire",bg:"#D1FAE5",color:C.green,ikon:"🏆"},
          {n:SAK_HISTORIKK.filter(s=>s.utfall==="tap").length,label:"Tapte saker",bg:"#FEE2E2",color:C.red,ikon:"❌"},
          {n:SAK_HISTORIKK.filter(s=>s.utfall==="pågår").length,label:"Uavklarte",bg:"#FEF3C7",color:C.amber,ikon:"⏳"},
        ].map((s,i)=>(
          <div key={i} style={{background:s.bg,borderRadius:14,padding:"16px 20px",border:`1px solid ${C.border}`}}>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <div style={{fontSize:28,fontWeight:800,color:s.color,fontFamily:"'Playfair Display',serif"}}>{s.n}</div>
              <span style={{fontSize:20}}>{s.ikon}</span>
            </div>
            <div style={{fontSize:12,color:C.muted,marginTop:4}}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        {SAK_HISTORIKK.map(sak=>{
          const cfg=utfallCfg[sak.utfall];
          const ki=KATEGORIER.find(k=>k.id===sak.kategori);
          const åpen=valgt===sak.id;
          return (
            <div key={sak.id} style={{background:C.bgCard,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
              <div style={{padding:"16px 20px",cursor:"pointer"}} onClick={()=>setValgt(åpen?null:sak.id)}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",gap:6,marginBottom:7,flexWrap:"wrap"}}>
                      <span style={{background:cfg.bg,color:cfg.color,padding:"3px 10px",borderRadius:99,fontSize:11,fontWeight:700}}>{cfg.ikon} {cfg.label}</span>
                      {ki&&<Badge color={C.muted}>{ki.ikon} {ki.label}</Badge>}
                      <NivåBadge nivå={sak.nivå} sted={sak.sted}/>
                    </div>
                    <h3 style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:4}}>{sak.tittel}</h3>
                    <p style={{fontSize:13,color:C.muted,lineHeight:1.5}}>{sak.sammendrag}</p>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:11,color:C.muted}}>Avsluttet</div>
                    <div style={{fontSize:12,fontWeight:700}}>{new Date(sak.avsluttet).toLocaleDateString("no-NO",{day:"numeric",month:"short",year:"numeric"})}</div>
                    <div style={{fontSize:16,marginTop:4,color:C.muted}}>{åpen?"▲":"▼"}</div>
                  </div>
                </div>
              </div>

              {åpen&&(
                <div style={{borderTop:`1px solid ${C.border}`,padding:"16px 20px",background:C.bgAlt}}>
                  {/* Utfallsboks */}
                  <div style={{background:cfg.bg,border:`1px solid ${cfg.color}30`,borderRadius:10,padding:"12px 16px",marginBottom:16}}>
                    <div style={{fontSize:12,fontWeight:700,color:cfg.color,marginBottom:4}}>Utfall</div>
                    <p style={{fontSize:13,color:C.text,lineHeight:1.6}}>{sak.utfallTekst}</p>
                  </div>
                  {/* Tidslinje */}
                  <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".05em",marginBottom:12}}>Tidslinje</div>
                  <div style={{position:"relative",paddingLeft:20}}>
                    <div style={{position:"absolute",left:6,top:6,bottom:6,width:2,background:C.border,borderRadius:99}}/>
                    {sak.hendelser.map((h,i)=>(
                      <div key={i} style={{position:"relative",marginBottom:14}}>
                        <div style={{position:"absolute",left:-17,top:4,width:10,height:10,borderRadius:"50%",background:i===sak.hendelser.length-1?cfg.color:C.border,border:`2px solid ${i===sak.hendelser.length-1?cfg.color:C.border}`}}/>
                        <div style={{fontSize:11,color:C.muted,marginBottom:2}}>{new Date(h.dato).toLocaleDateString("no-NO",{day:"numeric",month:"short",year:"numeric"})}</div>
                        <div style={{fontSize:13,color:C.text,fontWeight:i===sak.hendelser.length-1?700:400}}>{h.tekst}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{marginTop:8,display:"flex",gap:8}}>
                    <Btn variant="secondary" size="sm">Del historien</Btn>
                    <Btn variant="secondary" size="sm">Last ned rapport</Btn>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MIN SIDE ─────────────────────────────────────────────────────────────
function MinAktivitetSide({user,setUser,aktivitet,setShowVarselReg,setShowPremium}) {
  const [tab,setTab]=useState("aktivitet");
  const [katFilter,setKatFilter]=useState([]);
  const [nivåFilter,setNivåFilter]=useState([]);
  const [frekvens,setFrekvens]=useState(user?.varselFrekvens||"straks");
  const [lagretInn,setLagretInn]=useState(false);

  const typeIkon={horing:"📝",kampanje:"✊",politiker:"👤",pressemelding:"📰"};
  const typeLabel={horing:"Høringssvar",kampanje:"Underskrift",politiker:"Politikerkontakt",pressemelding:"Pressemelding"};

  function lagreInnstillinger() {
    setUser(u=>({...u,varselKat:katFilter,varselNivå:nivåFilter,varselFrekvens:frekvens}));
    setLagretInn(true);
    setTimeout(()=>setLagretInn(false),2500);
  }

  return (
    <div style={{maxWidth:800}}>
      {/* Brukerprofil */}
      <div style={{background:C.bgCard,border:`1px solid ${C.border}`,borderRadius:16,padding:"20px 24px",marginBottom:24,display:"flex",gap:18,alignItems:"center"}}>
        <div style={{width:56,height:56,background:C.red,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:24,fontFamily:"'Playfair Display',serif",flexShrink:0}}>
          {user?.navn?.[0]||"?"}
        </div>
        <div style={{flex:1}}>
          <div style={{fontWeight:800,fontSize:18,fontFamily:"'Playfair Display',serif",color:C.redDark}}>{user?.navn||"Bruker"}</div>
          <div style={{fontSize:13,color:C.muted,marginTop:2}}>{user?.epost||"Ikke logget inn"}</div>
          <div style={{display:"flex",gap:8,marginTop:8}}>
            {user?.plan==="premium"
              ? <Badge color={C.purple} bg="#EDE9FE">⭐ Premium-abonnent</Badge>
              : <Badge color={C.muted} bg={C.bgAlt}>Gratis konto</Badge>
            }
            {user?.varselEpost
              ? <Badge color={C.green} bg="#D1FAE5">🔔 Varsler aktive</Badge>
              : <Badge color={C.amber} bg="#FEF3C7">🔕 Ingen varsler</Badge>
            }
          </div>
        </div>
        {user?.plan!=="premium"&&(
          <Btn variant="premium" size="sm" onClick={()=>setShowPremium(true)}>Oppgrader til Premium ⭐</Btn>
        )}
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:0,marginBottom:24,borderBottom:`1px solid ${C.border}`}}>
        {[["aktivitet","📋 Min aktivitet"],["varsler","🔔 Varselinnstillinger"],["stats","📊 Min statistikk"]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)}
            style={{padding:"9px 16px",border:"none",borderBottom:`2.5px solid ${tab===id?C.red:"transparent"}`,background:"none",fontSize:13,color:tab===id?C.red:C.muted,fontWeight:tab===id?700:500,marginBottom:-1,fontFamily:"inherit"}}>
            {lbl}
          </button>
        ))}
      </div>

      {/* AKTIVITET */}
      {tab==="aktivitet"&&(
        <div>
          {!user?.varselEpost&&(
            <div style={{background:"#FEF3C7",border:"1px solid #FCD34D",borderRadius:12,padding:"14px 18px",marginBottom:18,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
              <div>
                <div style={{fontWeight:700,fontSize:14,color:C.amber,marginBottom:3}}>🔕 Du har ikke satt opp e-postvarsler</div>
                <div style={{fontSize:13,color:C.muted}}>Du går glipp av kritiske saker. Det tar 30 sekunder å sette opp.</div>
              </div>
              <Btn variant="primary" size="sm" style={{background:C.amber,flexShrink:0}} onClick={()=>setShowVarselReg(true)}>Aktiver varsler</Btn>
            </div>
          )}

          {aktivitet.length===0?(
            <div style={{textAlign:"center",padding:"48px 0",color:C.muted}}>
              <div style={{fontSize:36,marginBottom:12}}>📭</div>
              <div style={{fontSize:14}}>Ingen aktivitet ennå. Mobiliser på en sak for å komme i gang!</div>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {aktivitet.map((a,i)=>(
                <Card key={a.id||i} style={{display:"flex",gap:14,alignItems:"flex-start",padding:"14px 18px"}}>
                  <div style={{width:36,height:36,borderRadius:10,background:a.type==="horing"?"#D1FAE5":a.type==="kampanje"?"#EDE9FE":a.type==="politiker"?"#DBEAFE":"#FEF3C7",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
                    {typeIkon[a.type]||"📌"}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:600,color:C.text,marginBottom:3}}>{a.tittel}</div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <Badge color={C.muted} style={{fontSize:10}}>{typeLabel[a.type]||a.type}</Badge>
                      {a.mottaker&&<span style={{fontSize:11,color:C.muted}}>{a.mottaker}</span>}
                    </div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:11,color:C.muted}}>{a.dato}</div>
                    <Badge color={a.status==="sendt"?C.green:C.amber} bg={a.status==="sendt"?"#D1FAE5":"#FEF3C7"} style={{fontSize:10,marginTop:4}}>
                      {a.status==="sendt"?"✓ Sendt":"Aktiv"}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VARSELINNSTILLINGER */}
      {tab==="varsler"&&(
        <div>
          {!user?.varselEpost&&(
            <div style={{background:C.bgAlt,border:`1px solid ${C.border}`,borderRadius:12,padding:"16px 20px",marginBottom:20,textAlign:"center"}}>
              <div style={{fontSize:13,color:C.muted,marginBottom:10}}>Du har ikke registrert e-postvarsler ennå.</div>
              <Btn variant="primary" onClick={()=>setShowVarselReg(true)}>🔔 Sett opp e-postvarsler</Btn>
            </div>
          )}
          {user?.varselEpost&&(
            <div style={{background:"#D1FAE5",border:"1px solid #6EE7B7",borderRadius:12,padding:"12px 16px",marginBottom:20,fontSize:13,color:C.green}}>
              ✓ Varsler sendes til <strong>{user.varselEpost}</strong>
            </div>
          )}

          <Card style={{marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:12}}>Fagfelt (tom = alle)</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {KATEGORIER.map(k=>(
                <button key={k.id} onClick={()=>setKatFilter(p=>p.includes(k.id)?p.filter(x=>x!==k.id):[...p,k.id])}
                  style={{padding:"5px 10px",borderRadius:99,border:`1.5px solid ${katFilter.includes(k.id)?C.red:C.border}`,background:katFilter.includes(k.id)?C.red:"none",color:katFilter.includes(k.id)?"#fff":C.text,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>
                  {k.ikon} {k.label}
                </button>
              ))}
            </div>
          </Card>

          <Card style={{marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:12}}>Geografisk nivå</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {[["nasjonalt","🏛 Nasjonalt"],["fylke","🗺 Fylke"],["kommune","📍 Kommune"]].map(([id,lbl])=>(
                <button key={id} onClick={()=>setNivåFilter(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])}
                  style={{padding:"8px 16px",borderRadius:8,border:`1.5px solid ${nivåFilter.includes(id)?C.red:C.border}`,background:nivåFilter.includes(id)?C.red:"none",color:nivåFilter.includes(id)?"#fff":C.text,fontSize:13,cursor:"pointer",fontFamily:"inherit",fontWeight:nivåFilter.includes(id)?700:400}}>
                  {lbl}
                </button>
              ))}
            </div>
          </Card>

          <Card style={{marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:12}}>Frekvens</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {[["straks","⚡ Straks ved kritiske frister","Kun varsler med under 7 dager igjen og status 'kritisk'"],["daglig","📅 Daglig oppsummering","Én e-post per dag med alle nye saker"],["ukentlig","📬 Ukentlig digest","Én e-post per uke – oversikt over siste 7 dager"]].map(([id,lbl,sub])=>(
                <div key={id} onClick={()=>setFrekvens(id)}
                  style={{display:"flex",gap:12,alignItems:"center",padding:"12px 14px",borderRadius:10,border:`1.5px solid ${frekvens===id?C.red:C.border}`,background:frekvens===id?"#FFF0EF":"none",cursor:"pointer"}}>
                  <div style={{width:18,height:18,borderRadius:"50%",border:`2px solid ${frekvens===id?C.red:C.border}`,background:frekvens===id?C.red:"none",flexShrink:0}}/>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:C.text}}>{lbl}</div>
                    <div style={{fontSize:11,color:C.muted}}>{sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <Btn variant="primary" style={{flex:1}} onClick={lagreInnstillinger}>Lagre innstillinger</Btn>
            {lagretInn&&<span style={{fontSize:13,color:C.green,fontWeight:700}}>✓ Lagret!</span>}
          </div>
        </div>
      )}

      {/* STATISTIKK */}
      {tab==="stats"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:24}}>
            {[
              {n:aktivitet.filter(a=>a.type==="horing").length,label:"Høringssvar sendt",bg:"#D1FAE5",color:C.green,ikon:"📝"},
              {n:aktivitet.filter(a=>a.type==="kampanje").length,label:"Kampanjer signert",bg:"#EDE9FE",color:C.purple,ikon:"✊"},
              {n:aktivitet.filter(a=>a.type==="politiker").length,label:"Politikere kontaktet",bg:"#DBEAFE",color:C.blue,ikon:"👤"},
            ].map((s,i)=>(
              <div key={i} style={{background:s.bg,borderRadius:14,padding:"16px 20px",border:`1px solid ${C.border}`}}>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <div style={{fontSize:28,fontWeight:800,color:s.color,fontFamily:"'Playfair Display',serif"}}>{s.n}</div>
                  <span style={{fontSize:20}}>{s.ikon}</span>
                </div>
                <div style={{fontSize:12,color:C.muted,marginTop:4}}>{s.label}</div>
              </div>
            ))}
          </div>
          <Card>
            <div style={{fontSize:13,fontWeight:700,marginBottom:14}}>Aktivitet per type</div>
            {[["horing","📝 Høringssvar","#D1FAE5",C.green],["kampanje","✊ Signaturer","#EDE9FE",C.purple],["politiker","👤 Politikerkontakt","#DBEAFE",C.blue]].map(([type,lbl,bg,color])=>{
              const n=aktivitet.filter(a=>a.type===type).length;
              const maks=Math.max(...["horing","kampanje","politiker"].map(t=>aktivitet.filter(a=>a.type===t).length),1);
              return (
                <div key={type} style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                  <div style={{width:130,fontSize:13}}>{lbl}</div>
                  <div style={{flex:1,background:C.bgAlt,borderRadius:99,height:8,overflow:"hidden"}}>
                    <div style={{background:color,width:`${n/maks*100}%`,height:"100%",borderRadius:99,transition:"width .4s"}}/>
                  </div>
                  <div style={{fontSize:13,fontWeight:700,color,width:24,textAlign:"right"}}>{n}</div>
                </div>
              );
            })}
            {aktivitet.length===0&&<div style={{textAlign:"center",fontSize:13,color:C.muted,padding:"20px 0"}}>Ingen aktivitet registrert ennå.</div>}
          </Card>
        </div>
      )}
    </div>
  );
}
function PremiumModal({onClose,onSuccess}) {
  const [step,setStep]=useState("valg"); // valg | betaling | suksess
  const [plan,setPlan]=useState("monthly");
  const [kortNr,setKortNr]=useState("");
  const [utløp,setUtløp]=useState("");
  const [cvc,setCvc]=useState("");
  const [navn,setNavn]=useState("");
  const [loading,setLoading]=useState(false);

  function betal() {
    setLoading(true);
    setTimeout(()=>{ setLoading(false); setStep("suksess"); },1600);
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div style={{background:C.bgCard,borderRadius:20,width:"100%",maxWidth:480,overflow:"hidden",boxShadow:"0 24px 64px rgba(0,0,0,.35)"}} onClick={e=>e.stopPropagation()}>

        {step==="valg"&&(
          <>
            <div style={{background:"linear-gradient(135deg,#4C1D95,#6D28D9)",padding:"28px 28px 24px",color:"#fff"}}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",opacity:.7,marginBottom:8}}>Kulturvarsling</div>
              <h2 style={{fontSize:22,fontWeight:800,fontFamily:"'Playfair Display',serif",marginBottom:6}}>⭐ Oppgrader til Premium</h2>
              <p style={{fontSize:13,opacity:.8,lineHeight:1.55}}>Få tilgang til eksklusive analyseverktøy – og støtt utviklingen av en mer åpen kulturpolitisk debatt.</p>
            </div>
            <div style={{padding:"24px 28px"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
                {[["monthly","99 kr/mnd","Månedlig"],["yearly","790 kr/år","Årlig – spar 20%"]].map(([id,pris,label])=>(
                  <button key={id} onClick={()=>setPlan(id)} style={{padding:"14px",borderRadius:12,border:`2px solid ${plan===id?C.purple:C.border}`,background:plan===id?"#F5F3FF":C.bgCard,cursor:"pointer",textAlign:"center",fontFamily:"inherit"}}>
                    <div style={{fontWeight:800,fontSize:18,color:plan===id?C.purple:C.text}}>{pris}</div>
                    <div style={{fontSize:12,color:C.muted,marginTop:2}}>{label}</div>
                  </button>
                ))}
              </div>
              <div style={{marginBottom:20}}>
                {["📊 Budsjettanalyse – KI tolker kulturbudsjetter","📈 Trendrapporter per fagfelt og geografi","🎤 Politikeraktivitet og engasjementsscore","🔔 Prioriterte varsler med 24t forsprang","📥 Eksport av høringssvar til PDF"].map((f,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7,fontSize:13,color:C.text}}>
                    <span style={{color:C.green,fontWeight:700}}>✓</span>{f}
                  </div>
                ))}
              </div>
              <Btn variant="premium" size="lg" style={{width:"100%"}} onClick={()=>setStep("betaling")}>Fortsett til betaling →</Btn>
              <div style={{textAlign:"center",marginTop:10,fontSize:11,color:C.muted}}>Ingen binding. Avslutt når som helst.</div>
            </div>
          </>
        )}

        {step==="betaling"&&(
          <>
            <div style={{padding:"20px 24px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <h3 style={{fontSize:16,fontWeight:700}}>Kortbetaling</h3>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <Badge color={C.purple}>{plan==="monthly"?"99 kr/mnd":"790 kr/år"}</Badge>
                <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,color:C.muted}}>✕</button>
              </div>
            </div>
            <div style={{padding:"20px 24px"}}>
              <Input label="Navn på kortet" placeholder="Frode Gjerløw" value={navn} onChange={e=>setNavn(e.target.value)}/>
              <Input label="Kortnummer" placeholder="4242 4242 4242 4242" value={kortNr} onChange={e=>setKortNr(e.target.value)}/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <Input label="Utløpsdato" placeholder="MM/ÅÅ" value={utløp} onChange={e=>setUtløp(e.target.value)}/>
                <Input label="CVC" placeholder="123" value={cvc} onChange={e=>setCvc(e.target.value)}/>
              </div>
              <div style={{background:"#F0FDF4",border:"1px solid #86EFAC",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:C.green,display:"flex",alignItems:"center",gap:6}}>
                🔒 Sikker betaling – vi lagrer ikke kortinformasjon
              </div>
              <Btn variant="premium" size="lg" style={{width:"100%"}} onClick={betal} disabled={loading}>
                {loading?"Behandler betaling...":"Betal og aktiver Premium →"}
              </Btn>
              <button onClick={()=>setStep("valg")} style={{display:"block",width:"100%",marginTop:10,background:"none",border:"none",fontSize:12,color:C.muted,cursor:"pointer"}}>← Tilbake</button>
            </div>
          </>
        )}

        {step==="suksess"&&(
          <div style={{padding:"48px 32px",textAlign:"center"}}>
            <div style={{fontSize:52,marginBottom:16}}>🎉</div>
            <h2 style={{fontSize:22,fontWeight:800,fontFamily:"'Playfair Display',serif",color:C.redDark,marginBottom:8}}>Premium aktivert!</h2>
            <p style={{fontSize:14,color:C.muted,marginBottom:24,lineHeight:1.6}}>Du har nå tilgang til alle premium-verktøy. Gå til Premium-fanen for å starte med budsjettanalyse og trendrapporter.</p>
            <Btn variant="primary" size="lg" onClick={onSuccess}>Gå til Premium-verktøy →</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── KOMMUNE LOGIN ────────────────────────────────────────────────────────
function KommuneLogin({setScreen,setKommune}) {
  const [epost,setEpost]=useState("");
  const [pw,setPw]=useState("");
  const [kom,setKom]=useState("Oslo");
  const kommuner=["Oslo","Bergen","Trondheim","Stavanger","Tromsø","Kristiansand","Drammen","Fredrikstad"];
  return (
    <div style={{minHeight:"100vh",background:C.komBg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif"}}>
      <style>{css}</style>
      <div style={{width:"100%",maxWidth:420,padding:24}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{width:44,height:44,background:C.komBlue,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}>
            <span style={{color:"#fff",fontWeight:900,fontSize:22}}>🏛</span>
          </div>
          <h1 style={{fontSize:22,fontWeight:800,fontFamily:"'Playfair Display',serif",color:C.komBlue}}>Kommuneportalen</h1>
          <p style={{fontSize:13,color:C.muted,marginTop:6}}>For kommuner og offentlige instanser</p>
        </div>
        <Card>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:".04em"}}>Kommune</div>
            <select value={kom} onChange={e=>setKom(e.target.value)}
              style={{width:"100%",padding:"10px 14px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:14,color:C.text,background:C.bgCard,fontFamily:"inherit"}}>
              {kommuner.map(k=><option key={k}>{k}</option>)}
            </select>
          </div>
          <Input label="Tjenstlig e-post" placeholder="saksbehandler@kommune.no" value={epost} onChange={e=>setEpost(e.target.value)} type="email"/>
          <Input label="Passord" placeholder="••••••••" value={pw} onChange={e=>setPw(e.target.value)} type="password"/>
          <Btn variant="kom" size="lg" style={{width:"100%",marginTop:4}} onClick={()=>{setKommune({navn:"Saksbehandler Hansen",kommune:kom,epost});setScreen("kommune-app");}}>
            Logg inn som {kom} kommune →
          </Btn>
          <div style={{textAlign:"center",marginTop:12,fontSize:12,color:C.muted}}>
            Ikke registrert? <a href="#" style={{color:C.komBlue,fontWeight:700}}>Be om tilgang</a>
          </div>
        </Card>
        <div style={{textAlign:"center",marginTop:14}}>
          <button onClick={()=>setScreen("landing")} style={{background:"none",border:"none",color:C.muted,fontSize:12,cursor:"pointer"}}>← Tilbake til forsiden</button>
        </div>
      </div>
    </div>
  );
}

// ─── KOMMUNE APP ──────────────────────────────────────────────────────────
function KommuneApp({kommune,setScreen}) {
  const [view,setView]=useState("oversikt");
  const [høringer,setHøringer]=useState(KOM_HØRINGER_INIT);
  const [visPubliser,setVisPubliser]=useState(false);

  const VIEWS=[
    {id:"oversikt",label:"Oversikt"},
    {id:"høringer",label:"Mine høringer"},
    {id:"svar",label:"Mottatte innspill"},
    {id:"statistikk",label:"Statistikk"},
  ];

  const totalVarslet=høringer.reduce((s,h)=>s+h.varslet,0);
  const totalSvar=høringer.reduce((s,h)=>s+h.svar,0);

  return (
    <div style={{minHeight:"100vh",background:C.komBg,fontFamily:"'DM Sans',sans-serif",color:C.text}}>
      <style>{css}</style>
      {visPubliser&&<PubliserModal onClose={()=>setVisPubliser(false)} onPubliser={h=>{setHøringer(p=>[{...h,id:p.length+1,publisert:new Date().toISOString().split("T")[0],status:"aktiv",svar:0,varslet:Math.floor(Math.random()*200)+50},...p]);setVisPubliser(false);setView("høringer");}}/>}

      <header style={{background:C.komBlue,position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 12px rgba(0,0,0,.15)"}}>
        <div style={{maxWidth:1100,margin:"0 auto",padding:"0 24px",display:"flex",alignItems:"center",height:58,gap:20}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0,cursor:"pointer"}} onClick={()=>setScreen("landing")}>
            <div style={{width:30,height:30,background:"rgba(255,255,255,.15)",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontSize:16}}>🏛</span>
            </div>
            <span style={{fontWeight:800,fontSize:15,fontFamily:"'Playfair Display',serif",color:"#fff"}}>Kulturvarsling – {kommune?.kommune}</span>
          </div>
          <nav style={{display:"flex",gap:2,flex:1}}>
            {VIEWS.map(v=>(
              <button key={v.id} onClick={()=>setView(v.id)}
                style={{padding:"6px 14px",borderRadius:7,border:"none",background:view===v.id?"rgba(255,255,255,.2)":"none",color:"#fff",fontSize:13,cursor:"pointer",fontWeight:view===v.id?700:400,opacity:view===v.id?1:.75,fontFamily:"inherit"}}>
                {v.label}
              </button>
            ))}
          </nav>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Btn style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.25)",color:"#fff",padding:"7px 14px",borderRadius:8,fontSize:13,fontWeight:600}} onClick={()=>setVisPubliser(true)}>
              + Publiser høring
            </Btn>
            <div style={{width:32,height:32,background:"rgba(255,255,255,.2)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:13}}>
              {kommune?.navn?.[0]||"S"}
            </div>
          </div>
        </div>
      </header>

      <main style={{maxWidth:1100,margin:"0 auto",padding:"28px 24px"}}>
        <div style={{marginBottom:20}}>
          <h1 style={{margin:"0 0 4px",fontSize:22,fontWeight:800,fontFamily:"'Playfair Display',serif",color:C.komBlue}}>
            {{oversikt:"Oversikt",høringer:"Mine høringer",svar:"Mottatte innspill",statistikk:"Statistikk og rapporter"}[view]}
          </h1>
          <div style={{height:3,width:40,background:C.komBlue,borderRadius:99}}/>
        </div>

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
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:28}}>
        {[
          {n:aktive,label:"Aktive høringer",bg:"#DBEAFE",color:C.komBlue,ikon:"📋"},
          {n:totalVarslet,label:"Aktører varslet",bg:"#EDE9FE",color:C.purple,ikon:"🔔"},
          {n:totalSvar,label:"Innspill mottatt",bg:"#D1FAE5",color:C.green,ikon:"📝"},
          {n:`${Math.round(totalSvar/Math.max(1,totalVarslet)*100)}%`,label:"Responsrate",bg:"#FEF3C7",color:C.amber,ikon:"📊"},
        ].map((s,i)=>(
          <div key={i} style={{background:s.bg,borderRadius:14,padding:"16px 20px",border:`1px solid ${C.komBorder}`}}>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <div style={{fontSize:26,fontWeight:800,color:s.color,fontFamily:"'Playfair Display',serif"}}>{s.n}</div>
              <span style={{fontSize:20}}>{s.ikon}</span>
            </div>
            <div style={{fontSize:12,color:C.muted,marginTop:4}}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{background:"linear-gradient(135deg,#EEF2FF,#E0E7FF)",border:"1px solid #C7D2FE",borderRadius:16,padding:"20px 24px",marginBottom:24,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontWeight:700,fontSize:15,color:C.komBlue,marginBottom:4}}>Publiser en ny høring</div>
          <div style={{fontSize:13,color:C.muted}}>Nå relevante kulturaktører direkte – Kulturvarsling distribuerer til riktig målgruppe automatisk.</div>
        </div>
        <Btn variant="kom" onClick={()=>setVisPubliser(true)}>+ Publiser høring</Btn>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        <div>
          <div style={{fontSize:14,fontWeight:700,marginBottom:12,color:C.text}}>Aktive høringer</div>
          {høringer.filter(h=>h.status==="aktiv").map(h=><HøringRad key={h.id} h={h}/>)}
        </div>
        <div>
          <div style={{fontSize:14,fontWeight:700,marginBottom:12,color:C.text}}>Siste innspill</div>
          {KOM_SVAR_MOCK.slice(0,3).map(s=>(
            <Card key={s.id} style={{marginBottom:10,padding:"12px 14px"}}>
              <div style={{fontWeight:600,fontSize:13}}>{s.org}</div>
              <div style={{fontSize:12,color:C.muted,marginTop:2,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{s.tekst}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:6,display:"flex",justifyContent:"space-between"}}>
                <span>{s.dato}</span>
                <Badge color={s.status==="ny"?C.red:C.muted} bg={s.status==="ny"?"#FEE2E2":C.bgAlt} style={{fontSize:10}}>{s.status==="ny"?"Ny":"Lest"}</Badge>
              </div>
            </Card>
          ))}
          <button onClick={()=>setView("svar")} style={{fontSize:13,color:C.komBlue,fontWeight:700,background:"none",border:"none",cursor:"pointer"}}>Se alle innspill →</button>
        </div>
      </div>
    </div>
  );
}

function HøringRad({h}) {
  const ki=KATEGORIER.find(k=>k.id===h.kategori);
  return (
    <Card style={{marginBottom:10,padding:"12px 16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div style={{flex:1}}>
          <div style={{fontWeight:600,fontSize:13,marginBottom:4}}>{h.tittel}</div>
          <div style={{display:"flex",gap:6}}>
            {ki&&<Badge color={C.muted} style={{fontSize:10}}>{ki.ikon} {ki.label}</Badge>}
            <Badge color={h.status==="aktiv"?C.green:C.muted} bg={h.status==="aktiv"?"#D1FAE5":C.bgAlt} style={{fontSize:10}}>{h.status==="aktiv"?"Aktiv":"Avsluttet"}</Badge>
          </div>
        </div>
        <div style={{textAlign:"right",fontSize:11,color:C.muted,flexShrink:0}}>
          <div>Frist {new Date(h.frist).toLocaleDateString("no-NO",{day:"numeric",month:"short"})}</div>
          <div style={{color:C.green,fontWeight:700,marginTop:2}}>{h.svar} svar</div>
        </div>
      </div>
    </Card>
  );
}

function KommuneHøringer({høringer,setVisPubliser}) {
  return (
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:16}}>
        <Btn variant="kom" onClick={()=>setVisPubliser(true)}>+ Publiser ny høring</Btn>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {høringer.map(h=>{
          const ki=KATEGORIER.find(k=>k.id===h.kategori);
          return (
            <Card key={h.id} style={{borderLeft:`4px solid ${h.status==="aktiv"?C.komBlue:C.border}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <h3 style={{fontSize:15,fontWeight:700,marginBottom:6}}>{h.tittel}</h3>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {ki&&<Badge color={C.muted}>{ki.ikon} {ki.label}</Badge>}
                    <Badge color={h.status==="aktiv"?C.green:C.muted} bg={h.status==="aktiv"?"#D1FAE5":C.bgAlt}>{h.status==="aktiv"?"Aktiv":"Avsluttet"}</Badge>
                  </div>
                </div>
                <div style={{textAlign:"right",fontSize:12,color:C.muted,flexShrink:0}}>
                  <div>Publisert {h.publisert}</div>
                  <div>Frist {h.frist}</div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginTop:14}}>
                {[["🔔",h.varslet,"Aktører varslet",C.purple],["📝",h.svar,"Innspill mottatt",C.green],["📊",`${Math.round(h.svar/Math.max(1,h.varslet)*100)}%`,"Responsrate",C.amber]].map(([ik,n,lbl,c])=>(
                  <div key={lbl} style={{background:C.bgAlt,borderRadius:9,padding:"10px 12px",textAlign:"center"}}>
                    <div style={{fontSize:18}}>{ik}</div>
                    <div style={{fontWeight:800,fontSize:16,color:c}}>{n}</div>
                    <div style={{fontSize:11,color:C.muted}}>{lbl}</div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function KommuneSvar() {
  const [valgtHøring,setValgtHøring]=useState("alle");
  const [svar,setSvar]=useState(KOM_SVAR_MOCK.map(s=>({...s})));
  const [svarTekst,setSvarTekst]=useState({});
  const [åpenSvar,setÅpenSvar]=useState(null);
  const [sendt,setSendt]=useState({});
  const TAGGER=["Støtte","Motstand","Nøytral","Detaljert","Kort","Forslag"];
  const [tags,setTags]=useState({});

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

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:".04em"}}>Filtrer:</span>
          {[["alle","Alle"],...KOM_HØRINGER_INIT.map(h=>[String(h.id),h.tittel.slice(0,22)+"..."])].map(([id,lbl])=>(
            <button key={id} onClick={()=>setValgtHøring(id)}
              style={{padding:"5px 12px",borderRadius:99,border:"1.5px solid "+(valgtHøring===id?C.komBlue:C.border),background:valgtHøring===id?C.komBlue:"none",color:valgtHøring===id?"#fff":C.muted,fontSize:12,cursor:"pointer",fontWeight:valgtHøring===id?700:400,fontFamily:"inherit"}}>
              {lbl}
            </button>
          ))}
        </div>
        <button onClick={eksporter} style={{padding:"6px 14px",background:C.komBg,border:"1px solid "+C.komBorder,borderRadius:7,color:C.komBlue,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
          ⬇ Eksporter CSV
        </button>
      </div>
      <div style={{fontSize:12,color:C.muted,marginBottom:12}}>{filtered.length} innspill · {filtered.filter(s=>s.status==="ny").length} uleste</div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {filtered.map(s=>(
          <Card key={s.id} style={{borderLeft:"4px solid "+(s.status==="ny"?C.red:C.border)}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div>
                <div style={{fontWeight:700,fontSize:14}}>{s.org}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>Høring #{s.høringId} · {s.dato}</div>
              </div>
              <Badge color={s.status==="ny"?C.red:C.muted} bg={s.status==="ny"?"#FEE2E2":C.bgAlt}>
                {s.status==="ny"?"🔴 Ny":"✓ Lest"}
              </Badge>
            </div>
            <p style={{fontSize:13,color:C.text,lineHeight:1.6,margin:"0 0 10px"}}>{s.tekst}</p>
            {/* Tagging */}
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
              {TAGGER.map(t=>(
                <button key={t} onClick={()=>toggleTag(s.id,t)}
                  style={{padding:"3px 9px",borderRadius:99,border:"1.5px solid "+(tags[s.id]?.includes(t)?C.komBlue:C.border),background:tags[s.id]?.includes(t)?C.komBlue:"none",color:tags[s.id]?.includes(t)?"#fff":C.muted,fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:tags[s.id]?.includes(t)?700:400}}>
                  {t}
                </button>
              ))}
            </div>
            {åpenSvar===s.id?(
              <div>
                <textarea value={svarTekst[s.id]||""} onChange={e=>setSvarTekst(p=>({...p,[s.id]:e.target.value}))} rows={3} placeholder={"Svar til "+s.org+"..."}
                  style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid "+C.border,fontSize:12,lineHeight:1.6,resize:"vertical",boxSizing:"border-box",fontFamily:"inherit",marginBottom:8}}/>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>sendSvar(s.id)} style={{padding:"8px 16px",background:C.komBlue,color:"#fff",border:"none",borderRadius:7,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Send svar</button>
                  <button onClick={()=>setÅpenSvar(null)} style={{padding:"8px 12px",background:"none",border:"1px solid "+C.border,borderRadius:7,fontSize:12,cursor:"pointer",color:C.muted,fontFamily:"inherit"}}>Avbryt</button>
                </div>
              </div>
            ):sendt[s.id]?(
              <div style={{fontSize:12,color:C.green,fontWeight:700}}>✓ Svar sendt til {s.org}</div>
            ):(
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>setÅpenSvar(s.id)} style={{padding:"7px 14px",background:C.komBg,border:"1px solid "+C.komBorder,borderRadius:7,color:C.komBlue,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Svar på innspill</button>
                {s.status==="ny"&&<button onClick={()=>merkLest(s.id)} style={{padding:"7px 12px",background:"none",border:"1px solid "+C.border,borderRadius:7,color:C.muted,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Merk lest</button>}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function KommuneStatistikk({høringer,totalVarslet,totalSvar}) {
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:20}}>
        <Card>
          <div style={{fontSize:13,fontWeight:700,marginBottom:14,color:C.text}}>📊 Innspill per høring</div>
          {høringer.map(h=>(
            <div key={h.id} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
              <div style={{fontSize:12,color:C.text,width:160,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.tittel}</div>
              <div style={{flex:1,background:C.bgAlt,borderRadius:99,height:7,overflow:"hidden"}}>
                <div style={{background:C.komBlue,width:`${Math.min(100,h.svar/15*100)}%`,height:"100%",borderRadius:99}}/>
              </div>
              <div style={{fontSize:12,fontWeight:700,color:C.komBlue,width:24,textAlign:"right"}}>{h.svar}</div>
            </div>
          ))}
        </Card>
        <Card>
          <div style={{fontSize:13,fontWeight:700,marginBottom:14,color:C.text}}>🔔 Varsling per høring</div>
          {høringer.map(h=>(
            <div key={h.id} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
              <div style={{fontSize:12,color:C.text,width:160,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.tittel}</div>
              <div style={{flex:1,background:C.bgAlt,borderRadius:99,height:7,overflow:"hidden"}}>
                <div style={{background:C.purple,width:`${Math.min(100,h.varslet/220*100)}%`,height:"100%",borderRadius:99}}/>
              </div>
              <div style={{fontSize:12,fontWeight:700,color:C.purple,width:36,textAlign:"right"}}>{h.varslet}</div>
            </div>
          ))}
        </Card>
      </div>
      <Card style={{background:"linear-gradient(135deg,#EEF2FF,#E0E7FF)",border:"1px solid #C7D2FE"}}>
        <div style={{fontSize:13,fontWeight:700,color:C.komBlue,marginBottom:12}}>📈 Sammendragsrapport</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16}}>
          {[[totalVarslet,"Aktører nådd","via Kulturvarsling"],[totalSvar,"Innspill mottatt","fra feltet"],[`${Math.round(totalSvar/Math.max(1,totalVarslet)*100)}%`,"Gjennomsnittlig responsrate","vs 8% for e-post"]].map(([n,lbl,sub])=>(
            <div key={lbl} style={{textAlign:"center"}}>
              <div style={{fontSize:28,fontWeight:800,color:C.komBlue,fontFamily:"'Playfair Display',serif"}}>{n}</div>
              <div style={{fontSize:13,fontWeight:600,color:C.text,marginTop:4}}>{lbl}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>{sub}</div>
            </div>
          ))}
        </div>
        <div style={{marginTop:14,display:"flex",gap:8}}>
          <Btn variant="kom" size="sm">Last ned rapport (PDF)</Btn>
          <Btn variant="secondary" size="sm">Send til politisk ledelse</Btn>
        </div>
      </Card>
    </div>
  );
}

// ─── PUBLISER MODAL ───────────────────────────────────────────────────────
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
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div style={{background:C.bgCard,borderRadius:18,width:"100%",maxWidth:560,boxShadow:"0 24px 64px rgba(0,0,0,.3)"}} onClick={e=>e.stopPropagation()}>
        <div style={{background:C.komBlue,borderRadius:"18px 18px 0 0",padding:"20px 24px",color:"#fff",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontWeight:800,fontSize:16,fontFamily:"'Playfair Display',serif"}}>Publiser ny høring</div>
            <div style={{fontSize:12,opacity:.75,marginTop:3}}>Steg {steg} av 2</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,color:"rgba(255,255,255,.75)",cursor:"pointer"}}>✕</button>
        </div>

        <div style={{padding:"24px"}}>
          {steg===1&&(
            <div>
              <Input label="Tittel på høringen" placeholder="Eks: Revisjon av tilskudd til lokale kulturlokaler" value={tittel} onChange={e=>setTittel(e.target.value)}/>
              <Input label="Beskrivelse" placeholder="Beskriv hva høringen handler om og hva dere ønsker innspill på..." value={beskrivelse} onChange={e=>setBeskrivelse(e.target.value)} rows={4}/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:C.muted,marginBottom:5,textTransform:"uppercase",letterSpacing:".04em"}}>Fagfelt</div>
                  <select value={kategori} onChange={e=>setKategori(e.target.value)}
                    style={{width:"100%",padding:"10px 14px",borderRadius:8,border:`1.5px solid ${C.border}`,fontSize:14,color:C.text,background:C.bgCard,fontFamily:"inherit"}}>
                    {KATEGORIER.map(k=><option key={k.id} value={k.id}>{k.ikon} {k.label}</option>)}
                  </select>
                </div>
                <Input label="Høringsfrist" value={frist} onChange={e=>setFrist(e.target.value)} type="date"/>
              </div>
              <Btn variant="kom" size="lg" style={{width:"100%",marginTop:4}} onClick={()=>setSteg(2)} disabled={!tittel||!frist}>
                Neste: forhåndsvisning →
              </Btn>
            </div>
          )}

          {steg===2&&(
            <div>
              <div style={{background:"#EEF2FF",border:"1px solid #C7D2FE",borderRadius:12,padding:"16px 18px",marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:700,color:C.komBlue,textTransform:"uppercase",letterSpacing:".05em",marginBottom:8}}>Forhåndsvisning – slik ser kulturaktørene høringen</div>
                <div style={{fontSize:14,fontWeight:700,marginBottom:5}}>{tittel||"(ingen tittel)"}</div>
                <div style={{fontSize:13,color:C.muted,lineHeight:1.5,marginBottom:8}}>{beskrivelse||"(ingen beskrivelse)"}</div>
                <div style={{display:"flex",gap:6}}>
                  {KATEGORIER.find(k=>k.id===kategori)&&<Badge color={C.muted}>{KATEGORIER.find(k=>k.id===kategori)?.ikon} {KATEGORIER.find(k=>k.id===kategori)?.label}</Badge>}
                  {frist&&<Badge color={C.amber} bg="#FEF3C7">Frist {new Date(frist).toLocaleDateString("no-NO",{day:"numeric",month:"short"})}</Badge>}
                </div>
              </div>
              <div style={{background:"#F0FDF4",border:"1px solid #86EFAC",borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:13,color:C.green}}>
                🔔 <strong>Kulturvarsling vil automatisk varsle</strong> alle registrerte aktører innen "{KATEGORIER.find(k=>k.id===kategori)?.label}" om denne høringen.
              </div>
              <div style={{display:"flex",gap:10}}>
                <Btn variant="secondary" style={{flex:1}} onClick={()=>setSteg(1)}>← Rediger</Btn>
                <Btn variant="kom" style={{flex:2}} onClick={publiser}>✅ Publiser høring</Btn>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────
export default function App() {
  const [epost, setEpost] = useState("");
const [sendt, setSendt] = useState(false);
const meldPa = async () => {
  if (!epost) return;
  await sb.from("pamelding").insert({epost});
  setSendt(true);
};
return (
  <div style={{minHeight:"100vh",background:"#FAF7F2",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 20px",fontFamily:"'Playfair Display',serif",textAlign:"center"}}>
    <div style={{fontSize:14,letterSpacing:2,color:"#8B1A1A",marginBottom:16,fontFamily:"sans-serif"}}>KOMMER SNART</div>
    <h1 style={{fontSize:42,color:"#1a1a1a",marginBottom:16,lineHeight:1.2}}>Kulturvarsling.no</h1>
    <p style={{fontSize:18,color:"#555",maxWidth:520,lineHeight:1.7,marginBottom:8}}>Vi bygger et varslingssystem for kulturlivet – slik at du aldri går glipp av en høring, et vedtak eller en frist som angår ditt fagfelt.</p>
    <p style={{fontSize:16,color:"#777",maxWidth:480,marginBottom:32}}>Meld deg på, så gir vi deg beskjed når vi er klare.</p>
    {sendt ? (
      <p style={{color:"#8B1A1A",fontSize:18,fontWeight:700}}>Takk! Vi gir deg beskjed når vi lanserer.</p>
    ) : (
      <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center"}}>
        <input value={epost} onChange={e=>setEpost(e.target.value)} placeholder="din@epost.no" style={{padding:"12px 16px",borderRadius:8,border:"1px solid #ccc",fontSize:16,width:260}}/>
        <button onClick={meldPa} style={{padding:"12px 24px",background:"#8B1A1A",color:"white",border:"none",borderRadius:8,fontSize:16,cursor:"pointer"}}>Meld meg på</button>
      </div>
    )}
  </div>
);
  const [screen,setScreen]=useState("bruker-app");
  const [user,setUser]=useState(null);
  const [kommune,setKommune]=useState(null);

  if(screen==="bruker-login")    return <BrukerLogin setScreen={setScreen} setUser={setUser}/>;
  if(screen==="bruker-app")      return <BrukerApp user={user} setUser={setUser} setScreen={setScreen}/>;
  if(screen==="kommune-login")   return <KommuneLogin setScreen={setScreen} setKommune={setKommune}/>;
  if(screen==="kommune-app")     return <KommuneApp kommune={kommune} setScreen={setScreen}/>;
  return <BrukerApp user={user} setUser={setUser} setScreen={setScreen}/>;
}
