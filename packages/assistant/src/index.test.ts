import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const execFileAsyncMinuteTimeout = 60_000;

const packageDir = dirname(fileURLToPath(import.meta.url)).replace(
  /\/src$/,
  "",
);
const builtEntry = resolve(packageDir, "dist/index.js");

describe("pi dependency smoke", () => {
  it("imports this package through its package export", async () => {
    const assistant = await import("@dashframe/assistant");
    expect(assistant.createReadTools).toBeDefined();
  }, 30_000);

  // This package is TS-only in source control (no dist/ is committed) — the
  // bun runtime and the Electron main bundle (esbuild, conditions: ["bun"])
  // both resolve it straight from src/index.ts, and neither ever needs a
  // built dist. Plain, unbundled Node cannot parse TS though, so to prove
  // the `build` script actually produces a Node-importable artifact (e.g.
  // for any future consumer that isn't bun/esbuild-bundled), this test
  // builds the package into the gitignored dist/ itself, then imports the
  // built file by absolute path — bypassing package export resolution
  // entirely, since a TS-only package has no Node-resolvable export target.
  beforeAll(async () => {
    await execFileAsync("bun", ["run", "build"], {
      cwd: packageDir,
      timeout: execFileAsyncMinuteTimeout,
    });
  }, execFileAsyncMinuteTimeout);

  it("imports the built dist through Node's module resolution", async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      "-e",
      `import(${JSON.stringify(pathToFileURL(builtEntry).href)}).then((m) => console.log(typeof m.createReadTools))`,
    ]);
    expect(stdout.trim()).toBe("function");
  }, 30_000);

  it("imports Agent from @earendil-works/pi-agent-core", async () => {
    const { Agent } = await import("@earendil-works/pi-agent-core");
    expect(Agent).toBeDefined();
  }, 30_000);

  it("imports getModel from @earendil-works/pi-ai", async () => {
    const { getModel } = await import("@earendil-works/pi-ai");
    expect(getModel).toBeDefined();
  }, 30_000);
});
