import { createBdd } from "playwright-bdd";
import { expect } from "@playwright/test";
import path from "path";

const { When, Then } = createBdd();

When("I upload the {string} file", async ({ page }, fileName: string) => {
  // Use a relative path from the fixtures directory
  const filePath = path.join(__dirname, "..", "fixtures", fileName);

  // Wait for the connector to be visible
  await expect(page.getByText("CSV File")).toBeVisible();

  // The file input is hidden but associated with the label wrapper
  // We can target the input directly since it's the only file input in this context
  // or be more specific if there are multiple.
  // Based on the snapshot: generic [ref=e95] -> generic [ref=e96] Select CSV File

  // We'll use the .setInputFiles on the actual input element which might be hidden
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(filePath);
});

Then("I should see chart suggestions", async ({ page }) => {
  await expect(page.getByText("Suggested charts")).toBeVisible();
  // Check for at least one suggestion card with a "Create" button
  await expect(
    page.getByRole("button", { name: "Create" }).first(),
  ).toBeVisible();
});

When('I click "Create" on the first suggestion', async ({ page }) => {
  await page.getByRole("button", { name: "Create" }).first().click();
});
