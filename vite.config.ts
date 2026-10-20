import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Samme rene stier som vercel.json, så lenkene virker i vite dev og preview.
function reneStier(): Plugin {
  const kart: Record<string, string> = {
    "/personvern": "/personvern.html",
    "/bekreft": "/bekreft.html",
    "/avmelding": "/avmelding.html",
  };
  const omskriv = (req: { url?: string }, _res: unknown, next: () => void) => {
    const url = req.url ?? "/";
    const q = url.indexOf("?");
    const sti = q === -1 ? url : url.slice(0, q);
    const maal = kart[sti];
    if (maal) req.url = maal + (q === -1 ? "" : url.slice(q));
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
