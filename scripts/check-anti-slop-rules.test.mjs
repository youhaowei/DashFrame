import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scripts = dirname(fileURLToPath(import.meta.url));
const fixtureFindings = [
  [13, "no-widen-then-assert"],
  [18, "no-reflect-apply"],
  [26, "no-reflect-apply"],
  [41, "no-widen-then-assert"],
].map(([line, rule]) => ({
  code: `anti-slop(${rule})`,
  severity: "error",
  filename: "invalid.ts",
  labels: [{ span: { line } }],
}));

function runGuard(
  t,
  {
    diagnostics = fixtureFindings,
    missingFixture = false,
    sourceViolation = false,
    ignoredSourceRoot = null,
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "dashframe-anti-slop-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const plugin = join(root, "scripts", "oxlint-plugin-anti-slop");
  mkdirSync(plugin, { recursive: true });
  cpSync(
    join(scripts, "check-anti-slop-rules.mjs"),
    join(root, "scripts", "check-anti-slop-rules.mjs"),
  );
  cpSync(
    join(scripts, "oxlint-plugin-anti-slop", "fixtures"),
    join(plugin, "fixtures"),
    { recursive: true },
  );
  if (missingFixture) rmSync(join(plugin, "fixtures", "valid.ts.fixture"));
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  // Exercise subprocess parsing, statuses and cleanup without loading Vite+
  // repeatedly. The real guard invocation separately verifies the actual rules.
  writeFileSync(
    join(root, "node_modules", ".bin", "vp"),
    `
const fixture = process.argv.some((arg) => arg.endsWith("fixture-run"));
const sourceRoot = ["apps", "packages", "scripts", "vite.config.ts"].find((path) => process.argv.includes(path));
if (!fixture && !sourceRoot) throw new Error("source root was not scanned");
const diagnostics = fixture ? ${JSON.stringify(diagnostics)} : ${JSON.stringify(sourceViolation ? [{ ...fixtureFindings[1], filename: "packages/types/src/index.ts" }] : [])};
console.log(JSON.stringify({number_of_files: fixture ? 2 : sourceRoot === ${JSON.stringify(ignoredSourceRoot)} ? 0 : 3, diagnostics}));
process.exit(fixture || ${sourceViolation} ? 1 : 0);
`,
  );
  const result = spawnSync(
    "bun",
    [join(root, "scripts", "check-anti-slop-rules.mjs")],
    { encoding: "utf8" },
  );
  assert.equal(
    existsSync(join(plugin, "fixture-run")),
    false,
    "scratch fixtures must be cleaned up",
  );
  return result;
}

test("valid fixture report and clean source scan pass", (t) => {
  assert.equal(runGuard(t).status, 0);
});

test("fixture setup exceptions clean up", (t) => {
  assert.notEqual(runGuard(t, { missingFixture: true }).status, 0);
});

for (const diagnostics of [
  {},
  [null],
  [{ ...fixtureFindings[0], filename: null }],
  [{ ...fixtureFindings[0], labels: [] }],
]) {
  test(`unreadable diagnostics skip and clean up: ${JSON.stringify(diagnostics)}`, (t) => {
    assert.equal(runGuard(t, { diagnostics }).status, 78);
  });
}

test("an extra warning in the valid fixture cannot pass", (t) => {
  const warning = {
    ...fixtureFindings[0],
    severity: "warning",
    filename: "valid.ts",
  };
  assert.equal(
    runGuard(t, { diagnostics: [...fixtureFindings, warning] }).status,
    1,
  );
});

test("a violation in a package without a lint task fails", (t) => {
  assert.equal(runGuard(t, { sourceViolation: true }).status, 1);
});

test("an ignored packages tree cannot hide behind other source roots", (t) => {
  assert.equal(runGuard(t, { ignoredSourceRoot: "packages" }).status, 1);
});
