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
import { test as base, expect, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "..", "fixtures");
const isCI = !!process.env.CI;
const BASE_PORT = Number(process.env.E2E_BASE_PORT ?? 3100);
const DASHFRAME_URL = process.env.E2E_DASHFRAME_URL;

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

/**
 * Open the "Local Files" connector so its file input is in the DOM.
 *
 * The connector list is a disclosure: only the picked connector renders its
 * setup form, so the file input does not exist until the row is opened. Once
 * it is open the panel drops the toggle and the header stops being a button,
 * which is why this checks for the input rather than the row's state.
 */
async function openLocalFilesConnector(page: Page): Promise<void> {
  const fileInput = page.locator('input[type="file"]');
  if ((await fileInput.count()) > 0) return;
  // Matched on the connector's description, not its name: once a file has been
  // uploaded a data source called "Local Files" also appears in the picker.
  await page
    .getByRole("button", {
      name: /Upload a CSV or JSON file from your computer/,
    })
    .click();
  await expect(fileInput).toHaveCount(1);
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

      await openLocalFilesConnector(page);
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
        await openLocalFilesConnector(page);
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
