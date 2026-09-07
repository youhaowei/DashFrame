/** Build the fixed worker runtime locally; never downloads or deploys anything. */
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engineRoot = resolve(root, "packages/engine-server");
const requireEngine = createRequire(resolve(engineRoot, "package.json"));
const { build } = requireEngine("esbuild") as typeof import("esbuild");
if (process.platform !== "linux")
  throw new Error("Query sandbox requires Linux");
await mkdir(resolve(root, ".data"), { recursive: true });
// A fresh output prevents stale bundles or unexpected files gaining a read grant.
const output = await mkdtemp(resolve(root, ".data/query-sandbox-"));
try {
  execFileSync(
    process.env.CC ?? "cc",
    [
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      resolve(engineRoot, "sandbox/query-launcher.c"),
      "-o",
      resolve(output, "query-launcher"),
    ],
    { stdio: "inherit" },
  );
  await build({
    entryPoints: [resolve(engineRoot, "src/sandbox-worker.ts")],
    outfile: resolve(output, "worker.cjs"),
    platform: "node",
    target: "node24",
    format: "cjs",
    bundle: true,
    external: ["@duckdb/node-bindings"],
    logLevel: "warning",
  });
  const apiRequire = createRequire(requireEngine.resolve("@duckdb/node-api"));
  const bindingsEntry = apiRequire.resolve("@duckdb/node-bindings");
  const bindingsRoot = dirname(bindingsEntry);
  const bindingsRequire = createRequire(bindingsEntry);
  const manifest = JSON.parse(
    await readFile(resolve(bindingsRoot, "package.json"), "utf8"),
  ) as {
    dependencies: Record<string, string>;
    optionalDependencies: Record<string, string>;
  };
  await cp(
    bindingsRoot,
    resolve(output, "node_modules/@duckdb/node-bindings"),
    { recursive: true, dereference: true },
  );
  const candidates = [
    ...Object.keys(manifest.dependencies),
    ...Object.keys(manifest.optionalDependencies).filter(
      (name) => name === `@duckdb/node-bindings-linux-${process.arch}`,
    ),
  ];
  for (const name of candidates) {
    const packageFile = bindingsRequire.resolve(`${name}/package.json`);
    await cp(dirname(packageFile), resolve(output, "node_modules", name), {
      recursive: true,
      dereference: true,
    });
  }
  await writeFile(
    resolve(output, "manifest.json"),
    JSON.stringify({
      version: 1,
      platform: process.platform,
      arch: process.arch,
      worker: "worker.cjs",
    }) + "\n",
  );
  console.log(output);
} catch (error) {
  await rm(output, { recursive: true, force: true });
  throw error;
}
