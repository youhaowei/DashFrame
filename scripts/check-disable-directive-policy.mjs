#!/usr/bin/env node
// Keeps `dashframe/require-disable-reason` from being switched off in-band.
//
// The lint rule makes every disable directive name its rules and carry a
// reason. Oxlint applies disable directives before plugin reports, so a
// directive can suppress the rule that would reject that same directive.
// This repository check enforces that one invariant outside oxlint.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parseDisableDirective } from "./oxlint-plugin-dashframe.mjs";

export const PROTECTED_RULE = "dashframe/require-disable-reason";

const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/u;
const LINT_IGNORED_SOURCE_FILES = new Set([
  "apps/renderer/src/routeTree.gen.ts",
  "apps/web/next-env.d.ts",
  "apps/web/src/routeTree.gen.ts",
]);

function commentBody(content, range) {
  return range.kind === ts.SyntaxKind.SingleLineCommentTrivia
    ? content.slice(range.pos + 2, range.end)
    : content.slice(range.pos + 2, range.end - 2);
}

function commentRanges(content, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.getScriptKindFromFileName(fileName),
  );
  const ranges = new Map();
  const jsxTextSpans = [];

  function collectAt(position) {
    for (const getRanges of [
      ts.getLeadingCommentRanges,
      ts.getTrailingCommentRanges,
    ]) {
      for (const range of getRanges(content, position) ?? []) {
        ranges.set(range.pos, range);
      }
    }
  }

  function visit(node) {
    if (node.kind === ts.SyntaxKind.JsxText) {
      jsxTextSpans.push({ pos: node.pos, end: node.end });
    }
    collectAt(node.pos);
    collectAt(node.getStart(sourceFile));
    collectAt(node.end);
    for (const child of node.getChildren(sourceFile)) visit(child);
  }

  visit(sourceFile);
  return [...ranges.values()]
    .filter(
      (range) =>
        !jsxTextSpans.some(
          (span) => range.pos >= span.pos && range.pos < span.end,
        ),
    )
    .sort((a, b) => a.pos - b.pos);
}

export function findPolicyViolations(content, fileName = "source.ts") {
  const hits = [];
  for (const range of commentRanges(content, fileName)) {
    const directive = parseDisableDirective(commentBody(content, range));
    if (!directive) continue;
    let kind;
    if (directive.rules.length === 0) {
      kind = "blanket-disable";
    } else if (directive.rules.includes(PROTECTED_RULE)) {
      kind = "protected-rule-disable";
    }
    if (!kind) continue;
    const line = content.slice(0, range.pos).split("\n").length;
    hits.push({
      kind,
      line,
      text: content.slice(range.pos, range.end).replace(/\s+/gu, " ").trim(),
    });
  }
  return hits;
}

export function listTrackedSourceFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
  });
  return out
    .toString("utf8")
    .split("\0")
    .filter(
      (file) =>
        file &&
        SOURCE_EXTENSIONS.test(file) &&
        !file.startsWith("libs/") &&
        !LINT_IGNORED_SOURCE_FILES.has(file),
    );
}

export function findViolations(root) {
  const violations = [];
  for (const file of listTrackedSourceFiles(root)) {
    const content = readFileSync(join(root, file), "utf8");
    for (const hit of findPolicyViolations(content, file)) {
      violations.push({ file, ...hit });
    }
  }
  return violations;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const violations = findViolations(repoRoot);

  if (violations.length === 0) {
    console.log(
      "check-disable-directive-policy: OK — no blanket disables or disable-policy self-suppression.",
    );
    process.exit(0);
  }

  console.error(
    `check-disable-directive-policy: FAIL — ${violations.length} unsafe disable directive(s).\n` +
      "Every directive must name its rules, and none may disable the rule that enforces reasons.\n" +
      "Replace blanket disables and give each narrow directive a rule and a reason.\n",
  );
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line}  [${violation.kind}] ${violation.text}`,
    );
  }
  process.exit(1);
}
