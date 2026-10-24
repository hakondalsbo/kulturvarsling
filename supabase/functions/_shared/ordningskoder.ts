// Ordningskoder fra Kulturdirektoratets vedtaksdatabase.
//
// Kilde: nedtrekkslisten «Tilskuddsordning» (select#ordning) på
// https://www.kulturdirektoratet.no/vedtak
// Hentet 2026-10-24. Navnene er gjengitt derfra.
// Myke bindestreker (U+00AD) er fjernet, og flere mellomrom er slått
// sammen til ett. Tankestrek og ordlyd er ellers uendret.
//
// Koder som ikke står her skal ikke forklares. De gjengis som koden,
// og prompten ber modellen la være å tolke dem.
//
// Listen er statisk med vilje. Samme side kan leses maskinelt (option-
// elementene ligger i HTML-en), men en versjonert kopi endres ikke
// stille hvis markupen på siden endres.

export const ORDNINGSKODER_VERSJON = "2026-10-24";
export const ORDNINGSKODER_KILDE = "https://www.kulturdirektoratet.no/vedtak";

export const ORDNINGSKODER: Readonly<Record<string, string>> = {
  "KUL-AMA": "Amatørteateraktivitet i grupper",
  "NKF-ASP": "Aspirantordning – mangfold i kultursektoren",
  "NKF-ASF": "Aspirantordning – personer med funksjonsnedsettelser",
  "NKF-RFK": "Bygg og infrastruktur - ARENA",
  "KUL-KRT": "Den kollektive oppreisningen til romanifolket/taterne",
  "KUL-AMD": "Driftstilskudd til frivillige organisasjoner for scenisk amatørvirksomhet",
  "KUL-NMD": "Driftstilskudd til organisasjoner for nasjonale minoriteter",
  "KUL-FMN": "Faglige museumsnettverk - treårig",
  "FLB-CINE": "Fond for lyd og bilde Film",
  "FLB-MEDIA": "Fond for lyd og bilde Markedsføring",
  "FLB-AUDIO": "Fond for lyd og bilde Musikk",
  "FLB-PRO": "Fond for lyd og bilde Prosjektstøtte",
  "FLB-LIVE": "Fond for lyd og bilde Scene",
  "FLB-GJE": "Gjenopptakelse av sceneforestillinger",
  "KUL-HSF": "Historiske spel",
  "KUL-IND": "Insentivordning for ny dramatikk",
  "NKF-LKV": "Kulturvern – faglitteratur",
  "NKF-PKV": "Kulturvern – prosjekter",
  "NKF-FOF": "Kunst- og kulturforskning – forskere",
  "NKF-FOM": "Kunst- og kulturforskning – masterstudenter",
  "NKF-LFO": "Litteraturformidling",
  "NKF-LPO": "Litteraturproduksjon",
  "NKF-LPR": "Litteraturprosjekt",
  "FLB-MFF": "Markedsføring av kortfilm og dokumentarfilm",
  "FLB-MFA": "Markedsføring av musikkutgivelser",
  "KUL-AFR": "Markering av FNs tiår for mennesker av afrikansk opprinnelse",
  "KUL-MAS": "Masterstipend for mangfoldskunnskap",
  "NKF-PUB": "Musikk - publisering",
  "NKF-PAM": "Musikk – andre musikkprosjekter",
  "NKF-BST": "Musikk – komposisjon og produksjon",
  "NKF-ARM": "Musikk – konsertarrangører",
  "NKF-MME": "Musikk – konserter og turneer – prosjekter og virksomheter",
  "NKF-FON": "Musikk – særskilte innspillingsprosjekter",
  "NKF-IBK": "Musikk og scenekunst – internasjonalt bærekraftprogram",
  "NKF-MFV": "Musikkfestivaler",
  "KUL-MKO": "Møteplasser og kulturarenaer for romanifolket/taterne",
  "KUL-KND": "Nasjonalt driftstilskudd til kvensk språk og kvensk/norskfinsk kultur",
  "FLB-FILMM": "Norsk musikk i audiovisuelle produksjoner",
  "KUL-NIS": "Norsk-islandsk kultursamarbeid",
  "NKF-ISB": "Ny norsk sakprosa for barn og unge – innkjøpsordning",
  "NKF-ISV": "Ny norsk sakprosa for vaksne – innkjøpsordning",
  "NKF-IAB": "Ny norsk skjønnlitteratur for barn og unge – automatisk innkjøpsordning",
  "NKF-IUB": "Ny norsk skjønnlitteratur for barn og unge – selektiv innkjøpsordning",
  "NKF-IAV": "Ny norsk skjønnlitteratur for vaksne – automatisk innkjøpsordning",
  "NKF-IUV": "Ny norsk skjønnlitteratur for vaksne – selektiv innkjøpsordning",
  "NKF-ITS": "Nye norske teikneseriar – innkjøpsordning",
  "NKF-IOL": "Omsett litteratur – innkjøpsordning",
  "FLB-BILDK": "Prosjektstøtte billedkunst",
  "FLB-FOPRO": "Prosjektstøtte fonogram",
  "FLB-FIOVI": "Prosjektstøtte kortfilm og dokumentarfilm",
  "FLB-MUSIK": "Prosjektstøtte musikk",
  "FLB-SCENE": "Prosjektstøtte scene",
  "FLB-TEKST": "Prosjektstøtte tekst",
  "KUL-KNP": "Prosjekttilskudd til kvensk språk og kvensk/norskfinsk kultur",
  "KUL-NMP": "Prosjekttilskudd til nasjonale minoriteter",
  "NKF-ARD": "Scenekunst – arrangører",
  "NKF-FSK": "Scenekunst – kunstnerskap",
  "NKF-FSD": "Scenekunst – danseproduksjoner",
  "NKF-FSV": "Scenekunst – etablerte virksomheter",
  "NKF-FPS": "Scenekunst – forprosjekt",
  "NKF-GJE": "Scenekunst – gjestespill og turneer",
  "NKF-STU": "Scenekunst – kompetanseutvikling og publikasjoner",
  "NKF-FST": "Scenekunst – teaterproduksjoner",
  "KUL-SMM": "Sikring av museer",
  "NKF-SKB": "Skolebibliotekordning",
  "NKF-TTK": "Tidsskrift og kritikk",
  "NKF-TKV": "Tverrfaglig kulturvirksomhet",
  "KUL-UPM": "Utviklingsprogram museer",
  "NKF-UKA": "Utviklingstiltak for kulturaktører",
  "NKF-KAO": "Visuell kunst – kunstnerassistent",
  "NKF-UTS": "Visuell kunst – produksjon – nyetablerte kunstnere",
  "NKF-AVK": "Visuell kunst – arrangører",
  "NKF-VIS": "Visuell kunst – produksjon og formidling – kunstnere",
  "NKF-VIV": "Visuell kunst – produksjon og formidling – visningssteder",
  "NKF-MKL": "Visuell kunst – publikasjoner og manusutvikling",
  "NKF-UFV": "Visuell kunst – utstyr til fellesverksteder og gjestekunstnerordninger",
};

