import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Then } = createBdd();

Then("I should see the chart rendered", async ({ page }) => {
  // The visualization page shows the chart title and info.
  // Check for the "rows · columns" text which appears when chart data is loaded.
  await expect(page.getByText(/\d+ rows · \d+ columns/)).toBeVisible({
    timeout: 30_000,
  });
});
