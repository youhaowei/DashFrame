#!/usr/bin/env node
// Enforces the "applyCommands has one entry point" boundary.
//
// `@wystack/server`'s `applyCommands` is the raw batch-dispatch MECHANISM —
// no auth, no draft/preview semantics, no DashFrame vocabulary. DashFrame only
// calls it from two seams that own those semantics:
//   - apps/server/src/draft-controller.ts   (commit: replay a draft's command
//     log onto canonical, atomically)
//   - apps/server/src/functions/preview-diff.ts  (preview: execute-then-
//     rollback to compute a diff, never persisted)
// Any other caller has gone around draft-controller/preview-diff and is
// talking to the raw mechanism directly — exactly the escape hatch the
// command vocabulary (apps/server/src/functions/commands.ts) exists to close.
//
// Scope: DashFrame's own source (packages/, apps/, e2e/), matching
// check-no-ticket-refs.mjs's source roots. libs/wystack (the engine itself,
// which legitimately calls/defines applyCommands internally) is out of scope —
// it is a submodule this repo only reads.
//
// Detection: comment-stripped source text is searched for the `applyCommands`
// token. Stripping comments first means a file that only *mentions*
// `applyCommands` in a JSDoc/prose comment (there are many, describing the
// mechanism) is not flagged — only a real import/call/type-reference is.
//
// Test files (`*.test.ts(x)`) are exempt: unit tests for draft-controller,
// preview-diff, and the command vocabulary itself legitimately exercise
// applyCommands directly (including via dynamic `await import(...)` for
// mock-friendly binding), mirroring the test-file relaxations already applied
// elsewhere in this repo's lint config.
//
// Usage: node scripts/check-apply-commands-boundary.mjs
// Exit code: 0 = clean, 1 = violations found.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APPLY_COMMANDS_PATTERN = /\bapplyCommands\b/;
const SOURCE_ROOTS = ["packages", "apps", "e2e"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const ALLOWED_FILES = new Set([
  "apps/server/src/draft-controller.ts",
  "apps/server/src/functions/preview-diff.ts",
]);

const repoRoot = join(fileURLToPath(import.meta.url), "../..");

function isTestFile(name) {
  return /\.(test|spec)\.(ts|tsx)$/.test(name);
}

function collectSourceFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === ".turbo" ||
        entry.name === "coverage" ||
        entry.name === ".next" ||
        entry.name === "out"
      ) {
        continue;
      }
      results.push(...collectSourceFiles(full));
    } else if (entry.isFile()) {
      const ext = entry.name.slice(entry.name.lastIndexOf("."));
      if (SOURCE_EXTENSIONS.has(ext) && !isTestFile(entry.name)) {
        results.push(full);
      }
    }
  }
  return results;
}

function collectAllSourceFiles() {
  const files = [];
  for (const root of SOURCE_ROOTS) {
    const rootDir = join(repoRoot, root);
    let packages;
    try {
      packages = readdirSync(rootDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const pkg of packages) {
      if (!pkg.isDirectory()) continue;
      files.push(...collectSourceFiles(join(rootDir, pkg.name)));
    }
  }
  return files;
}

// Best-effort comment stripper: block comments (incl. JSDoc) then full-line
// and trailing `//` comments. Not string-literal-aware, but over-stripping is
// harmless here — we only search what remains for a bare identifier.
function stripComments(code) {
  let out = code.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/^[ \t]*\/\/.*$/gm, "");
  out = out.replace(/([^:"'])\/\/.*$/gm, "$1");
  return out;
}

const allFiles = collectAllSourceFiles();
const violations = [];

for (const file of allFiles) {
  const relPath = file.replace(repoRoot + "/", "");
  if (ALLOWED_FILES.has(relPath)) continue;
  const content = readFileSync(file, "utf8");
  const stripped = stripComments(content);
  if (APPLY_COMMANDS_PATTERN.test(stripped)) {
    violations.push(relPath);
  }
}

if (violations.length === 0) {
  console.log(
    "check-apply-commands-boundary: OK — applyCommands is only called from draft-controller.ts and preview-diff.ts.",
  );
  process.exit(0);
}

console.error(
  `check-apply-commands-boundary: FAIL — ${violations.length} file(s) reference applyCommands outside the allowed seams.\n` +
    `applyCommands is the raw wystack dispatch mechanism — only apps/server/src/draft-controller.ts (commit)\n` +
    `and apps/server/src/functions/preview-diff.ts (preview) may call it. Route through the command\n` +
    `vocabulary (apps/server/src/functions/commands.ts) or one of those two controllers instead.\n`,
);

for (const v of violations) {
  console.error(`  ${v}`);
}

process.exit(1);
