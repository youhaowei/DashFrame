#!/usr/bin/env node
// Usage: node scripts/test-delta.mjs <base> <head> [--json]
// Lexical estimate: bare it/test calls, including modifiers and skipped cases.
// Literal each arrays count entries; dynamic/spread/tagged tables count as one.
// Aliases, loops, type arguments and runtime conditions are not resolved.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function tokenize(source) {
  // Consume comments and literals whole. Regex recognition is heuristic,
  // limited to expression-start positions; this is not a JS/TS parser.
  const pattern =
    // oxlint-disable-next-line sonarjs/regex-complexity -- one lexer alternation consumes comments and literals before code tokens
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|[\p{ID_Start}_$][\p{ID_Continue}$]*|\d+(?:\.\d+)?|\.\.\.|[^\s]/gu;
  const result = [];
  let match;
  while ((match = pattern.exec(source))) {
    const value = match[0];
    if (value.startsWith("//") || value.startsWith("/*")) continue;
    if (
      value === "/" &&
      /^(?:[=([,:;!&|?{}]|return)$/.test(result.at(-1) ?? "=")
    ) {
      const regex = /^\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\n\\])+\/[a-z]*/.exec(
        source.slice(match.index),
      );
      if (regex) {
        result.push("literal");
        pattern.lastIndex = match.index + regex[0].length;
        continue;
      }
    }
    result.push(/^["'`]/.test(value) ? "literal" : value);
  }
  return result;
}

function closing(tokens, start) {
  const stack = [];
  const pairs = { "(": ")", "[": "]", "{": "}" };
  for (let i = start; i < tokens.length; i++) {
    if (pairs[tokens[i]]) stack.push(pairs[tokens[i]]);
    else if (tokens[i] === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return tokens.length;
}

function tableSize(tokens, start, end) {
  if (tokens[start] !== "[" || closing(tokens, start) !== end - 1) return 1;
  let rows = 0;
  let entry = false;
  for (let i = start + 1; i < end - 1; i++) {
    const token = tokens[i];
    if (token === "...") return 1;
    if (token === ",") {
      rows++;
      entry = false;
    } else {
      entry = true;
      // oxlint-disable-next-line sonarjs/updated-loop-counter -- skip balanced nested row expressions as a single entry
      if (["[", "{", "("].includes(token)) i = closing(tokens, i);
    }
  }
  return rows + Number(entry);
}

export function countCases(source) {
  const tokens = tokenize(source);
  let total = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (
      !["it", "test"].includes(tokens[i]) ||
      [".", "?"].includes(tokens[i - 1])
    )
      continue;
    let cursor = i + 1;
    let cases = 1;
    while (tokens[cursor] === ".") {
      const modifier = tokens[cursor + 1];
      if (
        ![
          "each",
          "skipIf",
          "runIf",
          "skip",
          "only",
          "concurrent",
          "sequential",
          "todo",
          "fails",
          "failing",
        ].includes(modifier)
      )
        break;
      cursor += 2;
      if (modifier === "each" && tokens[cursor] === "(") {
        const end = closing(tokens, cursor);
        cases = tableSize(tokens, cursor + 1, end);
        cursor = end + 1;
      } else if (modifier === "each" && tokens[cursor] === "literal") {
        cursor++;
      } else if (
        ["skipIf", "runIf"].includes(modifier) &&
        tokens[cursor] === "("
      ) {
        cursor = closing(tokens, cursor) + 1;
      }
    }
    if (tokens[cursor] === "(") total += cases;
  }
  return total;
}

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function testDelta(base, head, cwd = process.cwd()) {
  // Resolve refs once with option parsing terminated; never use a shell.
  const refs = [base, head].map((ref) =>
    git(
      ["rev-parse", "--verify", "--end-of-options", ref + "^{commit}"],
      cwd,
    ).trim(),
  );
  const eligible = (path) =>
    /\.(?:test\.tsx?|spec\.ts)$/.test(path) &&
    !/(?:^|\/)(?:libs|node_modules)\//.test(path);
  const changes = git(
    ["diff", "--name-status", "-z", "-M", ...refs, "--"],
    cwd,
  ).split("\0");
  const files = [];
  while (changes.length > 1) {
    const status = changes.shift();
    const oldPath = changes.shift();
    const newPath = status.startsWith("R") ? changes.shift() : oldPath;
    const before =
      status !== "A" && eligible(oldPath)
        ? countCases(git(["show", refs[0] + ":" + oldPath], cwd))
        : 0;
    const after =
      status !== "D" && eligible(newPath)
        ? countCases(git(["show", refs[1] + ":" + newPath], cwd))
        : 0;
    if (before !== after)
      files.push({
        file: status === "D" ? oldPath : newPath,
        ...(oldPath !== newPath ? { previousFile: oldPath } : {}),
        before,
        after,
        delta: after - before,
      });
  }
  files.sort((a, b) => b.delta - a.delta || a.file.localeCompare(b.file));
  return {
    base: refs[0],
    head: refs[1],
    delta: files.reduce((sum, file) => sum + file.delta, 0),
    files,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [base, head, format] = process.argv.slice(2);
  if (!base || !head || (format && format !== "--json")) {
    console.error("Usage: node scripts/test-delta.mjs <base> <head> [--json]");
    process.exitCode = 1;
  } else {
    const result = testDelta(base, head);
    console.log(
      format === "--json"
        ? JSON.stringify(result)
        : [
            "Net test cases: " + (result.delta >= 0 ? "+" : "") + result.delta,
            ...result.files.map(
              ({ file, delta }) =>
                (delta >= 0 ? "+" : "") + delta + "\t" + file,
            ),
          ].join("\n"),
    );
  }
}
