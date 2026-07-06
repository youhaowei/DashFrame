/**
 * Chart Editing Tests
 *
 * Tests for switching chart views and pinning visualizations
 */
import { expect, test } from "../lib/test-fixtures";

test.describe("Chart Editing", () => {
  test.beforeEach(async ({ page, homePage, uploadFile }) => {
    // Setup: Create an insight first
    await homePage();
    await uploadFile("sales_data.csv");

    await expect(page).toHaveURL(/\/insights\/[a-zA-Z0-9-]+/, {
      timeout: 15_000,
    });

    // Start from the table-first canvas and pin one chart view.
    await expect(page.getByRole("button", { name: "Table" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Bar" }).click();
    await page.getByRole("button", { name: "Pin view" }).click();
    await expect(page).toHaveURL(/\/insights\/[a-zA-Z0-9-]+/);
  });

  test("can switch between chart types", async ({ page, waitForChart }) => {
    // Wait for initial pinned chart.
    await waitForChart();

    await page.getByRole("button", { name: "Table" }).click();
    await expect(page.getByText(/5 rows/).first()).toBeVisible();

    await page.getByRole("button", { name: "Line" }).click();
    await expect(page.getByRole("button", { name: "Pin view" })).toBeVisible();
    await waitForChart();

    await page.getByRole("button", { name: "Area" }).click();
    await expect(page.getByRole("button", { name: "Pin view" })).toBeVisible();
    await waitForChart();
  });
});
