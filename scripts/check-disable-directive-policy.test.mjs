import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { findPolicyViolations } from "./check-disable-directive-policy.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

test("catches exact protected-rule tokens in every supported comment form", () => {
  const content = [
    "/* oxlint-disable dashframe/require-disable-reason */",
    "// eslint-disable-next-line dashframe/require-disable-reason",
    "const x = 1; // oxlint-disable-line foo, dashframe/require-disable-reason -- reviewed",
    "/* oxlint-disable",
    "   dashframe/require-disable-reason */",
    "const view = <div>{/* eslint-disable dashframe/require-disable-reason */}</div>;",
  ].join("\n");
  assert.deepEqual(
    findPolicyViolations(content, "fixture.tsx").map((hit) => hit.line),
    [1, 2, 3, 4, 6],
  );
});

test("ignores longer rule names, reasons, literals, and JSX text", () => {
  const content = [
    "// oxlint-disable-next-line dashframe/require-disable-reason-extra -- another rule",
    "// oxlint-disable-next-line foo -- dashframe/require-disable-reason is only in the reason",
    'const stringValue = "// oxlint-disable dashframe/require-disable-reason";',
    "const templateValue = `/* oxlint-disable dashframe/require-disable-reason */`;",
    "const urlPattern = /https?:\\/\\//u;",
    "const blockText = <div>/* oxlint-disable dashframe/require-disable-reason */</div>;",
    "const lineText = <div>hello // oxlint-disable dashframe/require-disable-reason\nworld</div>;",
    "const inlineLineText = <div>// oxlint-disable dashframe/require-disable-reason </div>; const trailing = true;",
  ].join("\n");
  assert.deepEqual(findPolicyViolations(content, "fixture.tsx"), []);
});

test("covers oxlint's real self-suppression behavior", (t) => {
  const fixtureDir = mkdtempSync(join(scriptsDir, "disable-policy-fixture-"));
  t.after(() => rmSync(fixtureDir, { recursive: true, force: true }));

  const ordinaryFile = join(fixtureDir, "ordinary.ts");
  writeFileSync(
    ordinaryFile,
    "// oxlint-disable-next-line no-debugger\ndebugger;\n",
  );
  const ordinaryLint = spawnSync(
    "bunx",
    ["vp", "lint", relative(repoRoot, ordinaryFile)],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.notEqual(ordinaryLint.status, 0);
  assert.match(
    `${ordinaryLint.stdout}${ordinaryLint.stderr}`,
    /dashframe[/(]require-disable-reason/u,
  );

  const selfSuppressedFile = join(fixtureDir, "self-suppressed.ts");
  const selfSuppressed =
    "/* oxlint-disable dashframe/require-disable-reason */\nexport const value = 1;\n";
  writeFileSync(selfSuppressedFile, selfSuppressed);
  const selfSuppressedLint = spawnSync(
    "bunx",
    ["vp", "lint", relative(repoRoot, selfSuppressedFile)],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(
    selfSuppressedLint.status,
    0,
    `${selfSuppressedLint.stdout}${selfSuppressedLint.stderr}`,
  );
  assert.equal(
    findPolicyViolations(selfSuppressed, "self-suppressed.ts").length,
    1,
  );

  const compactDelimiterFile = join(fixtureDir, "compact-delimiter.ts");
  const compactDelimiter =
    "/* oxlint-disable dashframe/require-disable-reason-- legacy */\nexport const value = 1;\n";
  writeFileSync(compactDelimiterFile, compactDelimiter);
  const compactDelimiterLint = spawnSync(
    "bunx",
    ["vp", "lint", relative(repoRoot, compactDelimiterFile)],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(
    compactDelimiterLint.status,
    0,
    `${compactDelimiterLint.stdout}${compactDelimiterLint.stderr}`,
  );
  assert.equal(
    findPolicyViolations(compactDelimiter, "compact-delimiter.ts").length,
    1,
  );

  const layeredBypassFile = join(fixtureDir, "layered-bypass.ts");
  const layeredBypass = [
    "/* oxlint-disable unicorn/no-abusive-eslint-disable -- fixture */",
    "/* oxlint-disable */",
    "export const value = 1;",
    "",
  ].join("\n");
  writeFileSync(layeredBypassFile, layeredBypass);
  const layeredBypassLint = spawnSync(
    "bunx",
    ["vp", "lint", relative(repoRoot, layeredBypassFile)],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(
    layeredBypassLint.status,
    0,
    `${layeredBypassLint.stdout}${layeredBypassLint.stderr}`,
  );
  assert.deepEqual(
    findPolicyViolations(layeredBypass, "layered-bypass.ts").map(
      ({ kind, line }) => ({ kind, line }),
    ),
    [{ kind: "blanket-disable", line: 2 }],
  );
});
