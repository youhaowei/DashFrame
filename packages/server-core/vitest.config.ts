import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // These suites are PGlite(WASM)-bound integration tests: snapshot
    // dump/restore and WAL-recovery each spin up real Postgres-in-WASM. On a
    // loaded CI runner a single dumpDataDir can take many seconds, and the
    // recovery tests open multiple instances serially. 30s was too tight there
    // (the prune test, ~2.5s locally, timed out under CI contention). 60s
    // tolerates a slow runner without masking a genuine hang.
    testTimeout: 60_000,
    include: ["**/*.test.{ts,tsx}"],
  },
});
