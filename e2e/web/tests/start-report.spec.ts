/**
 * Starting a chart from a data source
 *
 * A data source's "Start a report" asks which report the chart goes on, then
 * opens that report on a new chart of the table.
 */
import type { Page } from "@playwright/test";
import { buildCountChart, expectNewChartTab } from "../lib/chart-tab";
import { query } from "../lib/native-api";
import { expect, test } from "../lib/test-fixtures";

function reportId(page: Page): string {
  return new URL(page.url()).pathname.split("/")[2]!;
}

test.describe("Start a report from a data source", () => {
  let firstReportId: string;

  test.beforeEach(async ({ page, homePage, uploadFile }) => {
    // A first report with one chart, from an upload in its chart picker.
    await homePage();
    await uploadFile("sales_data.csv");
    await expectNewChartTab(page);
    await buildCountChart(page, "Product");
    firstReportId = reportId(page);

    await page.getByRole("link", { name: "Data Sources" }).click();
    await page.getByRole("link", { name: /Local Files/ }).click();
    await page.getByRole("button", { name: "Start a report" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("opens a new chart on a report the user picks", async ({ page }) => {
    await page
      .getByRole("dialog")
      // A report row is an ItemCard, which renders a button with role option.
      .getByRole("option", { name: /Untitled report/ })
      .click();

    await expectNewChartTab(page);
    expect(reportId(page)).toBe(firstReportId);
    // The table is already picked: its rows show.
    await expect(page.getByText(/5 rows/).first()).toBeVisible({
      timeout: 30_000,
    });
    expect(await query<unknown[]>("listDashboards", {})).toHaveLength(1);
  });

  test("opens a new chart on a new report", async ({ page }) => {
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "New report", exact: true })
      .click();

    await expectNewChartTab(page);
    expect(reportId(page)).not.toBe(firstReportId);
    expect(await query<unknown[]>("listDashboards", {})).toHaveLength(2);
  });
});
