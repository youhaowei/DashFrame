import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findAvailablePortBlock } from "./support/port-finder";

// Environment detection
const isCI = !!process.env.CI;

// Metadata and Arrow files belong to one isolated host project. Keep tests
// serial and reset that project before every test.
const WORKER_COUNT = 1;

// Playwright reloads this config in workers; share the orchestrator's ports and
// unique run directory rather than creating another runtime in each worker.
const BASE_PORT = await (async () => {
  const cached = process.env.E2E_BASE_PORT;
  if (cached) return Number(cached);
  const picked = await findAvailablePortBlock(3100, WORKER_COUNT + 1);
  process.env.E2E_BASE_PORT = String(picked);
  return picked;
})();
const API_PORT = Number(process.env.E2E_API_PORT ?? BASE_PORT + WORKER_COUNT);
const API_URL = `http://127.0.0.1:${API_PORT}`;
process.env.E2E_DASHFRAME_URL = API_URL;
const RUN_DIRECTORY =
  process.env.E2E_RUN_DIRECTORY ??
  mkdtempSync(path.join(tmpdir(), "dashframe-e2e-"));
process.env.E2E_RUN_DIRECTORY = RUN_DIRECTORY;
const USER_TOKEN = "dashframe-e2e-user";
process.env.E2E_USER_TOKEN = USER_TOKEN;

// Export for use in test fixtures
export { API_URL, BASE_PORT, isCI, WORKER_COUNT };

function shellQuote(value: string) {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}
function apiServerCommand() {
  return `cd ../.. && DASHFRAME_SECRET_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= bun run --filter @dashframe/server start -- --host 127.0.0.1 --port ${API_PORT} --token ${USER_TOKEN} --project ${shellQuote(path.join(RUN_DIRECTORY, "project"))} --data-dir ${shellQuote(path.join(RUN_DIRECTORY, "host-data"))}`;
}

function webServerCommand(port: number) {
  return `cd ../../apps/web && VITE_DASHFRAME_URL=${API_URL} bun run build && VITE_DASHFRAME_URL=${API_URL} bun run preview --port ${port} --strictPort`;
}

function getWebServerConfig() {
  if (isCI) {
    // CI: Single API server + single web server with build.
    return [
      {
        command: apiServerCommand(),
        // Authentication failures are valid readiness responses; fixtures then
        // require a successful authenticated runtime query before navigation.
        url: `${API_URL}/api/runtime`,
        gracefulShutdown: { signal: "SIGTERM" as const, timeout: 15_000 },
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
      command: apiServerCommand(),
      url: `${API_URL}/api/runtime`,
      gracefulShutdown: { signal: "SIGTERM" as const, timeout: 15_000 },
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
