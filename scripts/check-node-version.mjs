#!/usr/bin/env node
// Fail fast when the Node.js on PATH is older than Vite+ supports. An older
// runtime installs cleanly and then every `vp` command dies at startup with a
// `styleText` import error, which is a confusing place to learn about it.
//
// The range comes from the root package.json `engines.node` field so there is
// one source of truth. Only the range forms used there are parsed: `^X.Y.Z`,
// `>=X.Y.Z`, and `||` between them.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const range = manifest.engines?.node;
if (typeof range !== "string" || range.trim() === "") {
  console.error("check-node-version: package.json has no engines.node range.");
  process.exit(1);
}

const parse = (version) => version.split(".").map((part) => Number(part));
const compare = (a, b) => {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
};

function satisfies(actual, clause) {
  const match = /^(\^|>=)(\d+)\.(\d+)\.(\d+)$/.exec(clause.trim());
  if (!match) {
    throw new Error(`unsupported engines.node clause: ${clause}`);
  }
  const [, operator, ...rest] = match;
  const minimum = rest.map(Number);
  if (compare(actual, minimum) < 0) return false;
  return operator === ">=" || actual[0] === minimum[0];
}

const actual = parse(process.versions.node);
const ok = range.split("||").some((clause) => satisfies(actual, clause));
if (!ok) {
  console.error(
    `check-node-version: Node.js ${process.versions.node} is on PATH, but this repository needs ${range} (see .node-version).`,
  );
  process.exit(1);
}
console.log(
  `check-node-version: OK — Node.js ${process.versions.node} satisfies ${range}.`,
);
