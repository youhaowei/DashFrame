import { expect } from "@playwright/test";
import path from "path";
import { createBdd } from "playwright-bdd";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { When, Then } = createBdd();

/**
 * Upload a file from the fixtures directory.
 * Works with both CSV and JSON files through the unified Local Files connector.
 */
When("I upload the {string} file", async ({ page }, fileName: string) => {
  const filePath = path.join(__dirname, "..", "fixtures", fileName);

  // Wait for the Local Files connector card to be visible (exact match to avoid "Select Local Files" button)
  await expect(page.getByText("Local Files", { exact: true })).toBeVisible();

  // The file input is hidden but we can target it directly
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(filePath);
});

/**
 * Attempt to upload an unsupported file type (creates a temp file).
 */
When(
  "I try to upload an unsupported file {string}",
  async ({ page }, fileName: string) => {
    await expect(page.getByText("Local Files", { exact: true })).toBeVisible();

    // Create a temporary file with the given name
    const content = "This is a text file content";
    const buffer = Buffer.from(content);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer,
    });
  },
);

/**
 * Attempt to upload an empty CSV file.
 */
When("I try to upload an empty CSV file", async ({ page }) => {
  await expect(page.getByText("Local Files", { exact: true })).toBeVisible();

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "empty.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(""),
  });
});

/**
 * Attempt to upload an invalid JSON file.
 */
When("I try to upload an invalid JSON file", async ({ page }) => {
  await expect(page.getByText("Local Files", { exact: true })).toBeVisible();

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{invalid json syntax}"),
  });
});

/**
 * Verify chart suggestions are displayed.
 * The UI shows a "Create visualization" section with suggested chart types.
 */
Then("I should see chart suggestions", async ({ page }) => {
  // Wait for the "Create visualization" section (the actual title in the UI)
  await expect(page.getByText("Create visualization")).toBeVisible({
    timeout: 30_000,
  });
  // Wait for at least one suggestion card (e.g., "Comparison", "Trend", etc.)
  await expect(page.getByText("Comparison")).toBeVisible({
    timeout: 15_000,
  });
});

/**
 * Click on the first chart suggestion card.
 * The suggestions are buttons with names starting with chart categories like "Comparison", "Trend", etc.
 */
When('I click "Create" on the first suggestion', async ({ page }) => {
  // Click the first suggestion card (e.g., "Comparison Bar...")
  await page
    .getByRole("button", { name: /^Comparison/ })
    .first()
    .click();
});

/**
 * Verify the data table shows the expected number of rows.
 * The insight page shows "X rows • Y fields" format in multiple places.
 */
Then(
  "I should see the data table with {int} rows",
  async ({ page }, rowCount: number) => {
    // Wait for row count indicator (format: "X rows • Y fields")
    // Use .first() since this text appears multiple times on the page
    await expect(
      page.getByText(new RegExp(`${rowCount} rows`)).first(),
    ).toBeVisible({
      timeout: 15_000,
    });
  },
);

/**
 * Verify specific columns are present in the data table.
 * Accepts a comma-separated list of column names.
 * The data table shows columns as sortable buttons: "Sort by [Column Name]"
 */
Then("I should see columns {string}", async ({ page }, columnList: string) => {
  const columns = columnList.split(",").map((c) => c.trim());

  for (const column of columns) {
    // Column headers are rendered as sortable buttons: "Sort by [Column Name]"
    await expect(
      page.getByRole("button", { name: `Sort by ${column}` }),
    ).toBeVisible({
      timeout: 10_000,
    });
  }
});

/**
 * Verify an error message is displayed.
 */
Then(
  "I should see an error message containing {string}",
  async ({ page }, errorText: string) => {
    // Look for error message in toast notifications or inline errors
    await expect(page.getByText(errorText, { exact: false })).toBeVisible({
      timeout: 10_000,
    });
  },
);
