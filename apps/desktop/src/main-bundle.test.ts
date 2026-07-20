import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Electron main process is Node. Two failure classes have crashed it at
 * load with `ERR_MODULE_NOT_FOUND` and no window ever opened — this file guards
 * both over the built bundle's module graph, so a regression fails here at build
 * time instead of at runtime.
 *
 * 1. Browser-only code reaching main (#228). `@dashframe/connector-notion`
 *    value-imported `RemoteApiConnector` from the `@dashframe/engine-browser`
 *    barrel. That name is runtime-neutral and defined in `@dashframe/engine`,
 *    but engine-browser has no subpath exports, so the import pulled the whole
 *    barrel — IndexedDB storage and DuckDB-WASM — into main.js. `idb-keyval` is
 *    externalized by the build and undeclared in @dashframe/desktop, so Electron
 *    died on load. Guarded by "pulls in no browser-only code".
 *
 * 2. An externalized dep undeclared where main.js resolves it. build-main.mjs
 *    externalizes every npm bare specifier; each must then resolve at runtime
 *    from apps/desktop. `typebox`, `pg`, `@notionhq/client`, and the pi-ai
 *    packages were only declared on the workspace packages that use them, not on
 *    apps/desktop, and weren't hoisted — the loader halted on the first one.
 *    Guarded by "resolves every externalized dependency".
 */

const desktopRoot = path.resolve(__dirname, "..");

/** Substrings that must not appear in any resolved input path or import. */
const BROWSER_ONLY = [
  "engine-browser",
  "idb-keyval",
  "duckdb-wasm",
  "core-dexie",
];

type Metafile = {
  inputs: Record<string, { imports: { path: string; external?: boolean }[] }>;
};

function buildAndReadMetafile(): Metafile {
  // process.execPath, not "node" — a PATH lookup would run whichever runtime
  // happens to be first on PATH, and the build must run on the same one the
  // test does.
  execFileSync(process.execPath, ["scripts/build-main.mjs"], {
    cwd: desktopRoot,
    stdio: "pipe",
  });
  return JSON.parse(
    readFileSync(path.join(desktopRoot, "dist", "metafile.json"), "utf8"),
  ) as Metafile;
}

/** The bare-specifier npm packages esbuild left external in the bundle. */
function externalPackages(metafile: Metafile): string[] {
  const pkgs = new Set<string>();
  for (const meta of Object.values(metafile.inputs)) {
    for (const imp of meta.imports) {
      if (!imp.external) continue;
      if (imp.path.startsWith("node:") || imp.path.startsWith(".")) continue;
      // Reduce a subpath import ("typebox/value") to its package name.
      const name = imp.path.startsWith("@")
        ? imp.path.split("/").slice(0, 2).join("/")
        : (imp.path.split("/")[0] ?? imp.path);
      pkgs.add(name);
    }
  }
  return [...pkgs].sort();
}

describe("electron main bundle", () => {
  it("pulls in no browser-only code", () => {
    const metafile = buildAndReadMetafile();

    const bundled = Object.keys(metafile.inputs).filter((input) =>
      BROWSER_ONLY.some((needle) => input.includes(needle)),
    );

    const externals = Object.entries(metafile.inputs).flatMap(([input, meta]) =>
      meta.imports
        .filter(
          (imp) =>
            imp.external &&
            BROWSER_ONLY.some((needle) => imp.path.includes(needle)),
        )
        .map((imp) => `${input} → ${imp.path}`),
    );

    // Reported together so a failure names every offending path at once
    // rather than one per rerun.
    expect({ bundled, externals }).toEqual({ bundled: [], externals: [] });
  });

  it("resolves every externalized dependency from apps/desktop", () => {
    const packages = externalPackages(buildAndReadMetafile());

    // Resolve each with Node's real ESM resolver from the apps/desktop base —
    // the exact algorithm Electron's main process runs. `import.meta.resolve`
    // (not require.resolve, which can false-green on an exports-only package)
    // throws ERR_MODULE_NOT_FOUND when the specifier is undeclared or unhoisted.
    const unresolved = packages.filter((pkg) => {
      try {
        execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `await import.meta.resolve(${JSON.stringify(pkg)})`,
          ],
          { cwd: desktopRoot, stdio: "pipe" },
        );
        return false;
      } catch {
        return true;
      }
    });

    // A failure names the package to declare in apps/desktop/package.json.
    expect(unresolved).toEqual([]);
  });
});
