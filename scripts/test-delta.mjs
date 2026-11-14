#!/usr/bin/env node
// Usage: node scripts/test-delta.mjs <base> <head> [--json]
// Lexical estimate: bare it/test calls, including modifiers and skipped cases.
// Literal each arrays count entries; dynamic/spread/tagged tables count as one.
// Aliases, loops and runtime conditions are not resolved.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Regex bodies are scanned once without backtracking, including escaped
// characters and bracket classes. Unclosed candidates leave the slash intact.
const LINE_BREAK = /[\r\n\u2028\u2029]/u;

function regexEnd(source, start, cache) {
  let inClass = false;
  let cursor = start + 1;
  let end = 0;
  const visited = [];
  while (cursor < source.length && !LINE_BREAK.test(source[cursor])) {
    // Reuse suffix results at slashes, keyed by character-class state. Failed
    // candidates can fall back without repeatedly scanning the same suffix.
    if (source[cursor] === "/") {
      const key = cursor * 2 + Number(inClass);
      if (cache.has(key)) {
        end = cache.get(key);
        break;
      }
      visited.push(key);
    }
    const char = source[cursor++];
    if (char === "\\") {
      if (LINE_BREAK.test(source[cursor])) break;
      cursor++;
    } else if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) {
      while (/[a-z]/i.test(source[cursor] ?? "")) cursor++;
      end = cursor;
      break;
    }
  }
  for (const key of visited) cache.set(key, end);
  return end || start + 1;
}

function quotedEnd(source, start) {
  const quote = source[start];
  const multiline = quote === String.fromCharCode(96);
  let cursor = start + 1;
  while (cursor < source.length) {
    const char = source[cursor++];
    if (!multiline && /[\r\n]/u.test(char)) return start + 1;
    if (char === "\\") {
      // A backslash continues a quoted string across LF, CR or CRLF.
      if (source[cursor] === "\r" && source[cursor + 1] === "\n") cursor++;
      cursor++;
    } else if (char === quote) return cursor;
  }
  return start + 1;
}

const REGEX_PREFIXES = new Set([
  "=>",
  "=",
  "(",
  "[",
  "{",
  "}",
  ",",
  ":",
  ";",
  "!",
  "~",
  "?",
  "+",
  "-",
  "*",
  "/",
  "%",
  "&",
  "|",
  "^",
  "<",
  ">",
  "return",
  "throw",
  "yield",
  "await",
  "case",
  "delete",
  "void",
  "typeof",
  "new",
  "in",
  "instanceof",
  "else",
  "do",
]);

function tokenize(source) {
  // This is a lexical estimate, not a JS/TS parser. Literal scans use no
  // backtracking or overlapping, quantified regex alternatives.
  const identifier = /[\p{ID_Start}_$][\p{ID_Continue}$]*/uy;
  const number = /\d+(?:\.\d+)?/y;
  const compound = /=>|\+\+|--|\.\.\.|\?\./y;
  const result = [];
  const regexCache = new Map();
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (/\s/u.test(char)) {
      cursor++;
    } else if (source.startsWith("//", cursor)) {
      const end = source.indexOf("\n", cursor + 2);
      cursor = end < 0 ? source.length : end + 1;
    } else if (source.startsWith("/*", cursor)) {
      const end = source.indexOf("*/", cursor + 2);
      cursor = end < 0 ? source.length : end + 2;
    } else if (['"', "'", String.fromCharCode(96)].includes(char)) {
      const end = quotedEnd(source, cursor);
      result.push(end === cursor + 1 ? char : "literal");
      cursor = end;
    } else if (
      char === "/" &&
      (result.length === 0 || REGEX_PREFIXES.has(result.at(-1)))
    ) {
      const end = regexEnd(source, cursor, regexCache);
      result.push(end === cursor + 1 ? char : "literal");
      cursor = end;
    } else {
      identifier.lastIndex = cursor;
      number.lastIndex = cursor;
      compound.lastIndex = cursor;
      const token =
        identifier.exec(source)?.[0] ??
        number.exec(source)?.[0] ??
        compound.exec(source)?.[0] ??
        char;
      result.push(token);
      cursor += token.length;
    }
  }
  return result;
}

const BRACKETS = { "(": ")", "[": "]", "{": "}" };

function closing(tokens, start, pairs = BRACKETS) {
  const stack = [];
  for (let i = start; i < tokens.length; i++) {
    if (Object.hasOwn(pairs, tokens[i])) stack.push(pairs[tokens[i]]);
    else if (
      tokens[i] === stack.at(-1) &&
      !(tokens[i] === ">" && tokens[i - 1] === "=")
    ) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return tokens.length;
}

function tableSize(tokens, start, end) {
  if (tokens[start] !== "[") return 1;
  const arrayEnd = closing(tokens, start);
  // Type assertions do not change the number of literal rows.
  if (
    arrayEnd !== end - 1 &&
    !["as", "satisfies"].includes(tokens[arrayEnd + 1])
  )
    return 1;
  end = arrayEnd + 1;
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
      [".", "?", "?."].includes(tokens[i - 1])
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
      if (modifier === "each" && tokens[cursor] === "<") {
        cursor =
          closing(tokens, cursor, { "<": ">", "(": ")", "[": "]", "{": "}" }) +
          1;
      }
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
  // Count only this branch's changes, while retaining the base tip below for
  // the comment writer's stale-run check.
  const mergeBase = git(["merge-base", ...refs], cwd).trim();
  const eligible = (path) =>
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) &&
    !/(?:^|\/)(?:libs|node_modules)\//.test(path);
  const changes = git(
    ["diff", "--name-status", "-z", "-M", mergeBase, refs[1], "--"],
    cwd,
  ).split("\0");
  const files = [];
  while (changes.length > 1) {
    const status = changes.shift();
    const oldPath = changes.shift();
    const newPath = status.startsWith("R") ? changes.shift() : oldPath;
    const before =
      status !== "A" && eligible(oldPath)
        ? countCases(git(["show", mergeBase + ":" + oldPath], cwd))
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
    mergeBase,
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
