import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import { assertPackagedLayout } from "./package-layout.mjs";

const temporary = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function fixture() {
  const resources = await mkdtemp(
    path.join(tmpdir(), "dashframe-package-layout-"),
  );
  temporary.push(resources);
  for (const file of [
    "app/desktop/dist/main.js",
    "app/desktop/dist/preload.cjs",
    "app/renderer/dist/index.html",
    "app/node_modules/convex/bin/main.js",
    "convex/convex-local-backend",
    "convex/LICENSE.md",
    "convex/functions/convex.json",
    "convex/functions/package.json",
    "convex/functions/node_modules/convex/package.json",
    "convex/functions/convex/app.js",
    "convex/functions/convex/host.js",
    "convex/functions/convex/schema.js",
    "convex/functions/convex/auth.config.js",
  ]) {
    await mkdir(path.dirname(path.join(resources, file)), { recursive: true });
    await writeFile(path.join(resources, file), "fixture");
  }
  return resources;
}
it("accepts the host layout with Convex outside the application directory", async () => {
  await assertPackagedLayout(await fixture(), "darwin");
});
it("rejects a package that omitted the staged backend", async () => {
  const resources = await fixture();
  await rm(path.join(resources, "convex/convex-local-backend"));
  await expect(assertPackagedLayout(resources, "darwin")).rejects.toThrow(
    "convex/convex-local-backend",
  );
});
it("rejects missing deployable functions even when the executable is present", async () => {
  const resources = await fixture();
  await rm(path.join(resources, "convex/functions/convex/host.js"));
  await expect(assertPackagedLayout(resources, "darwin")).rejects.toThrow(
    "convex/functions/convex/host.js",
  );
});
it("requires the Windows executable name for Windows packages", async () => {
  const resources = await fixture();
  await expect(assertPackagedLayout(resources, "win32")).rejects.toThrow(
    "convex-local-backend.exe",
  );
  await writeFile(
    path.join(resources, "convex/convex-local-backend.exe"),
    "fixture",
  );
  await assertPackagedLayout(resources, "win32");
});
