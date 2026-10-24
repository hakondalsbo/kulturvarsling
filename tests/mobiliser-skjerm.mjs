import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const base = process.env.MOBILISER_URL ?? "http://127.0.0.1:4173";
const ut = "/opt/cursor/artifacts/mobiliser";
await mkdir(ut, { recursive: true });

const sider = [
  ["panel", "/mobiliser?vis=panel", "[data-vis='panel']"],
  ["uten-fase", "/mobiliser?vis=uten-fase", "[data-vis='uten-fase']"],
  ["samtykke", "/mobiliser?vis=samtykke", "[data-visning='stengt']"],
  ["bekreftet", "/mobiliser?vis=bekreftet", "[data-vis='bekreftet']"],
  ["personvern", "/personvern#felles-innspill", "#felles-innspill"],
  ["min-side-port", "/min-side", "[data-minside='port']"],
  ["min-side", "/min-side?demo=side#fulgte", "#fulgte"],
];

const browser = await chromium.launch();
const page = await browser.newPage();

for (const bredde of [390, 1440]) {
  await page.setViewportSize({ width: bredde, height: bredde === 390 ? 844 : 1000 });
  for (const [navn, sti, velger] of sider) {
    await page.goto(`${base}${sti}`, { waitUntil: "networkidle" });
    await page.waitForSelector(velger);
    const maal = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    if (maal.scroll !== maal.inner) {
      throw new Error(`${navn} ${bredde}: scrollWidth ${maal.scroll} !== viewport ${maal.inner}`);
    }
    await page.screenshot({ path: `${ut}/${navn}-${bredde}.png`, fullPage: true });
  }
}

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${base}/mobiliser?vis=samtykke`, { waitUntil: "networkidle" });
const signer = await page.getByRole("button", { name: "Signer innspillet" }).count();
if (signer !== 0) throw new Error("Signeringsskjemaet vises mens flagget er av");
await page.getByText("Felles innspill åpner snart.").waitFor();
await page.goto(`${base}/min-side?demo=side#stottet`, { waitUntil: "networkidle" });
await page.waitForSelector("#stottet");
await page.waitForSelector("#fulgte");
await browser.close();
console.log("skjermbilder uten horisontal overflyt");
