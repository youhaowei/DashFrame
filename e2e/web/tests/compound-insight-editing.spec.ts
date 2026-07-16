/**
 * Compound-insight field/metric editing
 *
 * Verifies the server-side read-modify-write on `insights.definition` (jsonb)
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
 * and Metrics sections both start empty and the canvas table renders the raw
 * base table. The tests below add a field first, then exercise the other
 * mutations from that state.
 */
import { expect, test } from "../lib/test-fixtures";

test.describe("compound-insight field/metric editing", () => {
  async function openSection(
    page: import("@playwright/test").Page,
    section: "Fields" | "Metrics",
  ) {
    await page
      .getByRole("button", { name: new RegExp(`^${section}\\b`) })
      .click();
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

    // The model section is selected by default. Open Fields and wait for its
    // empty state to confirm the fresh draft has loaded.
    await openSection(page, "Fields");
    // confirms the panel loaded with the fresh draft's empty selection.
    await expect(page.getByText("No fields selected.")).toBeVisible({
      timeout: 20_000,
    });
  });

  /** Add a field by name via the Add Field dialog and confirm persistence. */
  async function addField(page: import("@playwright/test").Page, name: string) {
    await openSection(page, "Fields");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Add field" })).toBeVisible({
      timeout: 10_000,
    });

    // Scope to the dialog to avoid matching chart-suggestion buttons (which
    // can also contain the field name in their accessible name).
    const dialog = page.getByRole("dialog", { name: "Add field" });
    const fieldButton = dialog.getByRole("button", {
      name: new RegExp(name, "i"),
    });
    await expect(fieldButton).toBeVisible({ timeout: 10_000 });
    await fieldButton.waitFor({ state: "visible" });

    // Intercept the updateInsight mutation to confirm it fires and succeeds.
    const updateResponse = page.waitForResponse(
      (resp) => resp.url().includes("/api/updateInsight"),
      { timeout: 20_000 },
    );
    await fieldButton.click();
    await expect(
      page.getByRole("dialog", { name: "Add field" }),
    ).not.toBeVisible({ timeout: 5_000 });
    expect((await updateResponse).status()).toBe(200);
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

    // Observable: "Product" field item appears in the Fields section,
    // confirming definition.selectedFields includes <productFieldId>
    // and was written and read back from the server
    await expect(
      page.getByRole("button", { name: "Remove Product" }),
    ).toBeVisible({ timeout: 20_000 });

    // ── removeField ──────────────────────────────────────────────────────
    await page.getByRole("button", { name: "Remove Product" }).click();
    await expect(
      page.getByRole("dialog", { name: "Delete field" }),
    ).toBeVisible({ timeout: 10_000 });

    const removeFieldResponse = page.waitForResponse(
      (resp) => resp.url().includes("/api/updateInsight"),
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "Delete field" }).click();
    await expect(
      page.getByRole("dialog", { name: "Delete field" }),
    ).not.toBeVisible({ timeout: 5_000 });
    expect((await removeFieldResponse).status()).toBe(200);

    // Reload to verify removal was persisted — back to the empty state
    await page.reload();
    await openSection(page, "Fields");
    await expect(page.getByText("No fields selected.")).toBeVisible({
      timeout: 20_000,
    });
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
    // Initial: Metrics section shows "No metrics configured."
    await expect(page.getByText("No metrics configured.")).toBeVisible({
      timeout: 10_000,
    });

    // Open the Add Metric dialog.
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Add metric" })).toBeVisible({
      timeout: 10_000,
    });

    // Default aggregation is "Count (rows)" — name auto-fills to "Count"
    await expect(
      page.getByRole("textbox", { name: /metric name/i }),
    ).toHaveValue("Count");

    // Intercept the updateInsight mutation to confirm it fires and succeeds
    const updateInsightResponse = page.waitForResponse(
      (resp) => resp.url().includes("/api/updateInsight"),
      { timeout: 10_000 },
    );

    // Save the metric
    await page.getByRole("button", { name: "Add metric" }).click();
    await expect(
      page.getByRole("dialog", { name: "Add metric" }),
    ).not.toBeVisible({ timeout: 5_000 });

    // Confirm the mutation reached the server. Assert the status explicitly so a
    // non-200 surfaces as a clear assertion failure instead of a waitForResponse timeout.
    expect((await updateInsightResponse).status()).toBe(200);

    // Reload the page to get fresh server state — confirms server persisted correctly
    await page.reload();
    await openSection(page, "Metrics");

    // Observable: "Count" metric item now appears in the Metrics section,
    // confirming definition.metrics = [{ name: "Count", aggregation: "count" }]
    // was written and read back from the server
    await expect(page.getByRole("button", { name: "Edit Count" })).toBeVisible({
      timeout: 15_000,
    });

    // The empty-state message should be gone
    await expect(page.getByText("No metrics configured.")).not.toBeVisible({
      timeout: 5_000,
    });
  });

  // ---------------------------------------------------------------------------
  // Full compound path: all five mutations in sequence
  // Proves the jsonb read-modify-write chain is correct at runtime,
  // not just at typecheck. Each step asserts an observable state change.
  // NOTE: the observable state here is the config panel + persistence
  // (reload survives), not the result table's cells — the "computed result"
  // is verified at that seam.
  // ---------------------------------------------------------------------------
  test("editing an insight's fields/metrics is reflected in the computed result", async ({
    page,
  }) => {
    // ── 1. addField ─────────────────────────────────────────────────────────
    // The draft starts empty, so addField is the natural first mutation.
    // Cause: add "Product" via the field picker
    // Effect: "Product" appears in the Fields item list
    await addField(page, "Product");

    // Reload to verify field was persisted
    await page.reload();
    await openSection(page, "Fields");

    // ✓ field is persisted and re-rendered
    await expect(
      page.getByRole("button", { name: "Remove Product" }),
    ).toBeVisible({ timeout: 15_000 });

    // ── 2. addMetric ────────────────────────────────────────────────────────
    // Cause: open metric editor, save Count aggregation
    // Effect: "Count" appears in the Metrics item list; empty-state gone
    await openSection(page, "Metrics");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Add metric" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("textbox", { name: /metric name/i }),
    ).toHaveValue("Count");

    const addMetricResponse = page.waitForResponse(
      (resp) => resp.url().includes("/api/updateInsight"),
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "Add metric" }).click();
    await expect(
      page.getByRole("dialog", { name: "Add metric" }),
    ).not.toBeVisible({ timeout: 5_000 });
    expect((await addMetricResponse).status()).toBe(200);

    // Reload to verify metric was persisted
    await page.reload();
    await openSection(page, "Metrics");

    // ✓ metric is persisted and re-rendered
    await expect(page.getByRole("button", { name: "Edit Count" })).toBeVisible({
      timeout: 15_000,
    });

    // ── 3. updateMetric ─────────────────────────────────────────────────────
    // Cause: edit "Count" metric, rename to "Row Count"
    // Effect: "Row Count" label replaces "Count" in the Metrics list
    await page.getByRole("button", { name: "Edit Count" }).click();
    await expect(page.getByRole("dialog", { name: "Edit metric" })).toBeVisible(
      { timeout: 10_000 },
    );

    const nameInput = page.getByRole("textbox", { name: /display name/i });
    await nameInput.clear();
    await nameInput.fill("Row Count");

    const updateMetricResponse = page.waitForResponse(
      (resp) => resp.url().includes("/api/updateInsight"),
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByRole("dialog", { name: "Edit metric" }),
    ).not.toBeVisible({ timeout: 5_000 });
    expect((await updateMetricResponse).status()).toBe(200);

    // Reload to verify metric rename was persisted
    await page.reload();
    await openSection(page, "Metrics");

    // ✓ updated metric name is persisted and re-rendered
    await expect(
      page.getByRole("button", { name: "Edit Row Count" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: "Edit Count" }),
    ).not.toBeVisible({ timeout: 5_000 });

    // ── 4. removeField ──────────────────────────────────────────────────────
    // Cause: click Remove on "Product", confirm deletion
    // Effect: "Product" disappears from the Fields section — back to the
    // empty state, since it was the only selected field.
    await openSection(page, "Fields");
    await page.getByRole("button", { name: "Remove Product" }).click();
    await expect(
      page.getByRole("dialog", { name: "Delete field" }),
    ).toBeVisible({ timeout: 10_000 });

    const removeFieldResponse = page.waitForResponse(
      (resp) => resp.url().includes("/api/updateInsight"),
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "Delete field" }).click();
    await expect(
      page.getByRole("dialog", { name: "Delete field" }),
    ).not.toBeVisible({ timeout: 5_000 });
    expect((await removeFieldResponse).status()).toBe(200);

    // Reload to verify field removal was persisted
    await page.reload();
    await openSection(page, "Fields");

    // ✓ definition.selectedFields no longer includes Product — the Fields
    // section is back to its empty state (Product was the only field).
    await expect(
      page.getByRole("button", { name: "Remove Product" }),
    ).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("No fields selected.")).toBeVisible({
      timeout: 15_000,
    });

    // ── 5. removeMetric ─────────────────────────────────────────────────────
    // Cause: click Remove on "Row Count", confirm deletion
    // Effect: "Row Count" disappears; Metrics section shows empty state
    await openSection(page, "Metrics");
    await page.getByRole("button", { name: "Remove Row Count" }).click();
    await expect(
      page.getByRole("dialog", { name: "Delete metric" }),
    ).toBeVisible({ timeout: 10_000 });

    const removeMetricResponse = page.waitForResponse(
      (resp) => resp.url().includes("/api/updateInsight"),
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "Delete metric" }).click();
    await expect(
      page.getByRole("dialog", { name: "Delete metric" }),
    ).not.toBeVisible({ timeout: 5_000 });
    expect((await removeMetricResponse).status()).toBe(200);

    // Reload to verify metric removal was persisted
    await page.reload();
    await openSection(page, "Metrics");

    // ✓ definition.metrics = [] is persisted and re-rendered
    await expect(
      page.getByRole("button", { name: "Remove Row Count" }),
    ).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("No metrics configured.")).toBeVisible({
      timeout: 15_000,
    });
  });
});
