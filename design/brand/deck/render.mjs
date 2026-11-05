// Renders design/brand/deck/deck.html into the slide images of /presentation (client/public/presentation/NN.webp,
// 1600×900). Needs Playwright with Chromium (npx playwright install chromium) and network for Google Fonts.
//   node design/brand/deck/render.mjs [path to playwright]   — default: the one in ~/.mcp-tools/ux
// The wordmark is taken from client/src/components/logo.tsx, so the deck never drifts from the site's logo.
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const require = createRequire(process.argv[2] ?? `${process.env.USERPROFILE ?? process.env.HOME}/.mcp-tools/ux/node_modules/`);
const { chromium } = require("playwright");

const logo = readFileSync(join(root, "client/src/components/logo.tsx"), "utf8");
const paths = (name) => [...logo.split(`export const ${name}`)[1].split("];")[0].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const wordmark = (height, ink) =>
  `<svg viewBox="-40 -826 3047 898" style="height:${height}px;width:auto;overflow:visible" aria-label="ichiba">` +
  paths("LETTERS").map((d) => `<path class="wm-letter" fill="${ink}" d="${d}"/>`).join("") +
  paths("SEALS").map((d) => `<path fill="#c8102e" d="${d}"/>`).join("") +
  "</svg>";

const html = readFileSync(join(here, "deck.html"), "utf8")
  .replaceAll("{{WORDMARK_BIG}}", wordmark(200, "#1c1a17"))
  .replaceAll("{{WORDMARK_LIGHT}}", wordmark(34, "#f4efe6"))
  .replaceAll("{{WORDMARK}}", wordmark(34, "#1c1a17"));
const built = join(here, ".deck.built.html");
writeFileSync(built, html);

const out = join(root, "client/public/presentation");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(`file:///${built.replace(/\\/g, "/")}`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const slides = await page.$$("section.slide");
const names = new Set();
for (const slide of slides) {
  const n = Number(await slide.getAttribute("data-n"));
  const png = await slide.screenshot({ type: "png" });
  // WebP through the browser's own encoder: no image library needed.
  const webp = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    [c.width, c.height] = [img.width, img.height];
    c.getContext("2d").drawImage(img, 0, 0);
    return c.toDataURL("image/webp", 0.9).split(",")[1];
  }, png.toString("base64"));
  const name = `${String(n).padStart(2, "0")}.webp`;
  writeFileSync(join(out, name), Buffer.from(webp, "base64"));
  names.add(name);
  console.log("slide", name);
}
// Slides that no longer exist in the deck.
for (const f of readdirSync(out)) if (/^\d+\.webp$/.test(f) && !names.has(f)) unlinkSync(join(out, f));
await browser.close();
unlinkSync(built);
