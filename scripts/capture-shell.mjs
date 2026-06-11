// One-shot visual capture for the three-region shell + assistant sidebar + HUD.
// Drives the running worktree dev server (http://127.0.0.1:5300) through every
// required state and writes PNGs to docs/screenshots/.
//
// Usage: node scripts/capture-shell.mjs   (run from a dir where @playwright/test resolves)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT_DIR ?? join(__dirname, "../docs/screenshots");
mkdirSync(OUT, { recursive: true });

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5300";
const VIEWPORT = { width: 1440, height: 900 };

const shot = (page, name) =>
  page.screenshot({ path: join(OUT, `${name}.png`) });

async function goto(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
}

const toggle = (page) =>
  page.locator('[aria-label="Open assistant"], [aria-label="Hide assistant"]');

async function ensureAssistant(page, open) {
  const t = toggle(page);
  const label = await t.getAttribute("aria-label");
  const isOpen = label === "Hide assistant";
  if (open !== isOpen) await t.click();
  await page.waitForTimeout(450);
}

async function setDock(page, target /* "docked" | "floating" */) {
  const undock = page.locator('[aria-label="Undock (float)"]:visible').first();
  const dockBtn = page.locator('[aria-label="Dock to right"]:visible').first();
  if (target === "floating" && (await undock.count())) await undock.click();
  if (target === "docked" && (await dockBtn.count())) await dockBtn.click();
  await page.waitForTimeout(450);
}

const main = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  // 1. Shell, assistant closed — home route.
  await goto(page, "/");
  await ensureAssistant(page, false);
  await shot(page, "01-shell-home-closed");

  // 2. Assistant docked + open (empty conversation surface, no artifact).
  await ensureAssistant(page, true);
  await setDock(page, "docked");
  await shot(page, "02-assistant-docked-empty");

  // 3. Assistant undocked / floating overlay.
  await setDock(page, "floating");
  await shot(page, "03-assistant-floating");

  // 4. Back to docked, then a different route — proves the shell is global.
  await setDock(page, "docked");
  await goto(page, "/insights");
  await ensureAssistant(page, true);
  await shot(page, "04-assistant-global-insights");

  // 5. Data-sources list route with the assistant docked.
  await goto(page, "/data-sources");
  await ensureAssistant(page, true);
  await shot(page, "05-assistant-global-data-sources");

  // 6. Assistant dismissed / collapsed — full-width artifact.
  await ensureAssistant(page, false);
  await shot(page, "06-assistant-collapsed");

  // 7. Narrow viewport — docked preference auto-overlays (no room to reflow).
  await ensureAssistant(page, true);
  await setDock(page, "docked");
  await page.setViewportSize({ width: 720, height: 900 });
  await page.waitForTimeout(600);
  await shot(page, "07-assistant-narrow-overlay");
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(400);

  // 8. Dev HUD open — visit a couple of AppLayout pages first so the HUD has
  // real render-stage samples to display against budgets.
  await ensureAssistant(page, false);
  await goto(page, "/data-sources");
  await goto(page, "/insights");
  await goto(page, "/data-sources");
  const perfChip = page.locator("button", { hasText: /^perf$/ }).first();
  await perfChip.scrollIntoViewIfNeeded();
  await perfChip.click({ force: true });
  await page.waitForTimeout(400);
  await shot(page, "08-dev-hud-open");

  // 9. Dev HUD closed (chip only, bottom-left).
  await perfChip.click({ force: true });
  await page.waitForTimeout(300);
  await shot(page, "09-dev-hud-closed");

  await browser.close();
  console.log("captured →", OUT);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
