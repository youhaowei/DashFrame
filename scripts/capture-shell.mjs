// One-shot visual capture for the three-region shell + assistant sidebar + HUD.
// Drives the running dev server through every required state and writes PNGs to
// a temp directory (these are disposable evidence, never committed). Override
// the destination with OUT_DIR.
//
// Usage: node scripts/capture-shell.mjs   (run from a dir where @playwright/test resolves)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = process.env.OUT_DIR ?? join(tmpdir(), "dashframe-shell-shots");
mkdirSync(OUT, { recursive: true });

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5300";
const VIEWPORT = { width: 1440, height: 900 };

const shot = (page, name) =>
  page.screenshot({ path: join(OUT, `${name}.png`) });

async function goto(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  // State-based wait: the left nav's brand link is always present once the shell
  // has mounted (regardless of assistant open/closed state), so wait for it
  // rather than a fixed delay.
  await page.getByText("DashFrame").first().waitFor({ state: "visible" });
}

async function ensureAssistant(page, open) {
  // The edge toggle ("Open assistant") only exists while the panel is closed;
  // while open, the panel header's "Dismiss assistant" closes it.
  const openBtn = page.locator('[aria-label="Open assistant"]');
  const panel = page.locator('[role="complementary"][aria-label="Assistant"]');
  const isOpen = (await openBtn.count()) === 0;
  if (open && !isOpen) {
    await openBtn.click();
    await panel.first().waitFor({ state: "visible" });
  }
  if (!open && isOpen) {
    await page
      .locator('[aria-label="Dismiss assistant"]:visible')
      .first()
      .click();
    await panel.first().waitFor({ state: "detached" });
  }
}

const main = async () => {
  const browser = await chromium.launch();
  try {
    await capture(browser);
  } finally {
    // Always tear down Chromium, even if a step throws mid-run.
    await browser.close();
  }
  console.log("captured →", OUT);
};

async function capture(browser) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  // 1. Shell, assistant closed — home route.
  await goto(page, "/");
  await ensureAssistant(page, false);
  await shot(page, "01-shell-home-closed");

  // 2. Assistant open in the shared right Dock (empty surface, no artifact).
  // The Dock always reflows the Stage beside it — there is no float mode.
  await ensureAssistant(page, true);
  await shot(page, "02-assistant-docked-empty");

  // 3. A different route with the assistant open — proves the shell is global.
  await goto(page, "/insights");
  await ensureAssistant(page, true);
  await shot(page, "03-assistant-global-insights");

  // 4. Data-sources list route with the assistant open.
  await goto(page, "/data-sources");
  await ensureAssistant(page, true);
  await shot(page, "04-assistant-global-data-sources");

  // 5. Assistant dismissed / collapsed — full-width artifact.
  await ensureAssistant(page, false);
  await shot(page, "05-assistant-collapsed");

  // 6. Dev HUD open — visit a couple of AppLayout pages first so the HUD has
  // real render-stage samples to display against budgets.
  await goto(page, "/data-sources");
  await goto(page, "/insights");
  await goto(page, "/data-sources");
  const perfChip = page.locator("button", { hasText: /^perf$/ }).first();
  await perfChip.scrollIntoViewIfNeeded();
  await perfChip.click({ force: true });
  // Wait for the HUD panel (the "dev only" header label) to render.
  await page.getByText("dev only").waitFor({ state: "visible" });
  await shot(page, "06-dev-hud-open");

  // 7. Dev HUD closed (chip only, in the nav footer).
  await perfChip.click({ force: true });
  await page.getByText("dev only").waitFor({ state: "hidden" });
  await shot(page, "07-dev-hud-closed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
