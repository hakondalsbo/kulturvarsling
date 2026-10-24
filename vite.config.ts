import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { personvernTilleggHtml } from "./src/innhold/personvern-felles-innspill.ts";

// Vercel setter VERCEL_ENV, ikke VITE_VERCEL_ENV. Klienten skal se samme verdi.
const vercelEnv = process.env.VITE_VERCEL_ENV || process.env.VERCEL_ENV || "";

function mobiliserVisning(): boolean {
  const eksplisitt = (process.env.VITE_MOBILISERING_SIGNATUR_AKTIV ?? "").trim().toLowerCase();
  if (eksplisitt === "false") return false;
  if (eksplisitt === "true") return true;
  if ((process.env.VITE_MOBILISER_DEMO ?? "").trim().toLowerCase() === "true") return true;
  return vercelEnv.trim().toLowerCase() === "preview";
}

function medPersonvernUtkast(html: string): string {
  if (html.includes('id="felles-innspill"')) return html;
  const tillegg = personvernTilleggHtml();
  const merke = '<p class="bunn">';
  if (html.includes(merke)) return html.replace(merke, `${tillegg}\n    ${merke}`);
  return html.replace("</body>", `${tillegg}\n</body>`);
}

/** Tillegget ligger bare i preview og demo. public/personvern.html endres ikke. */
function personvernUtkast(): Plugin {
  const aktiv = mobiliserVisning();
  const svar = (res: { statusCode: number; setHeader: (n: string, v: string) => void; end: (b: string) => void }) => {
    const html = medPersonvernUtkast(readFileSync(new URL("./public/personvern.html", import.meta.url), "utf8"));
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  };
  const treff = (url: string | undefined) => {
    const sti = (url ?? "/").split("?")[0].replace(/\/$/, "") || "/";
    return sti === "/personvern" || sti === "/personvern.html";
  };
  return {
    name: "personvern-felles-innspill",
    configureServer(server) {
      if (!aktiv) return;
      server.middlewares.use((req, res, next) => {
        if (!treff(req.url)) { next(); return; }
        svar(res as { statusCode: number; setHeader: (n: string, v: string) => void; end: (b: string) => void });
      });
    },
    configurePreviewServer(server) {
      if (!aktiv) return;
      server.middlewares.use((req, res, next) => {
        if (!treff(req.url)) { next(); return; }
        svar(res as { statusCode: number; setHeader: (n: string, v: string) => void; end: (b: string) => void });
      });
    },
    closeBundle() {
      if (!aktiv) return;
      const fil = "dist/personvern.html";
      if (!existsSync(fil)) return;
      writeFileSync(fil, medPersonvernUtkast(readFileSync(fil, "utf8")));
    },
  };
}

// Samme rene stier som vercel.json, så lenkene virker i vite dev og preview.
function reneStier(): Plugin {
  const kart: Record<string, string> = {
    "/personvern": "/personvern.html",
    "/bekreft": "/bekreft.html",
    "/avmelding": "/avmelding.html",
  };
  const appSti = new Set(["/", "/ordliste", "/design", "/statsbudsjett", "/min-side", "/app", "/mobiliser"]);
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
    const kjent = appSti.has(sti) || sti.startsWith("/app/") || sti.startsWith("/komite/") || sti.includes(".") || sti.startsWith("/@") || sti.startsWith("/src/") || sti.startsWith("/node_modules/");
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
  plugins: [personvernUtkast(), react(), reneStier()],
  define: {
    "import.meta.env.VITE_VERCEL_ENV": JSON.stringify(vercelEnv),
  },
})
