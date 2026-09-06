#!/usr/bin/env node
/**
 * Bundle the Electron main process.
 *
 * The rule: inline the workspace TypeScript packages (`@wystack/*`,
 * `@dashframe/*`), externalize every npm registry package.
 *
 * Why a filter, not a flag list:
 *   - Workspace packages ship TS source / extensionless-import dist that
 *     Electron's Node 20 ESM loader can't load directly — they MUST be bundled
 *     so esbuild resolves their relative imports at build time.
 *   - npm packages must stay external. CJS ones (ws, @hono/node-server) call
 *     Node built-in `require()`; esbuild's __require shim throws on those when
 *     they're inlined into an ESM bundle. Left external, Node loads them
 *     natively (CJS-from-ESM interop is fine). Native dependencies such as
 *     @duckdb/node-api must never be bundled — the DuckDB
 *     bindings are a native `.node` addon. The filter externalizes them
 *     automatically (non-`@dashframe`/`@wystack` bare specifier); they resolve
 *     at runtime from apps/desktop, hence the direct `@duckdb/node-api` dep.
 *     The unsigned package pipeline keeps dependencies unpacked so native
 *     addons and the Convex CLI executable remain on the real filesystem.
 *
 * The filter auto-handles new transitive npm deps and new workspace packages
 * without editing an allowlist — but externalized npm deps must resolve at
 * runtime from apps/desktop, so they're declared as direct desktop deps.
 *
 * conditions: ["bun"] tells esbuild to prefer the "bun" export condition when
 * resolving workspace packages — that condition maps to ./src/index.ts (raw
 * TypeScript source). esbuild merges this with the platform:"node" defaults,
 * so workspace packages are resolved from src while npm packages continue to
 * resolve via Node's default condition. This is what makes all @dashframe/*
 * packages TS-main: no per-package dist is needed for the Electron bundle.
 */
import esbuild from "esbuild";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const externalizeNpm = {
  name: "externalize-npm",
  setup(build) {
    // Bare specifiers only (not "./x" or "../x"). Inline workspace scopes;
    // externalize everything else (npm packages + node: builtins).
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (
        args.path.startsWith("@wystack/") ||
        args.path.startsWith("@dashframe/")
      ) {
        return undefined; // inline — let esbuild resolve + bundle it
      }
      return { path: args.path, external: true };
    });
  },
};

const result = await esbuild.build({
  entryPoints: [path.resolve(import.meta.dirname, "..", "src", "main.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  conditions: ["bun"],
  outfile: path.resolve(import.meta.dirname, "..", "dist", "main.js"),
  plugins: [externalizeNpm],
  // Emitted so the bundle's module graph is inspectable. `main-bundle.test.ts`
  // asserts no browser-only code reached this Node process — see #228, where a
  // value import of the @dashframe/engine-browser barrel pulled IndexedDB
  // storage into main.js and Electron failed to boot on an undeclared dep.
  metafile: true,
});

await writeFile(
  path.resolve(import.meta.dirname, "..", "dist", "metafile.json"),
  JSON.stringify(result.metafile),
);
