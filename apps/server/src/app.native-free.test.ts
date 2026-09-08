import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

it("imports the app factory in a fresh Bun process without loading DuckDB's native API", () => {
  const probe = spawnSync(
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- The repo requires Bun on PATH; this test exercises that runtime.
    "bun",
    [
      "--eval",
      `
    const { createDashframeServer } = await import("./app.ts");
    if (typeof createDashframeServer !== "function") throw new Error("App factory was not imported");
    const nativeModules = Object.keys(require.cache).filter(path => path.includes("@duckdb/node-api"));
    if (nativeModules.length) throw new Error("Native DuckDB API loaded: " + nativeModules[0]);
    console.log("native-free app factory");
  `,
    ],
    {
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      encoding: "utf8",
      timeout: 20_000,
    },
  );
  expect(probe.error).toBeUndefined();
  expect(probe.status, probe.stderr).toBe(0);
  expect(probe.stdout.trim()).toBe("native-free app factory");
});
