#!/usr/bin/env node
// Prove the vendored anti-slop rules still fire, at error severity.
//
// scripts/oxlint-plugin-anti-slop/ is a DashFrame-owned fork of upstream rule
// code, wired into `vite.config.ts` as a Vite+ JS lint plugin and enabled at
// `error`. Nothing else in the gate would notice if that wiring broke: a plugin
// that stops loading, or rules that stop matching after an Oxlint or Vite+
// upgrade, both look exactly like a clean tree. `turbo lint` runs per-workspace
// scripts only, and the repo root is not a workspace, so root `scripts/` is
// not covered by workspace lint or typecheck tasks — this guard supplies
// runtime coverage for the vendored plugin. After checking the fixtures, scan all
// first-party paths for these two rules, including packages without a lint task.
//
// It lints two fixtures through the real `vp lint` path and asserts the exact
// diagnostics, including the near-miss cases the rules must NOT report and the
// severity, so that quietly downgrading a rule to `warn` fails here too.
//
// Fixtures live next to the plugin with a `.fixture` suffix so the repository's
// own lint and format passes never read them. They are copied to real `.ts`
// files in SCRATCH_DIR for the duration of this check.
//
// SCRATCH_DIR is deliberately not ignored: ignored fixtures would not be read.
// Cleanup belongs to this script, because `git add -A` would otherwise include
// generated files whose purpose is to violate the rules. Deliberate exits use
// finish(); setup and diagnostic processing also have a finally cleanup.
//
// Usage: node scripts/check-anti-slop-rules.mjs
// Exit code: 0 = both rules behaved, 1 = a rule fired wrongly or not at all,
// 78 = the linter could not run, reported as SKIP by scripts/run-checks.mjs.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_EXIT_CODE = 78;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = join(repoRoot, "scripts", "oxlint-plugin-anti-slop");
const fixtureDir = join(pluginDir, "fixtures");
const scratchDir = join(pluginDir, "fixture-run");

// Resolve the linter from node_modules rather than going through `bunx`, which
// falls back to installing from the registry when the binary is missing — and
// an unrelated package named `vp` is published there. An unprovisioned worktree
// must skip, not fetch and execute a stranger's bin. It is run through `bun`
// rather than executed directly because the bin carries a `#!/usr/bin/env node`
// shebang, and this repo does not require Node on PATH.
const viteplusBin = join(repoRoot, "node_modules", ".bin", "vp");

// The fixtures to lint, each copied from `<name>.fixture` to `<name>`. All of
// them must be read on every run; see the file-count check in lintScratchDir.
const FIXTURES = ["invalid.ts", "valid.ts"];

// Every diagnostic the invalid fixture must produce, as `file:line rule`. Line
// numbers refer to fixtures/invalid.ts.fixture; update both together.
const EXPECTED = [
  "invalid.ts:13 no-widen-then-assert",
  "invalid.ts:18 no-reflect-apply",
  "invalid.ts:26 no-reflect-apply",
  "invalid.ts:41 no-widen-then-assert",
];

/** Remove the scratch directory before a deliberate exit. */
function finish(code, message, detail) {
  rmSync(scratchDir, { recursive: true, force: true });
  if (message) {
    const log = code === 0 ? console.log : console.error;
    log(`[anti-slop] ${message}`);
    if (detail) console.error(detail.trim());
  }
  process.exit(code);
}

function skip(reason, detail) {
  finish(SKIP_EXIT_CODE, reason, detail);
}

