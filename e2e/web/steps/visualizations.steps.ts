import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Then } = createBdd();

Then("I should see the chart rendered", async ({ page }) => {
  // Check for canvas which Vega-Lite uses
  await expect(page.locator("canvas").first()).toBeVisible();
});
