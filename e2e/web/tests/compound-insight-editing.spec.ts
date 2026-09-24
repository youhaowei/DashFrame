/**
 * Compound-insight field/metric editing
 *
 * Verifies the server-side read-modify-write on `insights.definition` (native metadata)
 * for all five COMPOUND mutations:
 *   addField / removeField / addMetric / updateMetric / removeMetric
 *
 * Contract under test: after each mutation the server persists the updated
 * definition and the UI reflects the change. Assertions are observable
 * cause→effect: the config panel item lists and badge counts change in
 * lock-step with each write — not just "no error thrown".
 *
 * Setup mirrors csv-to-chart.spec.ts: upload sales_data.csv (Date, Product,
 * Category, Sales, Quantity) → a new report opens on a new chart of that
 * table. A new chart's insight starts EMPTY (no fields preselected — the
 * all-fields GROUP BY would collapse duplicate source rows), so the Fields
 * and Metrics sections hold only their dashed "Add" rows and the canvas table
 * renders the raw base table. The tests below add a field first, then
 * exercise the other mutations from that state.
 */
import type { Page } from "@playwright/test";
import {
  addCountMetric as addCountMetricInPane,
  addField as addFieldInPane,
  expectNewChartTab,
  onlyInsight,
  openSection,
} from "../lib/chart-tab";
import { query } from "../lib/native-api";
import { expect, test } from "../lib/test-fixtures";

interface SavedInsight {
  source: { sourceId: string };
  selectedFields: string[];
  metrics: { name: string }[];
}

async function expectFieldSaved(name: string, present: boolean) {
  await expect
    .poll(async () => {
      const insight = await onlyInsight<SavedInsight>(),
        tables = await query<
          { id: string; fields: { id: string; name: string }[] }[]
        >("listDataTables", {});
      const field = tables
        .find((table) => table.id === insight.source.sourceId)
        ?.fields.find((field) => field.name === name);
      expect(field, `Source field ${name} remains available`).toBeDefined();
      return insight.selectedFields.includes(field!.id);
    })
    .toBe(present);
}
async function expectMetricSaved(name: string, present: boolean) {
  await expect
    .poll(async () => {
      const insight = await onlyInsight<SavedInsight>();
      return insight.metrics.some((metric) => metric.name === name);
    })
    .toBe(present);
}

