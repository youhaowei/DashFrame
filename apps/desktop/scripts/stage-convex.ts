import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import {
  backendExecutableName,
  verifyBackendBinary,
} from "@dashframe/convex-local";

// Stage this directory as Electron extraResources/convex, outside app.asar.
const destination = path.resolve(
  process.argv[2] ?? path.join(import.meta.dirname, "../dist/convex"),
);
const require = createRequire(import.meta.url);
const source = path.dirname(
  require.resolve("@dashframe/convex-backend/package.json"),
);
const convex = path.dirname(require.resolve("convex/package.json"));
const binary = await verifyBackendBinary(process.env.DASHFRAME_CONVEX_BINARY);
const functions = path.join(destination, "functions");
await mkdir(functions, { recursive: true });
await cp(binary, path.join(destination, backendExecutableName()));
await cp(
  path.join(path.dirname(binary), "LICENSE.md"),
  path.join(destination, "LICENSE.md"),
);
await cp(convex, path.join(functions, "node_modules/convex"), {
  recursive: true,
});
await writeFile(
  path.join(functions, "package.json"),
  JSON.stringify({
    name: "dashframe-convex-functions",
    private: true,
    type: "module",
    dependencies: { convex: "1.37.0" },
  }),
);
await writeFile(
  path.join(functions, "convex.json"),
  await readFile(path.join(source, "convex.json")),
);
const entries = (await readdir(path.join(source, "convex")))
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))
  .map((file) => path.join(source, "convex", file));
// Discard prior generated modules so removed or renamed functions cannot ship.
await rm(path.join(functions, "convex"), { recursive: true, force: true });
await build({
  entryPoints: entries,
  outdir: path.join(functions, "convex"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  conditions: ["import", "default"],
  external: ["convex/*"],
  sourcemap: false,
});
console.log(`Staged local Convex resources at ${destination}`);
