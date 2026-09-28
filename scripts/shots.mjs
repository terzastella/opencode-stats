// Docs screenshots via headless Edge (no browser download needed).
// Usage: npm run build && vite preview --port 1421 & node scripts/shots.mjs
// Re-run any time with: npm run shots (preview must be serving dist/).
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE = process.env.SHOTS_URL ?? "http://localhost:1421";
const OUT = path.dirname(fileURLToPath(new URL("../docs/screenshots/.keep", import.meta.url)));
const shot = (name) => path.join(OUT, name);

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  // 1. Dashboard EN (demo dataset).
  await page.goto(`${BASE}/?demo&lang=en`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot("dashboard-en.png") });

  // 2. Dashboard IT.
  await page.goto(`${BASE}/?demo&lang=it`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot("dashboard-it.png") });

  // 3. Profile settings modal with heatmap.
  await page.goto(`${BASE}/?demo=settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot("settings.png") });

  // 4. Heatmap hover tooltip on a middle cell.
  const cell = page.locator(".heat:not(.heat-pad):not(.heat-skel)").nth(100);
  await cell.hover({ timeout: 5000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("heatmap-hover.png") });

  console.log("shots saved to", OUT);
} finally {
  await browser.close();
}
