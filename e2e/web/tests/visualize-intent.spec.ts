/**
 * Visualize intent — landing on an insight with `?visualize=true` (the
 * "Visualize" action from the data-source surface) auto-pins the first
 * chart suggestion and switches the canvas to it.
 */
import { expect, test } from "../lib/test-fixtures";

test("auto-pins a chart when landing with visualize intent", async ({
  page,
  homePage,
  uploadFile,
  waitForChart,
}) => {
  await homePage();
  await uploadFile("sales_data.csv");
  await expect(page).toHaveURL(/\/insights\/[a-zA-Z0-9-]+/, {
    timeout: 15_000,
  });

  // Re-enter the insight with the visualize intent flag, as the
  // "Visualize" action from the data-source surface would.
  const url = new URL(page.url());
  url.searchParams.set("visualize", "true");
  await page.goto(url.toString());

  // Auto-pin should create a visualization and switch the canvas to it.
  await waitForChart();

  // The pinned metric carries the field's display name, not the raw
  // UUID column alias.
  // Sections open by default; clicking an open one would collapse it.
  const metricsSection = page.getByRole("button", { name: /^Metrics\b/ });
  await expect(metricsSection).toBeVisible();
  if ((await metricsSection.getAttribute("aria-expanded")) !== "true") {
    await metricsSection.click();
  }
  await expect(metricsSection).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "Edit sum(Quantity)" }),
  ).toBeVisible();
  await expect(page.getByText("sum(Quantity)").first()).toBeVisible();
  await expect(page.getByText(/field_[0-9a-f]{8}/).first()).not.toBeVisible();
});
