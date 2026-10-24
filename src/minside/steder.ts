export type StedValg = {
  id: string;
  navn: string;
  slag: "kommune" | "fylkeskommune";
  tokens: string[];
};

/**
 * Utvalg til forslaget, ikke hele kommune-Norge. Token kommune:NNNN er SSB-nummer
 * og matcher varsler.kommunenr. sted: er med fordi noen saker bare har stedsnavn.
 * fylkeskommune:NN matcher bare saker med niva = fylke, ikke kommunene i fylket.
 * Det eldre tokenet fylke:NN gjør fortsatt det, og Min side skriver det ikke.
 */
export const STEDER: StedValg[] = [
  { id: "kommune:0301", navn: "Oslo kommune", slag: "kommune", tokens: ["kommune:0301", "sted:oslo"] },
  { id: "kommune:1103", navn: "Stavanger kommune", slag: "kommune", tokens: ["kommune:1103", "sted:stavanger"] },
  { id: "kommune:1108", navn: "Sandnes kommune", slag: "kommune", tokens: ["kommune:1108", "sted:sandnes"] },
  { id: "kommune:1106", navn: "Haugesund kommune", slag: "kommune", tokens: ["kommune:1106", "sted:haugesund"] },
  { id: "kommune:1507", navn: "Ålesund kommune", slag: "kommune", tokens: ["kommune:1507", "sted:ålesund"] },
  { id: "kommune:1804", navn: "Bodø kommune", slag: "kommune", tokens: ["kommune:1804", "sted:bodø"] },
  { id: "kommune:3107", navn: "Fredrikstad kommune", slag: "kommune", tokens: ["kommune:3107", "sted:fredrikstad"] },
  { id: "kommune:3201", navn: "Bærum kommune", slag: "kommune", tokens: ["kommune:3201", "sted:bærum"] },
  { id: "kommune:3203", navn: "Asker kommune", slag: "kommune", tokens: ["kommune:3203", "sted:asker"] },
  { id: "kommune:3205", navn: "Lillestrøm kommune", slag: "kommune", tokens: ["kommune:3205", "sted:lillestrøm"] },
  { id: "kommune:3301", navn: "Drammen kommune", slag: "kommune", tokens: ["kommune:3301", "sted:drammen"] },
  { id: "kommune:3403", navn: "Hamar kommune", slag: "kommune", tokens: ["kommune:3403", "sted:hamar"] },
  { id: "kommune:3405", navn: "Lillehammer kommune", slag: "kommune", tokens: ["kommune:3405", "sted:lillehammer"] },
  { id: "kommune:4204", navn: "Kristiansand kommune", slag: "kommune", tokens: ["kommune:4204", "sted:kristiansand"] },
  { id: "kommune:4601", navn: "Bergen kommune", slag: "kommune", tokens: ["kommune:4601", "sted:bergen"] },
  { id: "kommune:5001", navn: "Trondheim kommune", slag: "kommune", tokens: ["kommune:5001", "sted:trondheim"] },
  { id: "kommune:5501", navn: "Tromsø kommune", slag: "kommune", tokens: ["kommune:5501", "sted:tromsø"] },
  { id: "kommune:5601", navn: "Alta kommune", slag: "kommune", tokens: ["kommune:5601", "sted:alta"] },
  { id: "fylkeskommune:11", navn: "Rogaland fylkeskommune", slag: "fylkeskommune", tokens: ["fylkeskommune:11"] },
  { id: "fylkeskommune:15", navn: "Møre og Romsdal fylkeskommune", slag: "fylkeskommune", tokens: ["fylkeskommune:15"] },
  { id: "fylkeskommune:18", navn: "Nordland fylkeskommune", slag: "fylkeskommune", tokens: ["fylkeskommune:18"] },
  { id: "fylkeskommune:31", navn: "Østfold fylkeskommune", slag: "fylkeskommune", tokens: ["fylkeskommune:31"] },
  { id: "fylkeskommune:32", navn: "Akershus fylkeskommune", slag: "fylkeskommune", tokens: ["fylkeskommune:32"] },
  { id: "fylkeskommune:33", navn: "Buskerud fylkeskommune", slag: "fylkeskommune", tokens: ["fylkeskommune:33"] },
  { id: "fylkeskommune:34", navn: "Innlandet fylkeskommune", slag: "fylkeskommune", tokens: ["fylkeskommune:34"] },
  { id: "fylkeskommune:39", navn: "Vestfold fylkeskommune", slag: "fylkeskommune", tokens: ["fylkeskommune:39"] },
  { id: "fylkeskommune:40", navn: "Telemark fylkeskommune", slag: "fylkeskommune", tokens: ["fylkeskommune:40"] },
  { id: "fylkeskommune:42", navn: "Agder fylkeskommune", slag: "fylkeskommune", tokens: ["fylkeskommune:42"] },
  { id: "fylkeskommune:46", navn: "Vestland fylkeskommune", slag: "fylkeskommune", tokens: ["fylkeskommune:46"] },
  { id: "fylkeskommune:50", navn: "Trøndelag fylkeskommune", slag: "fylkeskommune", tokens: ["fylkeskommune:50"] },
  { id: "fylkeskommune:55", navn: "Troms fylkeskommune", slag: "fylkeskommune", tokens: ["fylkeskommune:55"] },
  { id: "fylkeskommune:56", navn: "Finnmark fylkeskommune", slag: "fylkeskommune", tokens: ["fylkeskommune:56"] },
];

export function stedNavn(tokens: string[]): string[] {
  const navn: string[] = [];
  for (const sted of STEDER) {
    if (sted.tokens.every((t) => tokens.includes(t)) || tokens.includes(sted.id)) navn.push(sted.navn);
  }
  return navn;
}

export function filtrerSteder(sok: string): StedValg[] {
  const q = sok.trim().toLowerCase();
  const liste = [...STEDER].sort((a, b) => {
    if (a.id === "kommune:0301") return -1;
    if (b.id === "kommune:0301") return 1;
    if (a.slag !== b.slag) return a.slag === "fylkeskommune" ? -1 : 1;
    return a.navn.localeCompare(b.navn, "nb");
  });
  if (!q) return liste;
  return liste.filter((s) => s.navn.toLowerCase().includes(q));
}
