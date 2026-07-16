/**
 * JSON to Chart Workflow
 *
 * Core user journey: Upload JSON -> Data-first Insight -> Save Chart View
 */
import { expect, test } from "../lib/test-fixtures";

test.describe("JSON to Chart", () => {
  test("upload JSON and create suggested chart", async ({
    page,
    homePage,
    uploadFile,
    waitForChart,
  }) => {
    await homePage();

    // Upload JSON file
    await uploadFile("users_data.json");

    // Verify redirect to insight page
    await expect(page).toHaveURL(/\/insights\/[a-zA-Z0-9-]+/, {
      timeout: 15_000,
    });

    // Verify the insight opens data-first.
    await expect(page.getByRole("button", { name: "Data" })).toBeVisible({
      timeout: 30_000,
    });

    // Switch to an ephemeral chart view, then save it as a Visualization.
    // `exact: true` avoids matching "Horizontal bar" / "Hide sidebar", which
    // both contain "bar" as a substring under Playwright's default name match.
    await page.getByRole("button", { name: "Visualize" }).click();
    await page.getByRole("button", { name: "Bar", exact: true }).click();
    // "Save chart" appears once chart suggestions are computed (DuckDB init +
    // column analysis run after the table loads), so allow a generous wait.
    await expect(page.getByRole("button", { name: "Save chart" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Save chart" }).click();

    // Saving keeps the user on the insight canvas.
    await expect(page).toHaveURL(/\/insights\/[a-zA-Z0-9-]+/);

    // Verify chart renders
    await waitForChart();
  });

  test("shows correct row count for JSON", async ({
    page,
    homePage,
    uploadFile,
  }) => {
    await homePage();
    await uploadFile("users_data.json");

    await expect(page).toHaveURL(/\/insights\/[a-zA-Z0-9-]+/, {
      timeout: 15_000,
    });

    // users_data.json has 5 records
    await expect(page.getByText(/5 rows/).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
