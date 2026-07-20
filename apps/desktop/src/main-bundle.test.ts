import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Electron main process is Node. Browser-only code must never reach it.
 *
 * Regression guard for #228: `@dashframe/connector-notion` value-imported
 * `RemoteApiConnector` from the `@dashframe/engine-browser` barrel. That name
 * is runtime-neutral and defined in `@dashframe/engine`, but engine-browser has
 * no subpath exports, so the import pulled the whole barrel — IndexedDB storage
 * and DuckDB-WASM — into main.js. `idb-keyval` is externalized by the build and
 * is not a dependency of @dashframe/desktop, so Electron died on load with
 * ERR_MODULE_NOT_FOUND and no window ever opened.
 *
 * A grep over main.js would only catch today's symptom. This asserts over the
 * module graph, so any future reach-through fails here instead of at runtime.
 */

const desktopRoot = path.resolve(__dirname, "..");

/** Substrings that must not appear in any resolved input path or import. */
const BROWSER_ONLY = [
  "engine-browser",
  "idb-keyval",
  "duckdb-wasm",
  "core-dexie",
];

function buildAndReadMetafile() {
  // process.execPath, not "node" — a PATH lookup would run whichever runtime
  // happens to be first on PATH, and the build must run on the same one the
  // test does.
  execFileSync(process.execPath, ["scripts/build-main.mjs"], {
    cwd: desktopRoot,
    stdio: "pipe",
  });
  return JSON.parse(
    readFileSync(path.join(desktopRoot, "dist", "metafile.json"), "utf8"),
  ) as {
    inputs: Record<string, { imports: { path: string; external?: boolean }[] }>;
  };
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
});
