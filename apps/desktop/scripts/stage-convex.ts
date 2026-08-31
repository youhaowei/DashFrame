import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import { verifyBackendBinary } from "@dashframe/convex-local";

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
await cp(binary, path.join(destination, "convex-local-backend"));
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
await build({
  entryPoints: entries,
  outdir: path.join(functions, "convex"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  conditions: ["import", "default"],
  external: ["convex/*"],
  sourcemap: false,
});
console.log(`Staged local Convex resources at ${destination}`);
