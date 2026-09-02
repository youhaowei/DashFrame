import path from "node:path";
import { createRequire } from "node:module";
import { Arch } from "electron-builder";
import { assertPackagedLayout } from "./scripts/package-layout.mjs";
const require = createRequire(import.meta.url);

export default {
  appId: "com.dashframe.desktop",
  productName: "DashFrame",
  directories: { output: "dist/package" },
  // Keep CLI executables and native dependencies on the real filesystem.
  // Signed/archived distribution is a separate release concern.
  asar: false,
  npmRebuild: false,
  electronDist:
    path.dirname(require.resolve("electron/package.json")) + "/dist",
  extraMetadata: { main: "desktop/dist/main.js" },
  files: [
    "package.json",
    { from: "dist", to: "desktop/dist", filter: ["main.js", "preload.cjs"] },
    { from: "assets", to: "desktop/assets" },
    { from: "../renderer/dist", to: "renderer/dist" },
  ],
  extraResources: [{ from: "dist/convex", to: "convex" }],
  beforePack(context) {
    if (
      context.electronPlatformName !== process.platform ||
      Arch[context.arch] !== process.arch
    ) {
      throw new Error(
        "package:dir supports only the current host platform and architecture; stage and verify other targets on their own hosts.",
      );
    }
  },
  afterPack(context) {
    return assertPackagedLayout(
      context.packager.getResourcesDir(context.appOutDir),
      context.electronPlatformName,
    );
  },
  mac: { identity: null },
};
