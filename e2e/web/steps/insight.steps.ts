import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { When, Then } = createBdd();

/**
 * Verifies that the insight configuration panel is visible
 */
Then("I should see the insight configuration panel", async ({ page }) => {
  // Check for the Fields section which is part of the config panel
  await expect(page.getByText("Fields", { exact: true })).toBeVisible();
  await expect(page.getByText("Metrics", { exact: true })).toBeVisible();
});

/**
 * Selects a field by clicking the add field button and choosing from the dropdown
 */
When("I select the {string} field", async ({ page }, fieldName: string) => {
  // Click the "Add Field" button in the Fields section
  const fieldsSection = page.locator('text="Fields"').locator("..");
  const addFieldButton = fieldsSection.getByRole("button", {
    name: /Add Field/i,
  });
  await addFieldButton.click();

  // Wait for the field editor modal to appear
  await expect(
    page.getByRole("heading", { name: "Add Field" }),
  ).toBeVisible();

  // Find and click the field in the list
  // The field appears as a selectable item in the modal
  const fieldItem = page.getByText(fieldName, { exact: true }).first();
  await fieldItem.click();

  // The field should be automatically added when clicked
  // Wait a bit for the modal to close
  await page.waitForTimeout(300);
});

/**
 * Verifies a field is in the selected fields list
 */
Then(
  "I should see {string} in the selected fields",
  async ({ page }, fieldName: string) => {
    // The selected field should appear in the Fields section
    const fieldsSection = page.locator('text="Fields"').locator("..");
    await expect(fieldsSection.getByText(fieldName)).toBeVisible();
  },
);

/**
 * Clicks the add metric button
 */
When("I click the add metric button", async ({ page }) => {
  const metricsSection = page.locator('text="Metrics"').locator("..");
  const addMetricButton = metricsSection.getByRole("button", {
    name: /Add Metric/i,
  });
  await addMetricButton.click();

  // Wait for the metric editor modal to appear
  await expect(
    page.getByRole("heading", { name: "Add Metric" }),
  ).toBeVisible();
});

/**
 * Configures a metric with aggregation and column
 */
When(
  "I configure a metric with aggregation {string} and column {string}",
  async ({ page }, aggregation: string, columnName: string) => {
    // Select aggregation type from dropdown
    const aggregationSelect = page.getByLabel("Aggregation");
    await aggregationSelect.click();
    await page
      .getByRole("option", { name: aggregation, exact: true })
      .click();

    // Select column from dropdown
    const columnSelect = page.getByLabel("Column");
    await columnSelect.click();
    await page.getByRole("option", { name: columnName, exact: true }).click();

    // Wait a bit for the form to update
    await page.waitForTimeout(200);
  },
);

/**
 * Saves the metric with a name
 */
When("I save the metric as {string}", async ({ page }, metricName: string) => {
  // Enter the metric name
  const nameInput = page.getByLabel("Name");
  await nameInput.fill(metricName);

  // Click the save button
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // Wait for the modal to close
  await expect(
    page.getByRole("heading", { name: "Add Metric" }),
  ).not.toBeVisible();
});

/**
 * Verifies a metric appears in the metrics list
 */
Then(
  "I should see the metric {string} in the metrics list",
  async ({ page }, metricName: string) => {
    const metricsSection = page.locator('text="Metrics"').locator("..");
    await expect(metricsSection.getByText(metricName)).toBeVisible();
  },
);

/**
 * Navigates to the home page
 */
When("I navigate to the home page", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome to DashFrame" }),
  ).toBeVisible();
});

/**
 * Navigates to the insights page
 */
When("I navigate to the insights page", async ({ page }) => {
  await page.goto("/insights");
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
});

/**
 * Clicks on the first insight in the list
 */
When("I click on the first insight", async ({ page }) => {
  // Find the first insight card and click it
  // Insights are displayed as clickable cards
  const firstInsight = page.locator('[data-testid="insight-card"]').first();
  if (await firstInsight.count()) {
    await firstInsight.click();
  } else {
    // Fallback: look for any link to an insight
    const insightLink = page
      .locator('a[href^="/insights/"]')
      .filter({ hasNotText: /create|new/i })
      .first();
    await insightLink.click();
  }
});

/**
 * Clicks the add join button
 */
When("I click the add join button", async ({ page }) => {
  // The join button is in the Data Model section
  const dataModelSection = page.locator('text="Data Model"').locator("..");
  const addJoinButton = dataModelSection.getByRole("button", {
    name: /Add Table|Join/i,
  });
  await addJoinButton.click();

  // Wait for the join flow modal to appear
  await page.waitForTimeout(500);
});

/**
 * Selects a table for joining
 */
When(
  "I select the products table for the join",
  async ({ page }) => {
    // In the join flow, we need to select the products table
    // Look for a table selector or list item containing "products"
    const productsTable = page.getByText(/products_data\.csv|products/i).first();
    await productsTable.click();

    // Wait for selection to register
    await page.waitForTimeout(300);
  },
);

/**
 * Configures the join with left and right fields
 */
When(
  "I configure the join with left field {string} and right field {string}",
  async ({ page }, leftField: string, rightField: string) => {
    // Find and configure the left field dropdown
    const leftFieldSelect = page.getByLabel(/Left.*Field|Field.*Left/i).first();
    await leftFieldSelect.click();
    await page.getByRole("option", { name: leftField, exact: true }).click();

    // Find and configure the right field dropdown
    const rightFieldSelect = page
      .getByLabel(/Right.*Field|Field.*Right/i)
      .first();
    await rightFieldSelect.click();
    await page.getByRole("option", { name: rightField, exact: true }).click();

    // Wait for the configuration to be applied
    await page.waitForTimeout(300);
  },
);

/**
 * Confirms the join configuration
 */
When("I confirm the join", async ({ page }) => {
  // Click the confirm/add button in the join flow
  const confirmButton = page
    .getByRole("button", { name: /Add Join|Confirm|Save/i })
    .first();
  await confirmButton.click();

  // Wait for the join to be created
  await page.waitForTimeout(500);
});

/**
 * Verifies the joined table appears in the data model
 */
Then("I should see the joined table in the data model", async ({ page }) => {
  // The joined table should appear in the Data Model section
  const dataModelSection = page.locator('text="Data Model"').locator("..");

  // Look for join type indicator or second table reference
  await expect(
    dataModelSection.getByText(/products|joined/i).first(),
  ).toBeVisible();
});

/**
 * Verifies combined fields from both tables are available
 */
Then(
  "I should see combined fields from both tables",
  async ({ page }) => {
    // After a join, fields from both tables should be visible
    // Check that we have fields from the products table (like "Price" or "Supplier")
    const fieldsSection = page.locator('text="Fields"').locator("..");

    // Open the add field dialog to see all available fields
    const addFieldButton = fieldsSection.getByRole("button", {
      name: /Add Field/i,
    });
    await addFieldButton.click();

    // Wait for the field editor modal
    await expect(
      page.getByRole("heading", { name: "Add Field" }),
    ).toBeVisible();

    // Check for a field from the joined table (e.g., "Price" from products)
    await expect(page.getByText("Price", { exact: true }).first()).toBeVisible();

    // Close the modal
    await page.keyboard.press("Escape");
  },
);
