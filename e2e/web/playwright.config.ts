import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";
import { findAvailablePortSync } from "./support/port-finder";

const testDir = defineBddConfig({
  features: "features/**/*.feature",
  steps: "steps/**/*.ts",
  outputDir: "features/.generated",
});

// If E2E_PORT is set, assume a dev server is already running (dev mode).
// Otherwise, find an available port and run a production build (default).
const hasExternalServer = !!process.env.E2E_PORT;
const TEST_PORT = hasExternalServer
  ? parseInt(process.env.E2E_PORT!, 10)
  : findAvailablePortSync(3100);

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

  webServer: hasExternalServer
    ? undefined // Dev server already running at E2E_PORT
    : {
        // Build to .next-e2e (separate from dev .next) and start production server
        // Both build and start need NEXT_DIST_DIR to use the same output directory
        command: `cd ../../apps/web && NEXT_DIST_DIR=.next-e2e bun run build && NEXT_DIST_DIR=.next-e2e bun run start -p ${TEST_PORT}`,
        url: `http://localhost:${TEST_PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000, // Production build takes longer
        stdout: "pipe",
        stderr: "pipe",
      },
});
