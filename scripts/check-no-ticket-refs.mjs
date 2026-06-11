#!/usr/bin/env node
// Enforces the "no ticket numbers in source code" convention.
//
// Scans all TypeScript source files under packages/{pkg} and apps/{pkg}
// (recursively, not just their `src/` dirs — some apps keep source under
// components/, hooks/, lib/, or at the package root) for patterns like YW-123
// or TASK-456. Any match is a hard failure — ticket refs belong in commit
// messages and Linear, not in comments, JSDoc, or test titles.
//
// Usage: node scripts/check-no-ticket-refs.mjs
// Exit code: 0 = clean, 1 = violations found.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TICKET_PATTERN = /\b(YW|TASK)-\d+\b/g;
const SOURCE_ROOTS = ["packages", "apps"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

const repoRoot = join(fileURLToPath(import.meta.url), "../..");

// Recursively collect all .ts/.tsx files under a directory.
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
      // Skip generated / vendored dirs that are not hand-written source.
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
      if (SOURCE_EXTENSIONS.has(ext)) {
        results.push(full);
      }
    }
  }
  return results;
}

// Collect all source files across packages/{pkg} and apps/{pkg}. Each package
// is scanned recursively from its root — not just `src/` — because some apps
// (e.g. apps/web) keep TypeScript source under components/, hooks/, lib/, and at
// the package root. The recursion's generated/vendor excludes (node_modules,
// dist, build, .turbo, coverage) keep the scan to hand-written source.
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

const allFiles = collectAllSourceFiles();
const violations = [];

for (const file of allFiles) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matches = [...line.matchAll(TICKET_PATTERN)];
    for (const match of matches) {
      violations.push({
        file: file.replace(repoRoot + "/", ""),
        line: i + 1,
        col: match.index + 1,
        match: match[0],
        text: line.trim(),
      });
    }
  }
}

if (violations.length === 0) {
  console.log("check-no-ticket-refs: OK — no ticket refs in source.");
  process.exit(0);
}

console.error(
  `check-no-ticket-refs: FAIL — ${violations.length} ticket ref(s) found in source files.\n` +
    `Ticket refs (YW-nnn, TASK-nnn) belong in commit messages and Linear, not in source code.\n` +
    `Rewrite each comment to state the constraint without the ticket number.\n`,
);

for (const v of violations) {
  console.error(`  ${v.file}:${v.line}:${v.col}  ${v.match}  —  ${v.text}`);
}

process.exit(1);
