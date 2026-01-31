import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { When, Then } = createBdd();

/**
 * Navigates to the dashboards page
 */
When("I navigate to the dashboards page", async ({ page }) => {
  await page.goto("/dashboards");
});

/**
 * Verifies that the dashboards page is displayed
 */
Then("I should see the dashboards page", async ({ page }) => {
  await expect(page).toHaveURL(/\/dashboards$/);
  await expect(page.getByRole("heading", { name: "Dashboards" })).toBeVisible();
});

/**
 * Clicks the "New Dashboard" button on the dashboards page
 */
When("I click the {string} button", async ({ page }, buttonLabel: string) => {
  await page.getByRole("button", { name: buttonLabel, exact: true }).click();
});

/**
 * Verifies that the create dashboard dialog is visible
 */
Then("I should see the create dashboard dialog", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Create New Dashboard" }),
  ).toBeVisible();
});

/**
 * Enters a dashboard name in the create dialog input field
 */
When(
  "I enter {string} as the dashboard name",
  async ({ page }, dashboardName: string) => {
    const nameInput = page.getByLabel("Dashboard Name");
    await nameInput.fill(dashboardName);
  },
);

/**
 * Clicks the Create button in the dialog
 */
When(
  "I click the {string} button in the dialog",
  async ({ page }, buttonLabel: string) => {
    // Find the button within the dialog
    const dialog = page.locator('[role="dialog"]');
    await dialog
      .getByRole("button", { name: buttonLabel, exact: true })
      .click();
  },
);

/**
 * Verifies that the user is redirected to the dashboard detail page
 */
Then(
  "I should be redirected to the dashboard detail page",
  async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboards\/[a-zA-Z0-9-]+$/);
    // Wait a bit for the page to load
    await page.waitForTimeout(500);
  },
);

/**
 * Verifies that the dashboard name is displayed in the header
 */
Then(
  "I should see the dashboard name {string}",
  async ({ page }, expectedName: string) => {
    await expect(
      page.getByRole("heading", { name: expectedName }),
    ).toBeVisible();
  },
);

/**
 * Verifies that the dashboard is in edit mode
 */
Then("the dashboard should be in edit mode", async ({ page }) => {
  // In edit mode, the "Done Editing" button should be visible
  await expect(
    page.getByRole("button", { name: "Done Editing" }),
  ).toBeVisible();
  // And the "Add Widget" button should also be visible
  await expect(page.getByRole("button", { name: "Add Widget" })).toBeVisible();
});

/**
 * Verifies that the add widget dialog is visible
 */
Then("I should see the add widget dialog", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Add Widget" })).toBeVisible();
});

/**
 * Verifies that the Visualization widget type is selected
 */
Then(
  "the {string} widget type should be selected",
  async ({ page }, widgetType: string) => {
    // The selected widget type should have the ring-1 ring-primary class
    const visualizationOption = page
      .locator("text=" + widgetType)
      .locator("..");
    await expect(visualizationOption).toHaveClass(/ring-primary/);
  },
);

/**
 * Selects the first visualization from the dropdown
 */
When("I select the first visualization from the dropdown", async ({ page }) => {
  // Click the select trigger to open the dropdown
  const selectTrigger = page.getByRole("combobox");
  await selectTrigger.click();

  // Wait for the dropdown to appear and select the first option
  const firstOption = page.getByRole("option").first();
  await firstOption.click();
});

/**
 * Verifies that the widget dialog has closed
 */
Then("the widget dialog should close", async ({ page }) => {
  // Wait for the dialog to disappear
  await expect(
    page.getByRole("heading", { name: "Add Widget" }),
  ).not.toBeVisible();
});

/**
 * Verifies that a visualization widget appears on the dashboard
 */
Then(
  "I should see a visualization widget on the dashboard",
  async ({ page }) => {
    // Look for the canvas element which indicates a Vega-Lite chart is rendered
    await expect(page.locator("canvas").first()).toBeVisible();
  },
);

/**
 * Verifies that the dashboard is not in edit mode
 */
Then("the dashboard should not be in edit mode", async ({ page }) => {
  // In view mode, the "Edit Dashboard" button should be visible
  await expect(
    page.getByRole("button", { name: "Edit Dashboard" }),
  ).toBeVisible();
  // And the "Done Editing" button should not be visible
  await expect(
    page.getByRole("button", { name: "Done Editing" }),
  ).not.toBeVisible();
});
