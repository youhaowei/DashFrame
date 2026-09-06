import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { findBoundaryViolations } from "./check-apply-commands-boundary.mjs";

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "dashframe-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}

test("retired seams and test files cannot reintroduce raw dispatch", (t) => {
  const root = fixture(t, {
    "apps/server/src/draft-controller.ts": "applyCommands(batch)",
    "apps/server/src/functions/preview-diff.ts": "ctx.applyCommands(batch)",
    "packages/app/src/example.test.ts":
      "import { applyCommands } from '@wystack/server'",
  });
  assert.equal(findBoundaryViolations(root).length, 3);
});

test("retired imports, aliases, and package dependencies are rejected", (t) => {
  const root = fixture(t, {
    "apps/server/vitest.config.ts":
      "export default { alias: { '@wystack/db': './db' } }",
    "apps/web/src/runtime.ts":
      "const client = await import('@wystack/client/react')",
    "apps/desktop/entry.cjs": "const transport = require('@wystack/transport')",
    "apps/renderer/package.json": JSON.stringify({
      dependencies: { "@wystack/client": "workspace:*" },
    }),
  });
  assert.equal(findBoundaryViolations(root).length, 4);
});

test("comments do not produce false positives or hide executable references", (t) => {
  const root = fixture(t, {
    "packages/types/clean.ts":
      "// applyCommands and @wystack/server are retired\nexport const url = 'http://localhost';",
    "packages/app/hidden.ts":
      "const text = '/*'; applyCommands(batch); const end = '*/';",
  });
  assert.deepEqual(findBoundaryViolations(root), [
    { file: "packages/app/hidden.ts", reasons: ["applyCommands"] },
  ]);
});

test("native runtime and retained libraries are allowed; generated and vendor output are excluded", (t) => {
  const root = fixture(t, {
    "packages/app/index.ts":
      "import { ConvexClient } from 'convex/browser'; import { api } from '@dashframe/convex-backend/api'",
    "apps/server/package.json": JSON.stringify({
      dependencies: {
        "@wystack/identity": "workspace:*",
        "@wystack/secret-vault": "workspace:*",
        "@wystack/permissions": "workspace:*",
      },
    }),
    "packages/app/dist/index.js": "applyCommands(batch)",
    "libs/wystack/index.ts": "applyCommands(batch)",
  });
  assert.deepEqual(findBoundaryViolations(root), []);
});

test("an empty checkout cannot pass without examining a subject", (t) => {
  assert.throws(
    () => findBoundaryViolations(fixture(t, {})),
    /No first-party source/,
  );
});
