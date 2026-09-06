#!/usr/bin/env node
// Keep the historical gate name, but forbid the retired WyStack artifact
// runtime everywhere in DashFrame. Native Convex owns preview and commit.
// Scan first-party source, tests, and package dependencies; vendored libs are
// deliberately outside this boundary. Identity, permissions, vault, and UI
// packages from those libraries remain supported.

import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SOURCE_ROOTS = ["packages", "apps", "e2e"];
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  ".turbo",
  "coverage",
  ".next",
  "out",
]);
const RETIRED_PACKAGE = /^@wystack\/(?:client|db|server|transport)(?:\/|$)/;
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function collectFiles(dir, optional = false) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (optional && error.code === "ENOENT") return [];
    throw error;
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : collectFiles(full);
    }
    return entry.isFile() &&
      (entry.name === "package.json" ||
        SOURCE_EXTENSIONS.has(extname(entry.name)))
      ? [full]
      : [];
  });
}

export function findBoundaryViolations(repoRoot) {
  const files = SOURCE_ROOTS.flatMap((root) =>
    collectFiles(join(repoRoot, root), true),
  );
  if (files.length === 0)
    throw new Error("No first-party source or package manifests found");
  const violations = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const reasons = new Set();
    if (file.endsWith("package.json")) {
      const manifest = JSON.parse(content);
      for (const field of DEPENDENCY_FIELDS) {
        for (const name of Object.keys(manifest[field] ?? {})) {
          if (RETIRED_PACKAGE.test(name)) reasons.add(name);
        }
      }
    } else {
      // The parser distinguishes comments, URLs, and strings from identifiers;
      // a comment or URL must not hide a real import later on the same line.
      const source = ts.createSourceFile(
        file,
        content,
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node) => {
        if (ts.isIdentifier(node) && node.text === "applyCommands")
          reasons.add(node.text);
        if (ts.isStringLiteralLike(node) && RETIRED_PACKAGE.test(node.text))
          reasons.add(node.text);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    if (reasons.size)
      violations.push({
        file: relative(repoRoot, file),
        reasons: [...reasons].sort(),
      });
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
  try {
    const violations = findBoundaryViolations(repoRoot);
    if (violations.length === 0) {
      console.log(
        "check-apply-commands-boundary: OK — no retired WyStack artifact runtime references.",
      );
    } else {
      console.error(
        "check-apply-commands-boundary: FAIL — use native Convex preview and commit operations; the retired artifact runtime has no allowed callers.",
      );
      for (const violation of violations) {
        console.error(`  ${violation.file}: ${violation.reasons.join(", ")}`);
      }
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`check-apply-commands-boundary: FAIL — ${error.message}`);
    process.exitCode = 1;
  }
}