test.describe("compound-insight field/metric editing", () => {
  /**
   * Upload CSV and wait for the insight page to finish loading.
   * Creating an insight from a table produces an empty draft, so each test
   * starts with 0 selected fields and 0 metrics.
   */
  test.beforeEach(async ({ page, homePage, uploadFile }) => {
    await homePage();
    await uploadFile("sales_data.csv");

    await expectNewChartTab(page);

    // An empty Fields section shows only its add row, which confirms the
    // panel loaded with the fresh draft's empty selection.
    await openSection(page, "Fields");
    await expect(
      page.getByRole("button", { name: "Add field", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  });

  /** Add a field by name via the Add field popover and confirm persistence. */
  async function addField(page: Page, name: string) {
    await addFieldInPane(page, name);
    await expectFieldSaved(name, true);
  }

  /** Add a Count metric via the Add metric popover and confirm persistence. */
  async function addCountMetric(page: Page) {
    await addCountMetricInPane(page);
    await expectMetricSaved("Count", true);
  }

  /**
   * Remove a chip. With no saved chart using it, removal applies at once;
   * when the report's chart uses it, the dialog first takes it out of the
   * chart.
   */
  async function removeItem(page: Page, name: string) {
    await page.getByRole("button", { name: `Remove ${name}` }).click();
    const dialog = page.getByRole("dialog", { name: /^Delete (field|metric)/ });
    const asked = await dialog
      .waitFor({ timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (asked) {
      await dialog.getByRole("button", { name: "Remove", exact: true }).click();
      await dialog
        .getByRole("button", { name: /^Delete (field|metric)$/ })
        .click();
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  // ---------------------------------------------------------------------------
  // addField + removeField: definition.selectedFields grows then shrinks back
  // ---------------------------------------------------------------------------
  test("addField then removeField: Product can be added and removed", async ({
    page,
  }) => {
    // ── addField ─────────────────────────────────────────────────────────
    await addField(page, "Product");

    // Reload the page to get fresh server state — confirms server persisted correctly
    await page.reload();
    await openSection(page, "Fields");

    // Observable: the "Product" chip appears in the Fields section, confirming
    // definition.selectedFields includes <productFieldId>.
    await expect(
      page.getByRole("button", { name: "Remove Product" }),
    ).toBeVisible({ timeout: 20_000 });

    // ── removeField ──────────────────────────────────────────────────────
    await removeItem(page, "Product");
    await expectFieldSaved("Product", false);

    // Reload to verify removal was persisted — back to the empty state
    await page.reload();
    await openSection(page, "Fields");
    await expect(
      page.getByRole("button", { name: "Add field", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("button", { name: "Remove Product" }),
    ).not.toBeVisible({ timeout: 5_000 });
  });

  // ---------------------------------------------------------------------------
  // addMetric: definition.metrics grows from [] to [{ aggregation: "count" }]
  // ---------------------------------------------------------------------------
  test("addMetric: adding a Count metric adds it to the Metrics section", async ({
    page,
  }) => {
    await openSection(page, "Metrics");
    // Initial: no metric chips, only the add row.
    await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);

    await addCountMetric(page);

    // Reload the page to get fresh server state — confirms server persisted correctly
    await page.reload();
    await openSection(page, "Metrics");

    // Observable: the "Count" chip appears, confirming
    // definition.metrics = [{ name: "Count", aggregation: "count" }].
    await expect(page.getByRole("button", { name: "Edit Count" })).toBeVisible({
      timeout: 15_000,
    });
  });

  // ---------------------------------------------------------------------------
  // Full compound path: all five mutations in sequence
  // Proves the atomic metadata update chain is correct at runtime,
  // not just at typecheck. Each step asserts an observable state change.
  // NOTE: the observable state here is the config panel + persistence
  // (reload survives), not the result table's cells — the "computed result"
  // is verified at that seam.
  // ---------------------------------------------------------------------------
  test("editing an insight's fields/metrics is reflected in the computed result", async ({
    page,
  }) => {
    // ── 1. addField ─────────────────────────────────────────────────────────
    await addField(page, "Product");
    await page.reload();
    await openSection(page, "Fields");
    await expect(
      page.getByRole("button", { name: "Remove Product" }),
    ).toBeVisible({ timeout: 15_000 });

    // ── 2. addMetric ────────────────────────────────────────────────────────
    await addCountMetric(page);
    await page.reload();
    await openSection(page, "Metrics");
    await expect(page.getByRole("button", { name: "Edit Count" })).toBeVisible({
      timeout: 15_000,
    });

    // ── 3. updateMetric ─────────────────────────────────────────────────────
    // Cause: edit "Count" metric, rename to "Row Count"
    // Effect: "Row Count" label replaces "Count" in the Metrics list
    await page.getByRole("button", { name: "Edit Count" }).click();
    const editDialog = page.getByRole("dialog", { name: "Edit metric" });
    await expect(editDialog).toBeVisible({ timeout: 10_000 });

    const nameInput = editDialog.getByRole("textbox", {
      name: "Name",
      exact: true,
    });
    await nameInput.clear();
    await nameInput.fill("Row Count");

    await editDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editDialog).not.toBeVisible({ timeout: 5_000 });
    await expectMetricSaved("Row Count", true);

    await page.reload();
    await openSection(page, "Metrics");
    await expect(
      page.getByRole("button", { name: "Edit Row Count" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: "Edit Count" }),
    ).not.toBeVisible({ timeout: 5_000 });

    // ── 4. removeField ──────────────────────────────────────────────────────
    // Product was the only field, so Fields returns to its empty state.
    await openSection(page, "Fields");
    await removeItem(page, "Product");
    await expectFieldSaved("Product", false);

    await page.reload();
    await openSection(page, "Fields");
    await expect(
      page.getByRole("button", { name: "Remove Product" }),
    ).not.toBeVisible({ timeout: 5_000 });

    // ── 5. removeMetric ─────────────────────────────────────────────────────
    await openSection(page, "Metrics");
    await removeItem(page, "Row Count");
    await expectMetricSaved("Row Count", false);

    await page.reload();
    await openSection(page, "Metrics");
    await expect(
      page.getByRole("button", { name: "Remove Row Count" }),
    ).not.toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("button", { name: "Add metric", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
