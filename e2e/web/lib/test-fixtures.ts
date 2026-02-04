/**
 * Custom Playwright fixtures for DashFrame E2E tests
 *
 * Extends base Playwright test with reusable actions:
 * - uploadFile: Upload CSV/JSON files from fixtures
 * - waitForChart: Wait for chart to fully render
 * - homePage: Navigate to home and verify loaded
 *
 * For parallel execution, each worker gets its own server port
 * to ensure IndexedDB isolation (different origins = different databases).
 */
import { test as base, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { BASE_PORT, hasExternalServer, isCI } from "../playwright.config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "..", "fixtures");

/**
 * Get the base URL for a worker based on its parallel index.
 * Each worker gets its own port for IndexedDB isolation.
 */
function getWorkerBaseURL(parallelIndex: number): string {
  // In CI or with external server, use the default port
  if (isCI || hasExternalServer) {
    return `http://localhost:${BASE_PORT}`;
  }
  // For local parallel execution, each worker gets its own port
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

// Worker-scoped fixtures (shared across tests in same worker)
interface DashFrameWorkerFixtures {
  /** Clears IndexedDB once when worker starts */
  clearIndexedDB: void;
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

export const test = base.extend<DashFrameFixtures, DashFrameWorkerFixtures>({
  /**
   * Clear IndexedDB once when worker starts.
   * Removes any pre-existing data from local development.
   * Worker-scoped + auto means it runs once per worker, before any tests.
   */
  clearIndexedDB: [
    async ({ browser }, use, workerInfo) => {
      const workerBaseURL = getWorkerBaseURL(workerInfo.parallelIndex);
      const page = await browser.newPage();
      try {
        await page.goto(workerBaseURL);
        await page.evaluate(async () => {
          const databases = await indexedDB.databases();
          await Promise.all(
            databases.map(
              (db) =>
                db.name &&
                new Promise<void>((resolve, reject) => {
                  const request = indexedDB.deleteDatabase(db.name!);
                  request.onsuccess = () => resolve();
                  request.onerror = () => reject(request.error);
                }),
            ),
          );
        });
      } finally {
        await page.close();
      }
      await use();
    },
    { scope: "worker", auto: true },
  ],

  /**
   * Get the worker's assigned base URL.
   * Each worker gets its own port for IndexedDB isolation.
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
   * Wait for visualization chart to fully render
   * Checks for data metadata and SVG presence
   */
  waitForChart: async ({ page }, use) => {
    await use(async () => {
      // Wait for data metadata (indicates data loaded)
      await expect(page.getByText(/\d+ rows • \d+ columns/)).toBeVisible({
        timeout: 30_000,
      });

      // Wait for SVG to render (vgplot renders async)
      await expect(
        page.locator('[data-testid="visualization-chart"] svg'),
      ).toBeVisible({ timeout: 15_000 });
    });
  },

  /**
   * Navigate to home page and verify it's loaded.
   * Uses absolute URL to ensure correct server for each worker.
   * IndexedDB is cleared once per worker by clearIndexedDB fixture.
   */
  homePage: async ({ page, workerBaseURL }, use) => {
    await use(async () => {
      await page.goto(workerBaseURL);
      await expect(
        page.getByRole("heading", { name: "Welcome to DashFrame" }),
      ).toBeVisible();
    });
  },
});

// Re-export expect for convenience
export { expect } from "@playwright/test";
