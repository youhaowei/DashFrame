/**
 * CSV to Chart Workflow
 *
 * Core user journey: upload a CSV on the home page -> a new report opens on a
 * new chart of the file's table -> a field and a metric place the chart on
 * the report.
 */
import { expectNewChartTab, buildCountChart } from "../lib/chart-tab";
import { expect, test } from "../lib/test-fixtures";

test.describe("CSV to Chart", () => {
  test("upload CSV and build a chart on a new report", async ({
    page,
    homePage,
    uploadFile,
    waitForChart,
  }) => {
    await homePage();
    await uploadFile("sales_data.csv");

    // The new chart starts from the uploaded table's rows.
    await expectNewChartTab(page);
    await expect(page.getByText(/5 rows/).first()).toBeVisible({
      timeout: 30_000,
    });

    await buildCountChart(page, "Product");
    await waitForChart();
    // Encodings name the field, never its raw column alias.
    await expect(page.getByText(/field_[0-9a-f]{8}/)).toHaveCount(0);

    // The chart is a tile of the new report now.
    await page
      .getByRole("tab", { name: "Untitled report", exact: true })
      .click();
    await expect(page).toHaveURL(/\/dashboards\/[a-zA-Z0-9-]+$/);
    await waitForChart();
  });

  test("shows correct row count after upload", async ({
    page,
    homePage,
    uploadFile,
  }) => {
    await homePage();
    await uploadFile("sales_data.csv");
    await expectNewChartTab(page);

    // sales_data.csv has 5 rows
    await expect(page.getByText(/5 rows/).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("shows expected columns", async ({ page, homePage, uploadFile }) => {
    await homePage();
    await uploadFile("sales_data.csv");
    await expectNewChartTab(page);

    // Verify column headers (rendered as sortable buttons)
    const expectedColumns = [
      "Date",
      "Product",
      "Category",
      "Sales",
      "Quantity",
    ];
    for (const column of expectedColumns) {
      await expect(
        page.getByRole("button", { name: `Sort by ${column}` }),
      ).toBeVisible({ timeout: 10_000 });
    }
  });
});
