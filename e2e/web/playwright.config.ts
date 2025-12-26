import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
import { findAvailablePortSync } from "./support/port-finder";

const testDir = defineBddConfig({
  features: "features/**/*.feature",
  steps: "steps/**/*.ts",
  outputDir: "features/.generated",
});

// Find available port starting from 3100 (avoid conflicts with dev:3000, worktrees, etc.)
const TEST_PORT = process.env.E2E_PORT
  ? parseInt(process.env.E2E_PORT, 10)
  : findAvailablePortSync(3100);

// Mode: 'production' (default) or 'dev' (fast iteration)
const E2E_MODE = process.env.E2E_MODE || "production";
const isProduction = E2E_MODE === "production";

export default defineConfig({
  testDir,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter:
    process.env.E2E_REPORT === "html"
      ? [
          ["html", { outputFolder: "playwright-report", open: "never" }],
          ["json", { outputFile: "test-results/results.json" }],
        ]
      : [
          ["json", { outputFile: "test-results/results.json" }],
          ["junit", { outputFile: "test-results/junit.xml" }],
          process.env.CI ? ["github"] : ["list"],
        ],

  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],

  webServer: {
    // Production mode: Build to .next-e2e (separate from dev .next)
    // Dev mode: Use regular dev server (faster iteration)
    command: isProduction
      ? `cd ../../apps/web && NEXT_DIST_DIR=.next-e2e pnpm build && pnpm start -p ${TEST_PORT}`
      : `cd ../../apps/web && PORT=${TEST_PORT} pnpm dev`,

    url: `http://localhost:${TEST_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: isProduction ? 180_000 : 120_000, // Production build takes longer
    stdout: "pipe",
    stderr: "pipe",
  },
});
