import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Then } = createBdd();

Then("I should see the chart rendered", async ({ page }) => {
  // Capture console logs from the START (before any waiting)
  const consoleLogs: string[] = [];
  page.on("console", (msg) => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });

  // Wait for data to be loaded (shown in header metadata)
  await expect(page.getByText(/\d+ rows · \d+ columns/)).toBeVisible({
    timeout: 30_000,
  });

  // Wait longer for async view creation and vgplot rendering
  // vgplot renders asynchronously - query data from DuckDB then render SVG
  await page.waitForTimeout(5000);

  // Debug: check what elements exist
  const chartContainer = page.locator('[data-testid="visualization-chart"]');
  const chartContainerExists = (await chartContainer.count()) > 0;
  const chartHTML = chartContainerExists
    ? await chartContainer.innerHTML()
    : "N/A";
  const chartStyle = chartContainerExists
    ? await chartContainer.evaluate((el) =>
        JSON.stringify({
          width: el.clientWidth,
          height: el.clientHeight,
          display: window.getComputedStyle(el).display,
        }),
      )
    : "N/A";

  // Check DuckDB tables via browser
  const duckdbTables = await page.evaluate(async () => {
    try {
      // @ts-expect-error - accessing global DuckDB provider
      const db = window.__DUCKDB__;
      if (!db) return "DuckDB not found";
      const conn = await db.connect();
      const result = await conn.query("SHOW TABLES");
      const tables = result.toArray().map((row: { name: string }) => row.name);
      await conn.close();
      return tables.join(", ");
    } catch (e) {
      return `Error: ${e}`;
    }
  });

  // Filter relevant logs
  const relevantLogs = consoleLogs.filter(
    (log) =>
      log.includes("Visualization") ||
      log.includes("[Chart]") ||
      log.includes("VgplotRenderer") ||
      log.includes("error") ||
      log.includes("Error") ||
      log.includes("failed") ||
      log.includes("vgplot") ||
      log.includes("Mosaic") ||
      log.includes("duckdb") ||
      log.includes("DuckDB") ||
      log.includes("insight_view") ||
      log.includes("wasmConnector") ||
      log.includes("row count") ||
      log.includes("Available DuckDB tables") ||
      log.includes("useEffect"),
  );

  // Also get ALL error logs
  const errorLogs = consoleLogs.filter(
    (log) => log.startsWith("[error]") || log.startsWith("[warn]"),
  );

  console.log(
    `[E2E Debug] Chart container exists: ${chartContainerExists}`,
    `\n  Style: ${chartStyle}`,
    `\n  Inner HTML length: ${chartHTML.length}`,
    `\n  Inner HTML preview: ${chartHTML.substring(0, 500)}`,
    `\n  DuckDB tables: ${duckdbTables}`,
    `\n  Relevant console logs (${relevantLogs.length}):`,
    relevantLogs.slice(0, 20).join("\n"),
    `\n  Error/Warn logs (${errorLogs.length}):`,
    errorLogs.slice(0, 10).join("\n"),
  );

  // Verify the chart SVG is rendered inside the Chart component container
  await expect(
    page.locator('[data-testid="visualization-chart"] svg'),
  ).toBeVisible({
    timeout: 10_000,
  });
});
