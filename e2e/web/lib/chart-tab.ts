/**
 * Helpers for a report's chart tab: where a chart is built and edited.
 *
 * Starting a chart from data (a data source or a report's chart picker)
 * opens a report on a new chart tab, `/dashboards/<report>?chart=<tab>`. The
 * chart stays a draft until it has a field and a metric; then it lands on
 * the report as a tile and its tab takes the chart's name.
 */
import { expect, type Page } from "@playwright/test";
import { query } from "./native-api";

/** The report opened on a new chart tab, showing the picked table's rows. */
export async function expectNewChartTab(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/dashboards\/[a-zA-Z0-9-]+\?chart=[\w-]+/, {
    timeout: 15_000,
  });
  await expect(
    page.getByRole("tab", { name: "Untitled chart", exact: true }),
  ).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
}

/** Expand a pane section without collapsing one that is already open. */
export async function openSection(
  page: Page,
  section: "Fields" | "Metrics",
): Promise<void> {
  const trigger = page.getByRole("button", {
    name: new RegExp(`^${section}\\b`),
  });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

/**
 * Open a pane popover. The pane re-renders as each edit saves, and a click
 * that lands mid-render can miss, so retry until the popover is open.
 */
async function openPopover(page: Page, name: "Add field" | "Add metric") {
  const dialog = page.getByRole("dialog", { name });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await page.getByRole("button", { name, exact: true }).click();
    }
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  return dialog;
}

/** Add a field by name from the Add field popover. */
export async function addField(page: Page, name: string): Promise<void> {
  await openSection(page, "Fields");
  const dialog = await openPopover(page, "Add field");
  const option = dialog.getByRole("option", { name: new RegExp(name, "i") });
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
}

/** Add a Count metric, the Add metric popover's default. */
export async function addCountMetric(page: Page): Promise<void> {
  await openSection(page, "Metrics");
  const dialog = await openPopover(page, "Add metric");
  // The default aggregation counts rows, so the name fills in as "Count".
  await expect(
    dialog.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Count");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
}

/**
 * Give a new chart a field and a Count metric, and wait for it to land on
 * the report: its tab takes the chart's name.
 */
export async function buildCountChart(
  page: Page,
  field: string,
): Promise<void> {
  await addField(page, field);
  await addCountMetric(page);
  await expect(
    page.getByRole("tab", { name: `Count by ${field}`, exact: true }),
  ).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
}

/** The project's only insight: the one the chart tab edits. */
export async function onlyInsight<T>(): Promise<T> {
  const insights = await query<T[]>("listInsights", {});
  expect(insights).toHaveLength(1);
  return insights[0]!;
}
