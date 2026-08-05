#!/usr/bin/env node
// Enforces the "wystack is domain-agnostic" boundary.
//
// libs/wystack is a general-purpose reactive data framework — it must not know
// about DashFrame's domain vocabulary (Insight, Dashboard, Visualization,
// DataSource). Those nouns belong in DashFrame's own packages (@dashframe/*),
// layered ON TOP of wystack's mechanism. A DashFrame noun leaking into
// wystack's exported type surface would mean the "SQL-agnostic, domain-
// agnostic mechanism" boundary the architecture depends on has been breached.
//
// Scope: each wystack package's public barrel (`src/index.ts`) — specifically
// the text of its `export ...` statements (re-exports, and any inline
// `export interface` / `export function` / `export const` declarations),
// not arbitrary prose. A barrel file's header comment or an internal
// implementation detail mentioning "provider dashboard" in passing does not
// trip this check; only what the statement actually exports/names does.
//
// Matching is substring-based (no word-boundary requirement) so a compound
// identifier like `DashboardConfig` or `InsightSource` is caught even though
// "dashboard"/"insight" has no non-word character on one side of it.
//
// libs/wystack is a git submodule (separate repo) — this check only READS it,
// never modifies it. If it fails, the fix is in wystack (rename/remove the
// leaked export), not in DashFrame.
//
// Usage: node scripts/check-wystack-domain-nouns.mjs
// Exit code: 0 = clean, 1 = violations found.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DOMAIN_NOUNS = ["insight", "dashboard", "visualization", "datasource"];

const repoRoot = join(fileURLToPath(import.meta.url), "../..");
const wystackPackagesDir = join(repoRoot, "libs/wystack/packages");

function findBarrelFiles() {
  if (!existsSync(wystackPackagesDir)) {
    // Submodule not checked out — nothing to check, but don't silently pass
    // as "clean" without saying why.
    console.warn(
      `check-wystack-domain-nouns: SKIP — ${wystackPackagesDir} not found (submodule not initialized?).`,
    );
    return [];
  }
  const files = [];
  for (const pkg of readdirSync(wystackPackagesDir, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const barrel = join(wystackPackagesDir, pkg.name, "src", "index.ts");
    if (existsSync(barrel)) files.push(barrel);
  }
  return files;
}

/**
 * Return the line numbers (1-indexed) that belong to a top-level `export ...`
 * statement — the opening line through its matching closing brace, so a
 * multi-line `export type { A, B, C } from './x'` block (common in these
 * barrels) is captured in full, not just its first line. Statements with no
 * braces (`export * from './x'`) are single-line by construction.
 */
function findExportRegionLines(lines) {
  const regionLineNumbers = [];
  let depth = 0;
  let inExport = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inExport && /^\s*export\b/.test(line)) {
      inExport = true;
      depth = 0;
    }
    if (inExport) {
      regionLineNumbers.push(i);
      depth += (line.match(/{/g) ?? []).length;
      depth -= (line.match(/}/g) ?? []).length;
      if (depth <= 0) inExport = false;
    }
  }
  return regionLineNumbers;
}

/** Strip a trailing `from '...'`/`from "..."` module specifier, plus any
 * trailing line comment, so a match can't come from a file path or comment
 * riding along on an export line. */
function stripNonExportedText(line) {
  return line
    .replace(/from\s*['"][^'"]*['"]\s*;?\s*$/, "")
    .replace(/\/\/.*$/, "");
}

const barrelFiles = findBarrelFiles();
const violations = [];

for (const file of barrelFiles) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  const regionLineNumbers = findExportRegionLines(lines);
  for (const idx of regionLineNumbers) {
    const cleaned = stripNonExportedText(lines[idx]).toLowerCase();
    for (const noun of DOMAIN_NOUNS) {
      if (cleaned.includes(noun)) {
        violations.push({
          file: file.replace(repoRoot + "/", ""),
          line: idx + 1,
          noun,
          text: lines[idx].trim(),
        });
      }
    }
  }
}

if (violations.length === 0) {
  console.log(
    `check-wystack-domain-nouns: OK — ${barrelFiles.length} wystack package barrel(s) clean of DashFrame domain nouns.`,
  );
  process.exit(0);
}

console.error(
  `check-wystack-domain-nouns: FAIL — ${violations.length} DashFrame domain noun(s) found in wystack's exported type surface.\n` +
    `libs/wystack must stay domain-agnostic — Insight/Dashboard/Visualization/DataSource are\n` +
    `DashFrame vocabulary and belong in @dashframe/* packages, not in wystack's public exports.\n` +
    `(libs/wystack is a submodule — fix it there, this repo cannot edit it.)\n`,
);

for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  "${v.noun}"  —  ${v.text}`);
}

process.exit(1);
