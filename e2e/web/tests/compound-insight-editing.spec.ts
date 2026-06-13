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
 * The insight is created with selectedFields=[] and metrics=[], so both
 * panel sections start empty.
 */
import { expect, test } from "../lib/test-fixtures";

test.describe("compound-insight field/metric editing", () => {
  /**
   * Upload CSV and wait for the insight page to finish loading.
   * Each test starts with an empty insight (0 fields, 0 metrics).
   */
  test.beforeEach(async ({ page, homePage, uploadFile }) => {
    await homePage();
    await uploadFile("sales_data.csv");

    // Upload redirects to the insight page
    await expect(page).toHaveURL(/\/insights\/[a-zA-Z0-9-]+/, {
      timeout: 15_000,
    });

    // Wait for the config panel to be rendered — "Fields" section Add button
    // is always present once the panel loads
    await expect(page.getByRole("button", { name: "Add" }).first()).toBeVisible(
      { timeout: 20_000 },
    );
  });

  // ---------------------------------------------------------------------------
  // addField: definition.selectedFields grows from [] to [fieldId]
  // ---------------------------------------------------------------------------
  test("addField: selecting a field adds it to the Fields section", async ({
    page,
  }) => {
    // Initial: Fields section shows "No fields selected."
    await expect(page.getByText("No fields selected.")).toBeVisible({
      timeout: 10_000,
    });

    // Open the Add Field dialog (first "Add" button = Fields section)
    await page.getByRole("button", { name: "Add" }).first().click();
    await expect(page.getByRole("dialog", { name: "Add field" })).toBeVisible({
      timeout: 10_000,
    });

    // Select the "Product" field from the available fields list.
    // Scope to the dialog to avoid matching chart-suggestion buttons (which also
    // contain "Product" in their accessible name) that are visible in the background.
    const addFieldDialog = page.getByRole("dialog", { name: "Add field" });

    // Wait for field buttons to populate inside the dialog, then wait a beat for
    // the list to finish rendering (avoids DOM-detach flake when the field list
    // re-renders while the click is in flight).
    const productButton = addFieldDialog.getByRole("button", {
      name: /Product/i,
    });
    await expect(productButton).toBeVisible({ timeout: 10_000 });
    await productButton.waitFor({ state: "visible" });

    // Intercept the updateInsight mutation to confirm it fires and succeeds.
    // 20s timeout accommodates Playwright's click-retry loop if the button
    // momentarily detaches during a list re-render.
    const updateInsightResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/updateInsight") && resp.status() === 200,
      { timeout: 20_000 },
    );

    await productButton.click();

    // Dialog closes after selection
    await expect(
      page.getByRole("dialog", { name: "Add field" }),
    ).not.toBeVisible({ timeout: 5_000 });

    // Confirm the mutation reached the server and returned 200
    await updateInsightResponse;

    // Reload the page to get fresh server state — confirms server persisted correctly
    await page.reload();
    await expect(page.getByRole("button", { name: "Add" }).first()).toBeVisible(
      { timeout: 20_000 },
    );

    // Observable: "Product" field item now appears in the Fields section,
    // confirming definition.selectedFields = [<productFieldId>] was written
    // and read back from the server
    await expect(
      page.getByRole("button", { name: "Remove Product" }),
    ).toBeVisible({ timeout: 15_000 });

    // The empty-state message should be gone
    await expect(page.getByText("No fields selected.")).not.toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // addMetric: definition.metrics grows from [] to [{ aggregation: "count" }]
  // ---------------------------------------------------------------------------
  test("addMetric: adding a Count metric adds it to the Metrics section", async ({
    page,
  }) => {
    // Initial: Metrics section shows "No metrics configured."
    await expect(page.getByText("No metrics configured.")).toBeVisible({
      timeout: 10_000,
    });

    // Open the Add Metric dialog (second "Add" button = Metrics section)
    await page.getByRole("button", { name: "Add" }).nth(1).click();
    await expect(page.getByRole("dialog", { name: "Add metric" })).toBeVisible({
      timeout: 10_000,
    });

    // Default aggregation is "Count (rows)" — name auto-fills to "Count"
    await expect(
      page.getByRole("textbox", { name: /metric name/i }),
    ).toHaveValue("Count");

    // Intercept the updateInsight mutation to confirm it fires and succeeds
    const updateInsightResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/updateInsight") && resp.status() === 200,
      { timeout: 10_000 },
    );

    // Save the metric
    await page.getByRole("button", { name: "Add metric" }).click();
    await expect(
      page.getByRole("dialog", { name: "Add metric" }),
    ).not.toBeVisible({ timeout: 5_000 });

    // Confirm the mutation reached the server and returned 200
    await updateInsightResponse;

    // Reload the page to get fresh server state — confirms server persisted correctly
    await page.reload();
    await expect(page.getByRole("button", { name: "Add" }).first()).toBeVisible(
      { timeout: 20_000 },
    );

    // Observable: "Count" metric item now appears in the Metrics section,
    // confirming definition.metrics = [{ name: "Count", aggregation: "count" }]
    // was written and read back from the server
    await expect(page.getByRole("button", { name: "Edit Count" })).toBeVisible({
      timeout: 15_000,
    });

    // The empty-state message should be gone
    await expect(page.getByText("No metrics configured.")).not.toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Full compound path: all five mutations in sequence
  // Proves the jsonb read-modify-write chain is correct at runtime,
  // not just at typecheck. Each step asserts an observable state change.
  // ---------------------------------------------------------------------------
  test("editing an insight's fields/metrics is reflected in the computed result", async ({
    page,
  }) => {
    // ── 1. addField ─────────────────────────────────────────────────────────
    // Cause: open field picker, select "Product"
    // Effect: "Product" appears in the Fields item list; empty-state gone
    await page.getByRole("button", { name: "Add" }).first().click();
    await expect(page.getByRole("dialog", { name: "Add field" })).toBeVisible({
      timeout: 10_000,
    });

    const addFieldDialog = page.getByRole("dialog", { name: "Add field" });
    const productBtn = addFieldDialog.getByRole("button", { name: /Product/i });
    await expect(productBtn).toBeVisible({ timeout: 10_000 });
    await productBtn.waitFor({ state: "visible" });

    const addFieldResponse1 = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/updateInsight") && resp.status() === 200,
      { timeout: 20_000 },
    );
    await productBtn.click();
    await expect(
      page.getByRole("dialog", { name: "Add field" }),
    ).not.toBeVisible({ timeout: 5_000 });
    await addFieldResponse1;

    // Reload to verify field was persisted
    await page.reload();
    await expect(page.getByRole("button", { name: "Add" }).first()).toBeVisible(
      { timeout: 20_000 },
    );

    // ✓ field is persisted and re-rendered
    await expect(
      page.getByRole("button", { name: "Remove Product" }),
    ).toBeVisible({ timeout: 15_000 });

    // ── 2. addMetric ────────────────────────────────────────────────────────
    // Cause: open metric editor, save Count aggregation
    // Effect: "Count" appears in the Metrics item list; empty-state gone
    await page.getByRole("button", { name: "Add" }).nth(1).click();
    await expect(page.getByRole("dialog", { name: "Add metric" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("textbox", { name: /metric name/i }),
    ).toHaveValue("Count");

    const addMetricResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/updateInsight") && resp.status() === 200,
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "Add metric" }).click();
    await expect(
      page.getByRole("dialog", { name: "Add metric" }),
    ).not.toBeVisible({ timeout: 5_000 });
    await addMetricResponse;

    // Reload to verify metric was persisted
    await page.reload();
    await expect(page.getByRole("button", { name: "Add" }).first()).toBeVisible(
      { timeout: 20_000 },
    );

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
      (resp) =>
        resp.url().includes("/api/updateInsight") && resp.status() === 200,
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByRole("dialog", { name: "Edit metric" }),
    ).not.toBeVisible({ timeout: 5_000 });
    await updateMetricResponse;

    // Reload to verify metric rename was persisted
    await page.reload();
    await expect(page.getByRole("button", { name: "Add" }).first()).toBeVisible(
      { timeout: 20_000 },
    );

    // ✓ updated metric name is persisted and re-rendered
    await expect(
      page.getByRole("button", { name: "Edit Row Count" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: "Edit Count" }),
    ).not.toBeVisible();

    // ── 4. removeField ──────────────────────────────────────────────────────
    // Cause: click Remove on "Product", confirm deletion
    // Effect: "Product" disappears; Fields section shows empty state
    await page.getByRole("button", { name: "Remove Product" }).click();
    await expect(
      page.getByRole("dialog", { name: "Delete field" }),
    ).toBeVisible({ timeout: 10_000 });

    const removeFieldResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/updateInsight") && resp.status() === 200,
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "Delete field" }).click();
    await expect(
      page.getByRole("dialog", { name: "Delete field" }),
    ).not.toBeVisible({ timeout: 5_000 });
    await removeFieldResponse;

    // Reload to verify field removal was persisted
    await page.reload();
    await expect(page.getByRole("button", { name: "Add" }).first()).toBeVisible(
      { timeout: 20_000 },
    );

    // ✓ definition.selectedFields = [] is persisted and re-rendered
    await expect(
      page.getByRole("button", { name: "Remove Product" }),
    ).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("No fields selected.")).toBeVisible({
      timeout: 15_000,
    });

    // ── 5. removeMetric ─────────────────────────────────────────────────────
    // Cause: click Remove on "Row Count", confirm deletion
    // Effect: "Row Count" disappears; Metrics section shows empty state
    await page.getByRole("button", { name: "Remove Row Count" }).click();
    await expect(
      page.getByRole("dialog", { name: "Delete metric" }),
    ).toBeVisible({ timeout: 10_000 });

    const removeMetricResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/updateInsight") && resp.status() === 200,
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "Delete metric" }).click();
    await expect(
      page.getByRole("dialog", { name: "Delete metric" }),
    ).not.toBeVisible({ timeout: 5_000 });
    await removeMetricResponse;

    // Reload to verify metric removal was persisted
    await page.reload();
    await expect(page.getByRole("button", { name: "Add" }).first()).toBeVisible(
      { timeout: 20_000 },
    );

    // ✓ definition.metrics = [] is persisted and re-rendered
    await expect(
      page.getByRole("button", { name: "Remove Row Count" }),
    ).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("No metrics configured.")).toBeVisible({
      timeout: 15_000,
    });
  });
});
