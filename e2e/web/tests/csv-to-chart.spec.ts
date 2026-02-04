/**
 * CSV to Chart Workflow
 *
 * Core user journey: Upload CSV -> Configure Insight -> Create Chart
 */
import { expect, test } from "../lib/test-fixtures";

test.describe("CSV to Chart", () => {
  test("upload CSV and create suggested chart", async ({
    page,
    homePage,
    uploadFile,
    waitForChart,
  }) => {
    // Start at home
    await homePage();

    // Upload CSV file
    await uploadFile("sales_data.csv");

    // Verify redirect to insight page
    await expect(page).toHaveURL(/\/insights\/[a-zA-Z0-9-]+/, {
      timeout: 15_000,
    });

    // Verify chart suggestions appear
    await expect(page.getByText("Create visualization")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Comparison")).toBeVisible();

    // Click first suggestion (Comparison chart)
    await page
      .getByRole("button", { name: /^Comparison/ })
      .first()
      .click();

    // Verify redirect to visualization page
    await expect(page).toHaveURL(/\/visualizations\/[a-zA-Z0-9-]+/);

    // Verify chart renders
    await waitForChart();
  });

  test("shows correct row count after upload", async ({
    page,
    homePage,
    uploadFile,
  }) => {
    await homePage();
    await uploadFile("sales_data.csv");

    await expect(page).toHaveURL(/\/insights\/[a-zA-Z0-9-]+/, {
      timeout: 15_000,
    });

    // sales_data.csv has 5 rows
    await expect(page.getByText(/5 rows/).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("shows expected columns", async ({ page, homePage, uploadFile }) => {
    await homePage();
    await uploadFile("sales_data.csv");

    await expect(page).toHaveURL(/\/insights\/[a-zA-Z0-9-]+/, {
      timeout: 15_000,
    });

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
