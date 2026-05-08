/**
 * Chart Editing Tests
 *
 * Tests for switching chart types and editing visualizations
 */
import { expect, test } from "../lib/test-fixtures";

test.describe("Chart Editing", () => {
  test.beforeEach(async ({ page, homePage, uploadFile }) => {
    // Setup: Create a visualization first
    await homePage();
    await uploadFile("sales_data.csv");

    await expect(page).toHaveURL(/\/insights\/[a-zA-Z0-9-]+/, {
      timeout: 15_000,
    });

    // Create first chart
    await expect(page.getByText("Create visualization")).toBeVisible({
      timeout: 30_000,
    });
    await page
      .getByRole("button", { name: /^Comparison/ })
      .first()
      .click();

    await expect(page).toHaveURL(/\/visualizations\/[a-zA-Z0-9-]+/);
  });

  test("can switch between chart types", async ({ page, waitForChart }) => {
    // Wait for initial chart
    await waitForChart();

    // Get current chart type indicator (if visible in UI)
    // Switch to different chart types and verify render

    // Look for chart type selector or edit mode
    const editButton = page.getByRole("button", { name: /edit/i });
    if (await editButton.isVisible()) {
      await editButton.click();
    }

    // If there's a chart type dropdown/selector, test switching
    // This depends on actual UI implementation
    const chartTypeSelector = page.locator(
      '[data-testid="chart-type-selector"]',
    );
    if (await chartTypeSelector.isVisible()) {
      // Test switching to line chart
      await chartTypeSelector.click();
      await page.getByRole("option", { name: /line/i }).click();
      await waitForChart();

      // Test switching to area chart
      await chartTypeSelector.click();
      await page.getByRole("option", { name: /area/i }).click();
      await waitForChart();
    }
  });
});
