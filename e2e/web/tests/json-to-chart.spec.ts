/**
 * JSON to Chart Workflow
 *
 * Core user journey: upload a JSON file on the home page -> a new report
 * opens on a new chart of the file's table -> a field and a metric place the
 * chart on the report.
 */
import { buildCountChart, expectNewChartTab } from "../lib/chart-tab";
import { expect, test } from "../lib/test-fixtures";

test.describe("JSON to Chart", () => {
  test("upload JSON and build a chart on a new report", async ({
    page,
    homePage,
    uploadFile,
    waitForChart,
  }) => {
    await homePage();
    await uploadFile("users_data.json");

    await expectNewChartTab(page);
    await buildCountChart(page, "department");
    await waitForChart();
  });

  test("shows correct row count for JSON", async ({
    page,
    homePage,
    uploadFile,
  }) => {
    await homePage();
    await uploadFile("users_data.json");
    await expectNewChartTab(page);

    // users_data.json has 5 records
    await expect(page.getByText(/5 rows/).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
