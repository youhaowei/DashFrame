#!/usr/bin/env node
// Runs every repo-level check and reports all of their results.
//
// This exists because `bun run a && bun run b && ...` stops at the first
// failure. The cheap convention guards (ticket refs, domain nouns, apply-command
// boundary) each take under a second, and when one of them failed it short-
// circuited the lint/typecheck/test run behind it — so a one-line convention
// violation hid every type error and failing test in the same push. Each check
// below runs to completion regardless of what the ones before it did; the exit
// code is still non-zero if any of them failed.
//
// Add a check by adding its package.json script name here. Keep each entry
// independently runnable (`bun run <name>`) so a developer can re-run just the
// one that failed.
//
// Usage: node scripts/run-checks.mjs
// Exit code: 0 = every check passed, 1 = at least one did not pass (FAIL or
// SKIP). A check exiting 78 could not run its subject and is reported SKIP;
// that is a gate failure, not a pass.

import { spawnSync } from "node:child_process";

const CHECKS = [
  "check:ticket-refs",
  "check:wystack-domain-nouns",
  "check:apply-commands-boundary",
  "check:packages",
];

// A check that could not run its subject at all exits 78 (EX_CONFIG) rather
// than 0. It is reported as SKIP, never PASS — a summary line that reads PASS
// has to mean the check inspected its subject and found it clean. A skip still
// fails the gate, because "we did not look" is not evidence of correctness.
const SKIP_EXIT_CODE = 78;

const results = [];

for (const script of CHECKS) {
  console.log(`\n=== ${script} ===`);
  const run = spawnSync("bun", ["run", script], { stdio: "inherit" });

  // A child killed by a signal reports status === null. Treat anything that is
  // not an explicit zero exit as a failure, including a spawn error.
  let outcome;
  if (run.error) {
    console.error(
      `[run-checks] failed to start ${script}: ${run.error.message}`,
    );
    outcome = "failed";
  } else if (run.signal) {
    console.error(`[run-checks] ${script} was killed by ${run.signal}`);
    outcome = "failed";
  } else if (run.status === SKIP_EXIT_CODE) {
    console.error(
      `[run-checks] ${script} could not run — reported as SKIP, which fails the gate`,
    );
    outcome = "skipped";
  } else {
    outcome = run.status === 0 ? "passed" : "failed";
  }

  results.push({ script, outcome });
}

const LABELS = { passed: "PASS", failed: "FAIL", skipped: "SKIP" };
const notPassed = results.filter((r) => r.outcome !== "passed");

console.log("\n=== summary ===");
for (const { script, outcome } of results) {
  console.log(`${LABELS[outcome]}  ${script}`);
}

if (notPassed.length > 0) {
  console.error(
    `\n${notPassed.length} of ${results.length} checks did not pass: ` +
      notPassed.map((r) => `${r.script} (${LABELS[r.outcome]})`).join(", "),
  );
  process.exit(1);
}