function lintPaths(paths) {
  if (!existsSync(viteplusBin)) {
    skip(`no linter at ${viteplusBin}; run \`bun install\` in this worktree`);
  }

  const run = spawnSync(
    "bun",
    [viteplusBin, "lint", ...paths, "-f", "json"],
    // Oxlint resolves `jsPlugins` specifiers relative to the config, so this
    // has to run from the repository root even though the target is nested.
    { cwd: repoRoot, encoding: "utf8" },
  );

  if (run.error) skip(`could not start the linter: ${run.error.message}`);
  if (run.signal) skip(`the linter was killed by ${run.signal}`);

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

  // Same reasoning as number_of_files: a missing or reshaped `diagnostics` is
  // the report changing, not a rule regression. Falling back to `[]` would turn
  // it into a bogus "no rules fired" failure, and a non-array would throw out
  // of antiSlopFindings before anything cleaned up.
  if (!Array.isArray(report.diagnostics)) {
    skip(
      "the linter's JSON report has no `diagnostics` array; its format changed",
    );
  }
  for (const diagnostic of report.diagnostics) {
    if (
      diagnostic === null ||
      typeof diagnostic !== "object" ||
      Array.isArray(diagnostic)
    ) {
      skip("the linter's diagnostics contain a non-object; its format changed");
    }
    if (
      typeof diagnostic.code !== "string" ||
      !diagnostic.code.startsWith("anti-slop(")
    )
      continue;
    if (
      typeof diagnostic.filename !== "string" ||
      typeof diagnostic.severity !== "string" ||
      !Number.isInteger(diagnostic.labels?.[0]?.span?.line) ||
      diagnostic.labels[0].span.line < 1
    ) {
      skip(
        "an anti-slop diagnostic has an unreadable location or severity; its format changed",
      );
    }
  }
  if (run.status !== 0 && run.status !== 1) {
    skip(`the linter exited unexpectedly (${run.status})`, run.stderr);
  }
  return { ...report, status: run.status };
}

function lintScratchDir() {
  const report = lintPaths([scratchDir]);
  // Every fixture has to have been read. Checking only for zero would still
  // pass when an ignore rule swallowed valid.ts alone: invalid.ts would supply
  // all the expected diagnostics, and the false-positive cases would go
  // untested while the check reported success.
  if (report.number_of_files !== FIXTURES.length) {
    finish(
      1,
      `the linter read ${report.number_of_files} of ${FIXTURES.length} ` +
        `fixtures under ${scratchDir}.\n` +
        "Something is excluding that path — check .gitignore and the " +
        "`lint.ignorePatterns` list in vite.config.ts.",
    );
  }

  return report.diagnostics;
}

function antiSlopFindings(diagnostics) {
  const findings = [];
  for (const diagnostic of diagnostics) {
    const rule = /^anti-slop\((?<rule>.+)\)$/u.exec(diagnostic.code)?.groups
      ?.rule;
    if (rule === undefined) continue;
    // Severity is part of the contract. Both rules are configured at `error`;
    // a downgrade to `warn` emits the same diagnostics while blocking nothing,
    // so counting those as satisfying EXPECTED would hide the very regression
    // this guard exists to catch.
    if (diagnostic.severity !== "error") {
      finish(
        1,
        `${rule} reported at ${diagnostic.severity} severity instead of error`,
      );
    }
    const line = diagnostic.labels?.[0]?.span?.line ?? 0;
    // `filename` is repo-relative; only the basename identifies the fixture.
    const file = diagnostic.filename.split("/").at(-1);
    findings.push(`${file}:${line} ${rule}`);
  }
  return findings.sort();
}

// finish() covers the deliberate exits; this try/finally covers the rest. A
// renamed fixture or any other throwing fs call must not leave the scratch
// directory behind either — `git add -A` would sweep up untracked files that
// exist to violate the rules.
let findings;
try {
  rmSync(scratchDir, { recursive: true, force: true });
  mkdirSync(scratchDir, { recursive: true });
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
      "\nThe plugin may have stopped loading, a rule stopped matching, or a " +
      "rule was downgraded from `error`.",
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

if (missing.length > 0 || unexpected.length > 0) finish(1);

// Do not depend on workspace lint tasks for coverage: some first-party packages
// only typecheck. Filter the full report to adopted rules so existing lint
// debt outside workspace tasks does not become part of this integration.
// Unnamed diagnostics (such as parse failures) still fail the scan.
const sourceReport = lintPaths([
  "apps",
  "packages",
  "scripts",
  "vite.config.ts",
]);
if (sourceReport.number_of_files === 0)
  finish(1, "the source scan read no files");
antiSlopFindings(sourceReport.diagnostics);
const sourceErrors = sourceReport.diagnostics.filter(
  (diagnostic) =>
    typeof diagnostic.code !== "string" ||
    !/^[^()]+\([^)]+\)$/u.test(diagnostic.code) ||
    diagnostic.code.startsWith("anti-slop("),
);
if (
  sourceErrors.length > 0 ||
  (sourceReport.status !== 0 && sourceReport.diagnostics.length === 0)
) {
  finish(
    1,
    "the adopted-rule source scan failed",
    JSON.stringify(sourceErrors, null, 2),
  );
}
finish(
  0,
  `${expected.length} expected fixture findings at error severity; ${sourceReport.number_of_files} source files checked for adopted rules`,
);
