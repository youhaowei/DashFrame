import { defineConfig, devices } from "@playwright/test";
import { findAvailablePortBlock } from "./support/port-finder";

// Environment detection
const isCI = !!process.env.CI;

// Worker configuration
// The app now stores shared metadata in the WyStack project database. Keep E2E
// serial so tests share one API server predictably; IndexedDB still holds Arrow
// bytes and is cleared by the fixtures.
const WORKER_COUNT = 1;

// Port configuration. Each worker gets its own port for IndexedDB isolation
// (different origins → different databases). Playwright re-evaluates this
// config inside every worker process, so we stamp the picked block into
// process.env on the orchestrator and let workers read it back — otherwise
// each worker would re-roll its own port and miss the running webServers.
const BASE_PORT = await (async () => {
  const cached = process.env.E2E_BASE_PORT;
  if (cached) return Number(cached);
  const picked = await findAvailablePortBlock(3100, WORKER_COUNT);
  process.env.E2E_BASE_PORT = String(picked);
  return picked;
})();
const API_PORT = Number(process.env.E2E_API_PORT ?? BASE_PORT + 1000);
const API_URL = `http://127.0.0.1:${API_PORT}`;
process.env.E2E_WYSTACK_URL = API_URL;

// Export for use in test fixtures
export { API_URL, BASE_PORT, isCI, WORKER_COUNT };

/**
 * Generate webServer configuration.
 *
 * - CI: Single server, build included in command
 * - Local: Multiple servers for parallel workers
 */
function apiServerCommand(port: number) {
  return `cd ../.. && bun run --filter @dashframe/server start -- --host 127.0.0.1 --port ${API_PORT} --project /tmp/dashframe-e2e-${port}`;
}

function webServerCommand(port: number) {
  return `cd ../../apps/web && VITE_WYSTACK_URL=${API_URL} bun run build && VITE_WYSTACK_URL=${API_URL} bun run start --port ${port} --strictPort`;
}

function getWebServerConfig() {
  if (isCI) {
    // CI: Single API server + single web server with build.
    return [
      {
        command: apiServerCommand(BASE_PORT),
        url: `${API_URL}/api/projectInfo`,
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: "pipe" as const,
        stderr: "pipe" as const,
      },
      {
        command: webServerCommand(BASE_PORT),
        url: `http://localhost:${BASE_PORT}`,
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: "pipe" as const,
        stderr: "pipe" as const,
      },
    ];
  }

  return [
    {
      command: apiServerCommand(BASE_PORT),
      url: `${API_URL}/api/projectInfo`,
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    },
    {
      command: webServerCommand(BASE_PORT),
      url: `http://localhost:${BASE_PORT}`,
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: "pipe" as const,
      stderr: "pipe" as const,
    },
  ];
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
