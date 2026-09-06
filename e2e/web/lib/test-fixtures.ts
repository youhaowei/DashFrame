/**
 * Custom Playwright fixtures for DashFrame E2E tests
 *
 * Extends base Playwright test with reusable actions:
 * - uploadFile: Upload CSV/JSON files from fixtures
 * - waitForChart: Wait for chart to fully render
 * - homePage: Navigate to home and verify loaded
 *
 * One isolated host project owns all metadata and Arrow files. Tests run
 * serially and clear that project before navigating a fresh browser context.
 */
import { test as base, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "..", "fixtures");
const isCI = !!process.env.CI;
const BASE_PORT = Number(process.env.E2E_BASE_PORT ?? 3100);
const DASHFRAME_URL = process.env.E2E_DASHFRAME_URL;
const USER_TOKEN = process.env.E2E_USER_TOKEN;

/**
 * Get the base URL for a worker based on its parallel index.
 * The serial worker uses the run-specific web server.
 */
function getWorkerBaseURL(parallelIndex: number): string {
  // CI: single worker, single port
  // Local: use the configured worker port.
  if (isCI) {
    return `http://localhost:${BASE_PORT}`;
  }
  return `http://localhost:${BASE_PORT + parallelIndex}`;
}

// ─────────────────────────────────────────────────────────────
// Type definitions for custom fixtures
// ─────────────────────────────────────────────────────────────

type UploadFileFn = (fileName: string) => Promise<void>;
type UploadBufferFn = (
  name: string,
  content: string,
  mimeType?: string,
) => Promise<void>;
type WaitForChartFn = () => Promise<void>;
type HomePageFn = () => Promise<void>;

// Test-scoped auto fixtures
interface DashFrameAutoFixtures {
  /** Clears the native host project before each test for isolation */
  clearServerDB: void;
  /** Injects the authenticated API runtime before the app bootstraps. */
  authenticatedRuntime: void;
}

interface DashFrameFixtures {
  /** The worker's assigned base URL */
  workerBaseURL: string;
  /** Upload a file from e2e/web/fixtures directory */
  uploadFile: UploadFileFn;
  /** Upload in-memory content as a file (for error testing) */
  uploadBuffer: UploadBufferFn;
  /** Wait for chart SVG to render */
  waitForChart: WaitForChartFn;
  /** Navigate to home page and wait for it to load */
  homePage: HomePageFn;
}

// ─────────────────────────────────────────────────────────────
// Custom test with fixtures
// ─────────────────────────────────────────────────────────────

export const test = base.extend<DashFrameFixtures & DashFrameAutoFixtures>({
  /** Reset native metadata, drafts, and host-owned data before each test. */
  clearServerDB: [
    async ({}, use) => {
      if (!DASHFRAME_URL)
        throw new Error("E2E_DASHFRAME_URL was not configured");
      {
        const response = await fetch(`${DASHFRAME_URL}/api/host/clearAllData`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(USER_TOKEN ? { Authorization: `Bearer ${USER_TOKEN}` } : {}),
          },
          body: "{}",
        });
        if (!response.ok) {
          throw new Error(
            `Failed to clear the E2E host project before test: ${response.status} ${await response.text()}`,
          );
        }
      }
      await use();
    },
    { scope: "test", auto: true },
  ],

  authenticatedRuntime: [
    async ({ page }, use) => {
      if (!DASHFRAME_URL || !USER_TOKEN)
        throw new Error("E2E runtime was not configured");
      const response = await fetch(`${DASHFRAME_URL}/api/runtime`, {
        headers: { Authorization: `Bearer ${USER_TOKEN}` },
      });
      if (!response.ok)
        throw new Error(`E2E runtime discovery failed: ${response.status}`);
      const runtime = (await response.json()) as { convexUrl: string };
      await page.addInitScript(
        ({ url, token, convexUrl }) => {
          Object.defineProperty(globalThis, "dashframe", {
            configurable: true,
            value: { getServerInfo: async () => ({ url, token, convexUrl }) },
          });
        },
        { url: DASHFRAME_URL, token: USER_TOKEN, convexUrl: runtime.convexUrl },
      );
      await use();
    },
    { scope: "test", auto: true },
  ],

  /**
   * Get the worker's assigned base URL.
   * The serial worker uses the run-specific web server.
   */
  workerBaseURL: [
    async ({}, use, testInfo) => {
      await use(getWorkerBaseURL(testInfo.parallelIndex));
    },
    { scope: "test" },
  ],

  /**
   * Upload a file from the fixtures directory
   * Uses FileChooser API for reliable uploads
   */
  uploadFile: async ({ page }, use) => {
    await use(async (fileName: string) => {
      const filePath = path.join(fixturesDir, fileName);

      const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.getByText("Select Local Files").click(),
      ]);
      await fileChooser.setFiles(filePath);

      // Wait for processing
      await page.waitForTimeout(2000);
    });
  },

  /**
   * Upload in-memory content as a file
   * Useful for testing error cases (empty files, invalid JSON, etc.)
   */
  uploadBuffer: async ({ page }, use) => {
    await use(
      async (name: string, content: string, mimeType = "text/plain") => {
        const fileInput = page.locator('input[type="file"]');
        await fileInput.setInputFiles({
          name,
          mimeType,
          buffer: Buffer.from(content),
        });
      },
    );
  },

  /**
   * Wait for the active chart view to fully render.
   *
   * A chart is "ready" when an SVG has rendered inside the chart container.
   * Chart.tsx keeps data-testid="visualization-chart" on both the loading
   * placeholder and the rendered container, so the SVG child is the signal
   * that data loaded AND the renderer drew it. The old "N rows • N columns"
   * metadata gate belonged to the standalone visualization page; the insight
   * canvas (where charts render now) never shows that text on chart views.
   */
  waitForChart: async ({ page }, use) => {
    await use(async () => {
      await expect(
        page.locator('[data-testid="visualization-chart"] svg'),
      ).toBeVisible({ timeout: 30_000 });
    });
  },

  /**
   * Navigate to home page and verify it's loaded.
   * Uses absolute URL to ensure correct server for each worker.
   */
  homePage: async ({ page, workerBaseURL }, use) => {
    await use(async () => {
      await page.goto(workerBaseURL);
      // Home decides between onboarding and returning-user views only after
      // the visualization list loads from native Convex, so allow a
      // server round-trip (plus post-heavy-test latency) beyond the 5s
      // default expect timeout.
      await expect(
        page.getByRole("heading", { name: "Welcome to DashFrame" }),
      ).toBeVisible({ timeout: 15_000 });
    });
  },
});

// Re-export expect for convenience
export { expect } from "@playwright/test";
