import { access } from "node:fs/promises";
import path from "node:path";

export async function assertPackagedLayout(resources, platform) {
  const executable =
    platform === "win32" ? "convex-local-backend.exe" : "convex-local-backend";
  const required = [
    "app/desktop/dist/main.js",
    "app/desktop/dist/preload.cjs",
    "app/renderer/dist/index.html",
    "app/node_modules/convex/bin/main.js",
    `convex/${executable}`,
    "convex/LICENSE.md",
    "convex/functions/convex.json",
    "convex/functions/package.json",
    "convex/functions/node_modules/convex/package.json",
    "convex/functions/convex/app.js",
    "convex/functions/convex/host.js",
    "convex/functions/convex/schema.js",
    "convex/functions/convex/auth.config.js",
  ];
  for (const file of required) {
    try {
      await access(path.join(resources, file));
    } catch {
      throw new Error(
        `Desktop package is missing required runtime resource: ${file}`,
      );
    }
  }
}
