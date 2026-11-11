/**
 * Chart Editing Tests
 *
 * A chart on a report is edited in its own tab of that report: changing its
 * type edits the saved chart in place.
 */
import { buildCountChart, expectNewChartTab } from "../lib/chart-tab";
import { queryAll } from "../lib/native-api";
import { expect, test } from "../lib/test-fixtures";

const CHART_TAB = "Count by Product";

test.describe("Chart Editing", () => {
  test.beforeEach(async ({ page, homePage, uploadFile }) => {
    // Setup: a report holding one chart, open in its tab.
    await homePage();
    await uploadFile("sales_data.csv");
    await expectNewChartTab(page);
    await buildCountChart(page, "Product");
  });

  test("can switch between chart types", async ({ page, waitForChart }) => {
    await waitForChart();

    // The chart is category + metric, so only chart types compatible with
    // that result are offered. Switching bar orientation exercises the
    // persisted type and encoding swap in both directions.
    for (const chartType of ["Horizontal bar", "Bar"]) {
      const tile = page.getByRole("button", { name: chartType, exact: true });
      await tile.click();
      await expect(tile).toHaveAttribute("aria-pressed", "true");
      await waitForChart();
    }

    // Editing in place kept one saved chart.
    await expect
      .poll(
        async () => (await queryAll<unknown>("listVisualizations", {})).length,
      )
      .toBe(1);
  });

  test("deleting the chart takes its tile off the report and its unused insight with it", async ({
    page,
    waitForChart,
  }) => {
    await waitForChart();
    const tiles = async () =>
      (await queryAll<{ items: unknown[] }>("listDashboards", {})).flatMap(
        (report) => report.items,
      );
    await expect.poll(async () => (await tiles()).length).toBe(1);

    await page.getByRole("button", { name: "More chart actions" }).click();
    await page.getByRole("menuitem", { name: /Delete chart/ }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    await expect
      .poll(
        async () => (await queryAll<unknown>("listVisualizations", {})).length,
      )
      .toBe(0);
    // The client asked only for the chart and its insight; the server took
    // the tile off the report in the same commit.
    expect(await tiles()).toEqual([]);
    expect(await queryAll<unknown>("listInsights", {})).toEqual([]);
  });

  test("keeps the chart's tab and its edits across a reload", async ({
    page,
    waitForChart,
  }) => {
    await waitForChart();
    const horizontal = page.getByRole("button", {
      name: "Horizontal bar",
      exact: true,
    });
    await horizontal.click();
    await expect(horizontal).toHaveAttribute("aria-pressed", "true");

    // The report's tab and the chart's tab both survive a reload; the URL
    // names the one that is active.
    await page
      .getByRole("tab", { name: "Untitled report", exact: true })
      .click();
    await page.reload();
    const chartTab = page.getByRole("tab", { name: CHART_TAB, exact: true });
    await expect(chartTab).toBeVisible({ timeout: 15_000 });
    await chartTab.click();
    await expect(page).toHaveURL(/\?chart=/);

    await expect(
      page.getByRole("button", { name: "Horizontal bar", exact: true }),
    ).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    await waitForChart();
  });
});
