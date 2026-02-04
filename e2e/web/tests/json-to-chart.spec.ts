/**
 * JSON to Chart Workflow
 *
 * Core user journey: Upload JSON -> Configure Insight -> Create Chart
 */
import { expect, test } from "../lib/test-fixtures";

test.describe("JSON to Chart", () => {
  test("upload JSON and create suggested chart", async ({
    page,
    homePage,
    uploadFile,
    waitForChart,
  }) => {
    await homePage();

    // Upload JSON file
    await uploadFile("users_data.json");

    // Verify redirect to insight page
    await expect(page).toHaveURL(/\/insights\/[a-zA-Z0-9-]+/, {
      timeout: 15_000,
    });

    // Verify chart suggestions appear
    await expect(page.getByText("Create visualization")).toBeVisible({
      timeout: 30_000,
    });

    // Click first suggestion
    await page
      .getByRole("button", { name: /^Comparison/ })
      .first()
      .click();

    // Verify redirect to visualization page
    await expect(page).toHaveURL(/\/visualizations\/[a-zA-Z0-9-]+/);

    // Verify chart renders
    await waitForChart();
  });

  test("shows correct row count for JSON", async ({
    page,
    homePage,
    uploadFile,
  }) => {
    await homePage();
    await uploadFile("users_data.json");

    await expect(page).toHaveURL(/\/insights\/[a-zA-Z0-9-]+/, {
      timeout: 15_000,
    });

    // users_data.json has 5 records
    await expect(page.getByText(/5 rows/).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
