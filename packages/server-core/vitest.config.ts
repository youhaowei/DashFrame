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
    // All five test files in this package use PGlite (WASM Postgres). Running
    // them in parallel forks causes simultaneous WASM cold-starts that contend
    // for file descriptors and memory on a loaded CI runner — the first test in
    // each file (mapping-store: "get returns the record written by set") was the
    // most common victim because it runs before any warm-up query. Serialising
    // to a single fork eliminates the cold-start race at the cost of slightly
    // longer wall-clock time (the tests are I/O-bound, not CPU-bound, so the
    // loss is small).
    maxWorkers: 1,
    minWorkers: 1,
  },
});
