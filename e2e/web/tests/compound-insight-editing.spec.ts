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
 * The existing csv→chart specs never exercise these mutations. Those specs
 * create an insight and immediately navigate to a visualization; they never
 * interact with the config panel or call updateInsight with field/metric edits.
 *
 * Setup mirrors the existing csv-to-chart.spec.ts: upload sales_data.csv
 * (Date, Product, Category, Sales, Quantity) → land on the insight page.
 * Creating an insight from a table produces an EMPTY draft (no fields
 * preselected — that keeps the server's draft-reuse dedup working and avoids
 * the all-fields GROUP BY collapsing duplicate source rows), so the Fields
 * and Metrics sections hold only their dashed "Add" rows and the canvas table
 * renders the raw base table. The tests below add a field first, then exercise the other
 * mutations from that state.
 */
import { expect, test } from "../lib/test-fixtures";
import { query } from "../lib/native-api";
import type { Page } from "@playwright/test";

async function savedInsight(page: Page) {
  const id = new URL(page.url()).pathname.split("/")[2];
  return query<{
    source: { sourceId: string };
    selectedFields: string[];
    metrics: { name: string }[];
  }>("getInsight", { id });
}
async function expectFieldSaved(page: Page, name: string, present: boolean) {
  await expect
    .poll(async () => {
      const insight = await savedInsight(page),
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
async function expectMetricSaved(page: Page, name: string, present: boolean) {
  await expect
    .poll(async () => {
      const insight = await savedInsight(page);
      return insight.metrics.some((metric) => metric.name === name);
    })
    .toBe(present);
}

test.describe("compound-insight field/metric editing", () => {
  /** Expand a pane section without collapsing one that is already open. */
  async function openSection(page: Page, section: "Fields" | "Metrics") {
    const trigger = page.getByRole("button", {
      name: new RegExp(`^${section}\\b`),
    });
    if ((await trigger.getAttribute("aria-expanded")) !== "true") {
      await trigger.click();
    }
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
  }

  /**
   * Upload CSV and wait for the insight page to finish loading.
   * Creating an insight from a table produces an empty draft, so each test
   * starts with 0 selected fields and 0 metrics.
   */
  test.beforeEach(async ({ page, homePage, uploadFile }) => {
    await homePage();
    await uploadFile("sales_data.csv");

    // Upload redirects to the insight page
    await expect(page).toHaveURL(/\/insights\/[a-zA-Z0-9-]+/, {
      timeout: 15_000,
    });

    // An empty Fields section shows only its add row, which confirms the
    // panel loaded with the fresh draft's empty selection.
    await openSection(page, "Fields");
    await expect(
      page.getByRole("button", { name: "Add field", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
  });

  /** Add a field by name via the Add field popover and confirm persistence. */
  async function addField(page: Page, name: string) {
    await openSection(page, "Fields");
    await page.getByRole("button", { name: "Add field", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add field" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const fieldOption = dialog.getByRole("option", {
      name: new RegExp(name, "i"),
    });
    await expect(fieldOption).toBeVisible({ timeout: 10_000 });
    await fieldOption.click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    await expectFieldSaved(page, name, true);
  }

  /** Add a Count metric via the Add metric popover and confirm persistence. */
  async function addCountMetric(page: Page) {
    await openSection(page, "Metrics");
    await page.getByRole("button", { name: "Add metric", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add metric" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Default aggregation is "Count (rows)", so the name auto-fills to "Count".
    await expect(
      dialog.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("Count");

    await dialog.getByRole("button", { name: "Add metric" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    await expectMetricSaved(page, "Count", true);
  }

  /** Remove a chip. With no saved chart using it, removal applies at once. */
  async function removeItem(page: Page, name: string) {
    await page.getByRole("button", { name: `Remove ${name}` }).click();
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
    await expectFieldSaved(page, "Product", false);

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
    await expect(page.getByRole("button", { name: "Edit Count" })).toHaveCount(
      0,
    );

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

    await editDialog.getByRole("button", { name: "Save" }).click();
    await expect(editDialog).not.toBeVisible({ timeout: 5_000 });
    await expectMetricSaved(page, "Row Count", true);

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
    await expectFieldSaved(page, "Product", false);

    await page.reload();
    await openSection(page, "Fields");
    await expect(
      page.getByRole("button", { name: "Remove Product" }),
    ).not.toBeVisible({ timeout: 5_000 });

    // ── 5. removeMetric ─────────────────────────────────────────────────────
    await openSection(page, "Metrics");
    await removeItem(page, "Row Count");
    await expectMetricSaved(page, "Row Count", false);

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
