import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Then } = createBdd();

Then("I should see the chart rendered", async ({ page }) => {
  // Wait for data to be loaded (shown in header metadata)
  await expect(page.getByText(/\d+ rows · \d+ columns/)).toBeVisible({
    timeout: 30_000,
  });

  // Verify the chart SVG is rendered inside the Chart component container
  await expect(
    page.locator('[data-testid="visualization-chart"] svg'),
  ).toBeVisible({
    timeout: 10_000,
  });
});
