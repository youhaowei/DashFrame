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

    // Start from the data canvas and save one chart view.
    // `exact: true` disambiguates against the view switcher's other buttons —
    // "Horizontal bar" and "Hide sidebar" both contain "bar" as a substring,
    // which Playwright's default (non-exact) name matching would also match.
    await expect(
      page.getByRole("button", { name: "Data", exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Visualize" }).click();
    await page.getByRole("button", { name: "Bar", exact: true }).click();
    // "Save chart" appears once chart suggestions are computed (DuckDB init +
    // column analysis run after the table loads), so allow a generous wait.
    await expect(page.getByRole("button", { name: "Save chart" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Save chart" }).click();
    // The preview already renders before save completes. Wait for the saved
    // state so a later Data click cannot race the save callback selecting it.
    await expect(
      page.getByText("Saved chart — reusable in dashboards"),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/insights\/[a-zA-Z0-9-]+/);
  });

  test("can switch between chart types", async ({ page, waitForChart }) => {
    // Wait for initial pinned chart.
    await waitForChart();

    // Saving wrote the chart's config (Product + sum(Quantity)) into the
    // insight, so the table view now runs query mode: 4 distinct products
    // grouped from the 5 source rows, dimension + metric = 2 fields.
    await page.getByRole("button", { name: "Data", exact: true }).click();
    await expect(page.getByText("4 rows • 2 fields")).toBeVisible();

    // Each unsaved chart view renders and offers "Save chart"; switching views
    // does NOT mint a new Visualization (only saving does).
    await page.getByRole("button", { name: "Visualize" }).click();
    await page.getByRole("button", { name: "Line", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Save chart" }),
    ).toBeVisible();
    await waitForChart();

    await page.getByRole("button", { name: "Area", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Save chart" }),
    ).toBeVisible();
    await waitForChart();
  });
});
