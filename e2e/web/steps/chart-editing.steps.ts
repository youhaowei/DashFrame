import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { When, Then } = createBdd();

/**
 * Changes the chart type by interacting with the Chart Type select field
 * in the right panel of the visualization page.
 */
When(
  "I change the chart type to {string}",
  async ({ page }, chartType: string) => {
    // The chart type selector is in the right panel under "Chart Type" heading
    // We need to find the select field and click on it to open the dropdown

    // Wait for the select to be visible
    // The SelectField component renders a button with the current value
    const chartTypeSection = page.locator('text="Chart Type"').locator("..");
    await expect(chartTypeSection).toBeVisible();

    // Find the select button within the chart type section
    // The SelectField renders as a button that opens a dropdown
    const selectButton = chartTypeSection.locator("button").first();
    await selectButton.click();

    // Wait for dropdown to appear and click the desired option
    // Playwright's getByRole will find the option in the dropdown menu
    await page.getByRole("option", { name: chartType, exact: true }).click();

    // Wait a bit for the chart to re-render after type change
    await page.waitForTimeout(500);
  },
);

/**
 * Verifies that the current chart type matches the expected type
 * by checking the badge in the header.
 */
Then(
  "the chart type should be {string}",
  async ({ page }, expectedType: string) => {
    // Map display names to internal type names used in badges
    const typeMapping: Record<string, string> = {
      Bar: "barY",
      Line: "line",
      Area: "areaY",
      Scatter: "dot",
    };

    const internalType =
      typeMapping[expectedType] || expectedType.toLowerCase();

    // The badge showing chart type is in the header
    // Wait for it to update to the expected type
    await expect(page.getByText(internalType, { exact: true })).toBeVisible();
  },
);
