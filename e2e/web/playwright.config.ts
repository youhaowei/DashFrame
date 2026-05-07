import { defineConfig, devices } from "@playwright/test";
import os from "os";
import { findAvailablePort } from "./support/port-finder";

// Environment detection
const isCI = !!process.env.CI;

// Worker configuration
// CI: 1 worker (serial execution for reliability)
// Local: Multiple workers for faster parallel execution (capped at 6)
const WORKER_COUNT = isCI ? 1 : Math.min(os.cpus().length, 6);

// Port configuration
// Each worker gets its own port for IndexedDB isolation
const BASE_PORT = await findAvailablePort(3100);

// Export for use in test fixtures
export { BASE_PORT, isCI, WORKER_COUNT };

/**
 * Generate webServer configuration.
 *
 * - CI: Single server, build included in command
 * - Local: Multiple servers for parallel workers
 */
function getWebServerConfig() {
  if (isCI) {
    // CI: Single server with build
    return {
      command: `cd ../../apps/web && NEXT_DIST_DIR=.next-e2e bun run build && NEXT_DIST_DIR=.next-e2e bun run start -p ${BASE_PORT}`,
      url: `http://localhost:${BASE_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    };
  }

  // Local: Multiple servers for parallel workers
  // First server builds, others wait for build to complete
  return Array.from({ length: WORKER_COUNT }, (_, i) => ({
    command:
      i === 0
        ? `cd ../../apps/web && NEXT_DIST_DIR=.next-e2e bun run build && NEXT_DIST_DIR=.next-e2e bun run start -p ${BASE_PORT}`
        : `cd ../../apps/web && while [ ! -f .next-e2e/BUILD_ID ]; do sleep 1; done && NEXT_DIST_DIR=.next-e2e bun run start -p ${BASE_PORT + i}`,
    url: `http://localhost:${BASE_PORT + i}`,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "pipe" as const,
    stderr: "pipe" as const,
  }));
}

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : WORKER_COUNT,

  reporter:
    process.env.E2E_REPORT === "html"
      ? [
          ["html", { outputFolder: "playwright-report", open: "never" }],
          ["json", { outputFile: "test-results/results.json" }],
        ]
      : [
          ["json", { outputFile: "test-results/results.json" }],
          ["junit", { outputFile: "test-results/junit.xml" }],
          isCI ? ["github"] : ["list"],
        ],

  use: {
    // Default baseURL - overridden by fixture for parallel workers
    baseURL: `http://localhost:${BASE_PORT}`,
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
    // Firefox and WebKit only in CI for comprehensive coverage
    ...(isCI
      ? [
          {
            name: "firefox",
            use: { ...devices["Desktop Firefox"] },
          },
          {
            name: "webkit",
            use: { ...devices["Desktop Safari"] },
          },
        ]
      : []),
  ],

  webServer: getWebServerConfig(),
});
