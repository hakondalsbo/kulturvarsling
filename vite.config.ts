import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Samme rene stier som vercel.json, så lenkene virker i vite dev og preview.
function reneStier(): Plugin {
  const kart: Record<string, string> = {
    "/personvern": "/personvern.html",
    "/bekreft": "/bekreft.html",
    "/avmelding": "/avmelding.html",
  };
  const appSti = new Set(["/", "/ordliste", "/design", "/statsbudsjett", "/min-side", "/app"]);
  const omskriv = (req: { url?: string; headers?: { accept?: string } }, res: { statusCode?: number }, next: () => void) => {
    const url = req.url ?? "/";
    const q = url.indexOf("?");
    const sti = (q === -1 ? url : url.slice(0, q)).replace(/\/$/, "") || "/";
    const maal = kart[sti];
    if (maal) {
      req.url = maal + (q === -1 ? "" : url.slice(q));
      next();
      return;
    }
    const accept = req.headers?.accept ?? "";
    const erDokument = accept.includes("text/html");
    const kjent = appSti.has(sti) || sti.startsWith("/app/") || sti.includes(".") || sti.startsWith("/@") || sti.startsWith("/src/") || sti.startsWith("/node_modules/");
    if (erDokument && !kjent) {
      const svar = res as { statusCode: number; setHeader: (n: string, v: string) => void; end: (b: string) => void };
      svar.statusCode = 404;
      svar.setHeader("Content-Type", "text/html; charset=utf-8");
      svar.end(readFileSync(new URL("./public/404.html", import.meta.url), "utf8"));
      return;
    }
    next();
  };
  return {
    name: "rene-stier",
    configureServer(server) {
      server.middlewares.use(omskriv);
    },
    configurePreviewServer(server) {
      server.middlewares.use(omskriv);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), reneStier()],
})