const KODE_MONSTER = /\b[A-Z]{3}-[A-Z]{3,8}\b/g;

/** Offisielt navn, eller null når koden ikke står i ordlisten. */
export function ordningsnavn(kode: string | null | undefined): string | null {
  if (!kode) return null;
  const nøkkel = kode.trim().toUpperCase();
  if (!nøkkel) return null;
  return ORDNINGSKODER[nøkkel] ?? null;
}

/** «KODE: offisielt navn», eller bare koden når den ikke står i ordlisten. */
export function ordningsetikett(kode: string): string {
  const trimmet = kode.trim();
  if (!trimmet) return trimmet;
  const vis = trimmet.toUpperCase();
  const navn = ORDNINGSKODER[vis];
  return navn ? `${vis}: ${navn}` : trimmet;
}

/**
 * Innkjøpsordning etter det offisielle navnet.
 * Ukjente koder er ikke innkjøpsordninger.
 */
export function erInnkjopsordning(kode: string | null | undefined): boolean {
  const navn = ordningsnavn(kode);
  return navn != null && navn.toLowerCase().includes("innkjøpsordning");
}

/**
 * Kategori fra ordningskoden. Bare id-er som finnes fra før.
 *
 * Appens KATEGORIER er scenekunst, musikk, dans, opera, litteratur,
 * film, visuell, museer, spill og kulturarv. «markedsføring» og
 * «generell» finnes ikke der, og legges ikke til.
 *
 * FLB-MEDIA («Fond for lyd og bilde Markedsføring») dekker musikk,
 * scene og film. Ingen av de ti fagene er nærmere enn de andre.
 * Den får kulturpolitikk, som allerede er samlekategorien når en sak
 * ikke er ett fag. Ordninger der navnet selv sier hvilket fag
 * markedsføringen gjelder, får det faget.
 *
 * Ukjent kode gir null. Den forklares ikke, og kategorien gjettes ikke.
 */
