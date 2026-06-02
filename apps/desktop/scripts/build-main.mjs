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
 *     natively (CJS-from-ESM interop is fine). Native/WASM deps (pglite,
 *     postgres) must never be bundled at all.
 *
 * The filter auto-handles new transitive npm deps and new workspace packages
 * without editing an allowlist — but externalized npm deps must resolve at
 * runtime from apps/desktop, so they're declared as direct desktop deps.
 */
import esbuild from "esbuild";
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

await esbuild.build({
  entryPoints: [path.resolve(import.meta.dirname, "..", "src", "main.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.resolve(import.meta.dirname, "..", "dist", "main.js"),
  plugins: [externalizeNpm],
});
