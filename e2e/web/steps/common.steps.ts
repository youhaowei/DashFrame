import { createBdd } from "playwright-bdd";
import { expect } from "@playwright/test";

const { Given, Then } = createBdd();

Given("I am on the DashFrame home page", async ({ page }) => {
  await page.goto("/");
  // Wait for the main content to be visible to ensure hydration
  await expect(
    page.getByRole("heading", { name: "Welcome to DashFrame" }),
  ).toBeVisible();
});

Then(
  "I should be redirected to the insight configuration page",
  async ({ page }) => {
    await expect(page).toHaveURL(/\/insights\/[a-zA-Z0-9-]+/);
  },
);

Then("I should be redirected to the visualization page", async ({ page }) => {
  await expect(page).toHaveURL(/\/visualizations\/[a-zA-Z0-9-]+/);
});