export function kategoriForOrdning(kode: string | null | undefined): string | null {
  const navn = ordningsnavn(kode);
  if (!navn) return null;
  const n = navn.toLowerCase();

  if (/innkjøpsordning|skjønnlitteratur|sakprosa|teikneseri|faglitteratur|\blitteratur/.test(n)) {
    return "litteratur";
  }
  if (/\bmarkedsføring\b/.test(n) && !/musikk|film|scene|scenekunst/.test(n)) {
    return "kulturpolitikk";
  }
  if (/danseproduksjon|\bdans\b/.test(n)) return "dans";
  if (/\bopera\b/.test(n)) return "opera";
  if (/\bspill\b|dataspill/.test(n)) return "spill";
  if (/museum|museer/.test(n)) return "museer";
  if (/billedkunst|visuell kunst/.test(n)) return "visuell";
  if (/\bfilm\b|dokumentarfilm|kortfilm/.test(n)) return "film";
  if ((/musikk|fonogram/.test(n)) && (/scenekunst|\bscene\b/.test(n))) {
    return "kulturpolitikk";
  }
  if (/musikk|fonogram/.test(n)) return "musikk";
  if (/scenekunst|\bscene\b|sceneforestilling|scenisk|amatørteater|\bteater\b|dramatikk|historiske spel/.test(n)) {
    return "scenekunst";
  }
  if (/kulturvern|kulturbygg|\binfrastruktur\b/.test(n)) return "kulturarv";
  return null;
}

/** Koder i teksten, uten duplikater, sortert. */
export function finnOrdningskoder(tekst: string): string[] {
  const sett = new Set<string>();
  const monster = new RegExp(KODE_MONSTER.source, "g");
  for (const treff of tekst.toUpperCase().matchAll(monster)) sett.add(treff[0]);
  return [...sett].sort();
}

/**
 * Forklaring til prompten, bare for koder som faktisk står i teksten.
 * Kjente koder får det offisielle navnet. Ukjente koder forklares ikke.
 */
export function ordningsforklaring(tekst: string): string {
  const koder = finnOrdningskoder(tekst);
  if (!koder.length) return "";
  const linjer = koder.map((kode) => {
    const navn = ORDNINGSKODER[kode];
    return navn ? `- ${kode}: ${navn}` : `- ${kode}: ikke i ordlisten`;
  });
  return [
    "ORDNINGSKODER:",
    ...linjer,
    "Bruk navnet over når koden står der. Ikke bytt det ut med en annen forklaring.",
    "Koder merket «ikke i ordlisten» skal gjengis som koden. Ikke tolk dem.",
  ].join("\n");
}
