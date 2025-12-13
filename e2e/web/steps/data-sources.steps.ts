import { createBdd } from "playwright-bdd";
import { expect } from "@playwright/test";

const { Given, When, Then } = createBdd();

When("I select {string} connector", async ({ page }, connectorName: string) => {
  // TODO: Implement based on actual UI - placeholder for now
  await page.getByRole("button", { name: connectorName }).click();
});

When("I upload {string}", async ({ page }, filePath: string) => {
  // TODO: Implement file upload based on actual UI - placeholder for now
  console.log(`Uploading ${filePath} - implement based on UI flow`);
});

Then("I should see a table preview", async ({ page }) => {
  // TODO: Implement based on actual UI - placeholder for now
  await expect(page.locator("table")).toBeVisible();
});

Then("the table should have {int} rows", async ({ page }, rowCount: number) => {
  // TODO: Implement based on actual UI - placeholder for now
  console.log(`Verifying ${rowCount} rows - implement based on UI`);
});

Then("missing values should be displayed as empty cells", async ({ page }) => {
  // TODO: Implement based on actual UI - placeholder for now
  console.log("Checking for empty cells - implement based on UI");
});

Then(
  "I should see an error message {string}",
  async ({ page }, errorMessage: string) => {
    await expect(page.getByText(errorMessage)).toBeVisible();
  },
);

Given("I have uploaded {string}", async ({ page }, filePath: string) => {
  // TODO: Implement upload flow - placeholder for now
  console.log(`Uploading ${filePath} - implement based on UI flow`);
});

Given("I am viewing the data frame", async ({ page }) => {
  // TODO: Navigate to data frame view - placeholder for now
  await page.goto("/data-frames");
});
