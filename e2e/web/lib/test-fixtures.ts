/**
 * Custom Playwright fixtures for DashFrame E2E tests
 *
 * Extends base Playwright test with reusable actions:
 * - uploadFile: Upload CSV/JSON files from fixtures
 * - waitForChart: Wait for chart to fully render
 * - homePage: Navigate to home and verify loaded
 */
import { test as base, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "..", "fixtures");

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

interface DashFrameFixtures {
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

export const test = base.extend<DashFrameFixtures>({
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
   * Navigate to home page and verify it's loaded
   */
  homePage: async ({ page }, use) => {
    await use(async () => {
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "Welcome to DashFrame" }),
      ).toBeVisible();
    });
  },
});

// Re-export expect for convenience
export { expect } from "@playwright/test";
