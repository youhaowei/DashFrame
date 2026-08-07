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
// Scope: every entry-point source file listed in each wystack package's
// `package.json` `exports` map (not just the default `src/index.ts` —
// subpath exports like `./node` -> `src/serve-node.ts` or `./routes` ->
// `src/routes.ts` are just as much public surface) — specifically the text
// of each file's `export ...` statements (re-exports, and any inline
// `export interface` / `export function` / `export const` declarations),
// not arbitrary prose. A file's header comment or an internal implementation
// detail mentioning "provider dashboard" in passing does not trip this
// check; only what the statement actually exports/names does.
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
// Exit code: 0 = clean, 1 = violations found, 78 = could not run because the
// wystack submodule is not checked out (a skip, not a pass — see below).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DOMAIN_NOUNS = ["insight", "dashboard", "visualization", "datasource"];

const repoRoot = join(fileURLToPath(import.meta.url), "../..");
const wystackPackagesDir = join(repoRoot, "libs/wystack/packages");

/**
 * Resolve one `exports` map entry (a string, or a conditions object like
 * `{ types, bun, import }`) down to the `.ts` source file it points at.
 * Prefers the `bun` condition (already a `src/*.ts` path in every wystack
 * package). Falls back to deriving a source path from `types`/`import`
 * (`dist/X.d.ts` / `dist/X.js` -> `src/X.ts`) for packages that don't
 * publish a `bun` condition (e.g. types, version, permissions).
 */
function resolveEntryPointSourceFile(pkgDir, exportValue) {
  let target;
  if (typeof exportValue === "string") {
    target = exportValue;
  } else if (exportValue && typeof exportValue === "object") {
    target = exportValue.bun ?? exportValue.import ?? exportValue.types;
  }
  if (!target) return null;
  if (target.includes("/dist/")) {
    target = target
      .replace("/dist/", "/src/")
      .replace(/\.d\.ts$/, ".ts")
      .replace(/\.js$/, ".ts");
  }
  if (!target.endsWith(".ts") && !target.endsWith(".tsx")) return null;
  return join(pkgDir, target);
}

/**
 * Collect every entry-point source file named in a package's `exports` map
 * (all subpaths, not just `.`), deduped by resolved path.
 */
function findPackageEntryPoints(pkgDir) {
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) return [];
  let pkgJson;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  } catch {
    return [];
  }
  const exportsMap = pkgJson.exports;
  if (!exportsMap || typeof exportsMap !== "object") return [];

  const resolved = new Set();
  for (const exportValue of Object.values(exportsMap)) {
    const file = resolveEntryPointSourceFile(pkgDir, exportValue);
    if (file && existsSync(file)) resolved.add(file);
  }
  return [...resolved];
}

/**
 * Returns { files, submoduleMissing }. When the wystack submodule isn't
 * checked out there are no files to scan — that is NOT the same as "clean",
 * so callers must handle submoduleMissing explicitly rather than falling
 * through to the normal zero-violations success path.
 */
function findEntryPointFiles() {
  if (!existsSync(wystackPackagesDir)) {
    return { files: [], submoduleMissing: true };
  }
  const files = [];
  for (const pkg of readdirSync(wystackPackagesDir, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    files.push(...findPackageEntryPoints(join(wystackPackagesDir, pkg.name)));
  }
  return { files, submoduleMissing: false };
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

const { files: entryPointFiles, submoduleMissing } = findEntryPointFiles();

if (submoduleMissing) {
  console.warn(
    `check-wystack-domain-nouns: SKIPPED (submodule absent) — ${wystackPackagesDir} not found. ` +
      `libs/wystack is not checked out, so its exported surface could not be scanned. ` +
      `This is not a pass — run \`git submodule update --init\` and re-run this check before relying on it.`,
  );
  // Exit 78 (EX_CONFIG), not 0. "Could not run" must not be reportable as
  // "passed": scripts/run-checks.mjs maps this code to SKIP and fails the
  // aggregate gate, so an uninitialized submodule can never produce an
  // all-PASS summary. CI checks out `submodules: recursive`, so this branch is
  // unreachable there — it only fires on an unprepared local checkout, where
  // the fix is the command named above.
  process.exit(78);
}

const violations = [];

for (const file of entryPointFiles) {
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
    `check-wystack-domain-nouns: OK — ${entryPointFiles.length} wystack package entry-point file(s) clean of DashFrame domain nouns.`,
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
