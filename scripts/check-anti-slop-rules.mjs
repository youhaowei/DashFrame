#!/usr/bin/env node
// Prove the vendored anti-slop rules still fire.
//
// scripts/oxlint-plugin-anti-slop/ is a DashFrame-owned fork of upstream rule
// code, wired into `vite.config.ts` as a Vite+ JS lint plugin and enabled at
// `error`. Nothing else in the gate would notice if that wiring broke: a plugin
// that stops loading, or rules that stop matching after an Oxlint or Vite+
// upgrade, both look exactly like a clean tree. This check lints two fixtures
// through the real `vp lint` path and asserts the diagnostics we expect —
// including the near-miss cases the rules must NOT report.
//
// Fixtures live next to the plugin with a `.fixture` suffix so the repository's
// own lint and format passes never read them. They are copied to real `.ts`
// files in SCRATCH_DIR for the duration of this check.
//
// SCRATCH_DIR is deliberately NOT in .gitignore. Oxlint honours .gitignore even
// under --no-ignore, so an ignored scratch directory lints zero files and this
// check can never fail. The cost is that an interrupted run leaves the fixtures
// on disk, where the repository's own lint will report the intentional
// violations in invalid.ts — noisy, but loud and self-healing, since the next
// run of this check removes the directory before recreating it.
//
// Usage: node scripts/check-anti-slop-rules.mjs
// Exit code: 0 = both rules behaved, 1 = a rule fired wrongly or not at all,
// 78 = the linter could not run, reported as SKIP by scripts/run-checks.mjs.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_EXIT_CODE = 78;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = join(repoRoot, "scripts", "oxlint-plugin-anti-slop");
const fixtureDir = join(pluginDir, "fixtures");
const scratchDir = join(pluginDir, "fixture-run");

// The fixtures to lint, each copied from `<name>.fixture` to `<name>`. All of
// them must be read on every run; see the file-count check in lintScratchDir.
const FIXTURES = ["invalid.ts", "valid.ts"];

// Every diagnostic the invalid fixture must produce, as `file:line rule`. Line
// numbers refer to fixtures/invalid.ts.fixture; update both together.
const EXPECTED = [
  "invalid.ts:13 no-widen-then-assert",
  "invalid.ts:18 no-reflect-apply",
  "invalid.ts:26 no-reflect-apply",
];

function skip(reason, detail) {
  console.error(`[anti-slop] ${reason}`);
  if (detail) console.error(detail.trim());
  process.exit(SKIP_EXIT_CODE);
}

function lintScratchDir() {
  const run = spawnSync(
    "bunx",
    ["vp", "lint", scratchDir, "-f", "json"],
    // Oxlint resolves `jsPlugins` specifiers relative to the config, so this
    // has to run from the repository root even though the target is nested.
    { cwd: repoRoot, encoding: "utf8" },
  );

  if (run.error) skip(`could not start the linter: ${run.error.message}`);

  // The linter prints human-readable notices before the JSON report, so parse
  // from the first brace rather than assuming stdout is pure JSON.
  const stdout = run.stdout ?? "";
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) {
    skip("the linter produced no JSON report", stdout || run.stderr);
  }

  let report;
  try {
    report = JSON.parse(stdout.slice(jsonStart));
  } catch (error) {
    skip(`could not parse the linter's JSON report: ${error.message}`, stdout);
  }

  // A renamed field is the linter's report changing shape, not a rule
  // regression — say so rather than blaming an ignore pattern below.
  if (typeof report.number_of_files !== "number") {
    skip(
      "the linter's JSON report has no `number_of_files`; its format changed",
    );
  }

  // Every fixture has to have been read. Checking only for zero would still
  // pass when an ignore rule swallowed valid.ts alone: invalid.ts would supply
  // all the expected diagnostics, and the false-positive cases would go
  // untested while the check reported success.
  if (report.number_of_files !== FIXTURES.length) {
    console.error(
      `[anti-slop] the linter read ${report.number_of_files} of ` +
        `${FIXTURES.length} fixtures under ${scratchDir}.\n` +
        "Something is excluding that path — check .gitignore and the " +
        "`lint.ignorePatterns` list in vite.config.ts.",
    );
    process.exit(1);
  }

  return report.diagnostics ?? [];
}

function antiSlopFindings(diagnostics) {
  const findings = [];
  for (const diagnostic of diagnostics) {
    const rule = /^anti-slop\((?<rule>.+)\)$/u.exec(diagnostic.code)?.groups
      ?.rule;
    if (rule === undefined) continue;
    const line = diagnostic.labels?.[0]?.span?.line ?? 0;
    // `filename` is repo-relative; only the basename identifies the fixture.
    const file = diagnostic.filename.split("/").at(-1);
    findings.push(`${file}:${line} ${rule}`);
  }
  return findings.sort();
}

rmSync(scratchDir, { recursive: true, force: true });
mkdirSync(scratchDir, { recursive: true });

let findings;
try {
  for (const fixture of FIXTURES) {
    cpSync(join(fixtureDir, `${fixture}.fixture`), join(scratchDir, fixture));
  }
  findings = antiSlopFindings(lintScratchDir());
} finally {
  rmSync(scratchDir, { recursive: true, force: true });
}

const expected = [...EXPECTED].sort();
const missing = expected.filter((entry) => !findings.includes(entry));
const unexpected = findings.filter((entry) => !expected.includes(entry));

if (missing.length > 0) {
  console.error(
    "[anti-slop] these rules did not report what the fixture requires:\n" +
      missing.map((entry) => `  - ${entry}`).join("\n") +
      "\nThe plugin may have stopped loading, or a rule stopped matching.",
  );
}
if (unexpected.length > 0) {
  console.error(
    "[anti-slop] these findings were not expected:\n" +
      unexpected.map((entry) => `  - ${entry}`).join("\n") +
      "\nA finding in valid.ts is a false positive; a new one in invalid.ts " +
      "means the fixture and the EXPECTED table have drifted apart.",
  );
}
if (missing.length > 0 || unexpected.length > 0) process.exit(1);

console.log(
  `[anti-slop] ${expected.length} expected findings reported, none in the valid fixture`,
);
