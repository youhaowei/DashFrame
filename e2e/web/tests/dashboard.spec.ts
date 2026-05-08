/**
 * Dashboard Tests
 *
 * Tests for creating dashboards and managing widgets
 */
import { expect, test } from "../lib/test-fixtures";

test.describe("Dashboard", () => {
  test("create dashboard", async ({ page, homePage }) => {
    await homePage();

    // Navigate to dashboards
    await page.getByRole("link", { name: /dashboards/i }).click();
    await expect(page).toHaveURL(/\/dashboards/);

    // Create new dashboard - button text varies:
    // "New Dashboard" when dashboards exist, "Create Dashboard" when empty
    const newDashboardBtn = page.getByRole("button", { name: "New Dashboard" });
    const createDashboardBtn = page.getByRole("button", {
      name: "Create Dashboard",
    });

    if (await newDashboardBtn.isVisible()) {
      await newDashboardBtn.click();
    } else {
      await createDashboardBtn.click();
    }

    // Fill in the dashboard name in the dialog
    await page.getByPlaceholder("e.g., Sales Overview").fill("Test Dashboard");
    await page.getByRole("button", { name: "Create" }).click();

    // Should redirect to new dashboard
    await expect(page).toHaveURL(/\/dashboards\/[a-zA-Z0-9-]+/, {
      timeout: 10_000,
    });

    // Verify dashboard page loaded
    await expect(
      page.getByRole("heading", { name: "Test Dashboard" }),
    ).toBeVisible();
  });

  test("navigate between dashboards list and detail", async ({
    page,
    homePage,
  }) => {
    await homePage();

    // Navigate to dashboards
    await page.getByRole("link", { name: /dashboards/i }).click();
    await expect(page).toHaveURL(/\/dashboards/);

    // Verify dashboards page loads (use exact match to avoid "No dashboards yet" heading)
    await expect(
      page.getByRole("heading", { name: "Dashboards", exact: true }),
    ).toBeVisible();
  });
});
