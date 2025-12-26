import { createBdd } from "playwright-bdd";
import { expect } from "@playwright/test";

const { Then } = createBdd();

Then("I should see the chart rendered", async ({ page }) => {
  // Check for canvas which Vega-Lite uses
  await expect(page.locator("canvas").first()).toBeVisible();
});
