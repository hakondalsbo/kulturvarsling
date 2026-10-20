// Mocken for kommuneportalen er av til Håkon eksplisitt skrur den på.
// Sett VITE_KOMMUNELOGIN=true i miljøet for å vise innloggingen.
export const kommuneLoginSynlig = import.meta.env.VITE_KOMMUNELOGIN === "true";
