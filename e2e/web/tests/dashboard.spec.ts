/**
 * Report Tests
 *
 * Tests for creating reports and managing report items
 */
import { expect, test } from "../lib/test-fixtures";

test.describe("Reports", () => {
  test("create report", async ({ page, homePage }) => {
    await homePage();

    // Navigate to reports
    await page.getByRole("link", { name: "Reports" }).click();
    await expect(page).toHaveURL(/\/dashboards/);

    // Create new report - button text varies by collection state.
    const newReportButton = page.getByRole("button", { name: "New report" });
    const createReportButton = page.getByRole("button", {
      name: "Create report",
    });

    if (await newReportButton.isVisible()) {
      await newReportButton.click();
    } else {
      await createReportButton.click();
    }

    // Fill in the report name in the dialog
    await page.getByPlaceholder("e.g., Sales overview").fill("Test report");
    await page.getByRole("button", { name: "Create" }).click();

    // Should redirect to the new report detail.
    await expect(page).toHaveURL(/\/dashboards\/[a-zA-Z0-9-]+/, {
      timeout: 10_000,
    });

    // Verify report page loaded
    await expect(
      page.getByRole("heading", { name: "Test report" }),
    ).toBeVisible();
  });

  test("navigate between reports list and detail", async ({
    page,
    homePage,
  }) => {
    await homePage();

    // Navigate to reports
    await page.getByRole("link", { name: "Reports" }).click();
    await expect(page).toHaveURL(/\/dashboards/);

    // Verify reports page loads (use exact match to avoid "No reports yet" heading)
    await expect(
      page.getByRole("heading", { name: "Reports", exact: true }),
    ).toBeVisible();
  });
});
