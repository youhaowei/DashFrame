#!/usr/bin/env node
// Prove the vendored anti-slop rules still fire, at error severity.
//
// scripts/oxlint-plugin-anti-slop/ is a DashFrame-owned fork of upstream rule
// code, wired into `vite.config.ts` as a Vite+ JS lint plugin and enabled at
// `error`. Nothing else in the gate would notice if that wiring broke: a plugin
// that stops loading, or rules that stop matching after an Oxlint or Vite+
// upgrade, both look exactly like a clean tree. `turbo lint` runs per-workspace
// scripts only, and the repo root is not a workspace, so root `scripts/` is
// never linted or typechecked by `bun run check` — this guard is the only gate
// coverage the vendored plugin gets.
//
// It lints two fixtures through the real `vp lint` path and asserts the exact
// diagnostics, including the near-miss cases the rules must NOT report and the
// severity, so that quietly downgrading a rule to `warn` fails here too.
//
// Fixtures live next to the plugin with a `.fixture` suffix so the repository's
// own lint and format passes never read them. They are copied to real `.ts`
// files in SCRATCH_DIR for the duration of this check.
//
// SCRATCH_DIR is deliberately NOT in .gitignore. Oxlint honours .gitignore even
// under --no-ignore, so an ignored scratch directory lints zero files and this
// check can never fail. That makes cleanup this script's responsibility on
// every exit path: a leaked scratch directory is untracked, invisible to the
// gate (nothing lints root `scripts/`), and would be swept up by `git add -A`
// — committing fixtures whose whole purpose is to violate the rules. Hence the
// single `finish()` below; never call `process.exit` directly.
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

/** Remove the scratch directory and exit. The only way out of this script. */
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

function lintScratchDir() {
  if (!existsSync(viteplusBin)) {
    skip(`no linter at ${viteplusBin}; run \`bun install\` in this worktree`);
  }

  const run = spawnSync(
    "bun",
    [viteplusBin, "lint", scratchDir, "-f", "json"],
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
    finish(
      1,
      `the linter read ${report.number_of_files} of ${FIXTURES.length} ` +
        `fixtures under ${scratchDir}.\n` +
        "Something is excluding that path — check .gitignore and the " +
        "`lint.ignorePatterns` list in vite.config.ts.",
    );
  }

  return report.diagnostics ?? [];
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
    if (diagnostic.severity !== "error") continue;
    const line = diagnostic.labels?.[0]?.span?.line ?? 0;
    // `filename` is repo-relative; only the basename identifies the fixture.
    const file = diagnostic.filename.split("/").at(-1);
    findings.push(`${file}:${line} ${rule}`);
  }
  return findings.sort();
}

rmSync(scratchDir, { recursive: true, force: true });
mkdirSync(scratchDir, { recursive: true });
for (const fixture of FIXTURES) {
  cpSync(join(fixtureDir, `${fixture}.fixture`), join(scratchDir, fixture));
}

const findings = antiSlopFindings(lintScratchDir());
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

finish(
  missing.length > 0 || unexpected.length > 0 ? 1 : 0,
  missing.length > 0 || unexpected.length > 0
    ? undefined
    : `${expected.length} expected findings reported at error severity, none in the valid fixture`,
);
