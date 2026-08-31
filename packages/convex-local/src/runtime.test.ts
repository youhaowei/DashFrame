import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vite-plus/test";
import type { FunctionReference } from "convex/server";
import { makeFunctionReference } from "convex/server";
import { startLocalConvex } from "./runtime.js";
import { verifyBackendBinary } from "./binary.js";

describe("official local Convex lifecycle", () => {
  it("fails closed when the pinned binary is missing", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "dashframe-convex-missing-"),
    );
    try {
      await expect(
        verifyBackendBinary(path.join(directory, "missing")),
      ).rejects.toThrow(/missing|macOS/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.env.DASHFRAME_CONVEX_INTEGRATION !== "1")(
    "provisions offline, rejects a second owner, persists mutations, and closes both launches",
    async () => {
      const directory = await mkdtemp(
        path.join(tmpdir(), "dashframe-convex-lifecycle-"),
      );
      const functionsDirectory = path.join(directory, "functions");
      const projectDir = path.join(directory, "project");
      await mkdir(path.join(functionsDirectory, "convex"), { recursive: true });
      await writeFile(
        path.join(functionsDirectory, "package.json"),
        JSON.stringify({
          name: "runtime-fixture",
          type: "module",
          dependencies: { convex: "1.37.0" },
        }),
      );
      await writeFile(
        path.join(functionsDirectory, "convex.json"),
        JSON.stringify({ functions: "convex/" }),
      );
      const require = createRequire(import.meta.url);
      await mkdir(path.join(functionsDirectory, "node_modules"));
      await symlink(
        path.dirname(require.resolve("convex/package.json")),
        path.join(functionsDirectory, "node_modules/convex"),
      );
      await writeFile(
        path.join(functionsDirectory, "convex/host.ts"),
        `
import { internalQueryGeneric as internalQuery, internalMutationGeneric as internalMutation } from "convex/server";
import { v } from "convex/values";
export const runtimeReady = internalQuery({args:{},returns:v.object({ready:v.boolean()}),handler:async()=>({ready:true})});
export const write = internalMutation({args:{value:v.string()},returns:v.null(),handler:async(ctx,args)=>{await ctx.db.insert("values",args);return null;}});
export const read = internalQuery({args:{},returns:v.array(v.string()),handler:async(ctx)=>(await ctx.db.query("values").take(10)).map(row=>row.value)});
`,
      );
      const options = {
        projectDir,
        functionsDirectory,
        auth: {
          issuer: "https://dashframe.local/test",
          jwksDataUri: "data:application/json;base64,eyJrZXlzIjpbXX0=",
          audience: "dashframe" as const,
        },
      };
      const write = makeFunctionReference<"mutation", { value: string }, null>(
        "host:write",
      ) as unknown as FunctionReference<
        "mutation",
        "internal",
        { value: string },
        null
      >;
      const read = makeFunctionReference<
        "query",
        Record<string, never>,
        string[]
      >("host:read") as unknown as FunctionReference<
        "query",
        "internal",
        Record<string, never>,
        string[]
      >;
      let first: Awaited<ReturnType<typeof startLocalConvex>> | undefined;
      let second: Awaited<ReturnType<typeof startLocalConvex>> | undefined;
      try {
        first = await startLocalConvex(options);
        expect(new URL(first.url).hostname).toBe("127.0.0.1");
        const lock = JSON.parse(
          await readFile(path.join(projectDir, ".convex/runtime.lock"), "utf8"),
        ) as { backendPid: number };
        const sockets = await promisify(execFile)("/usr/sbin/lsof", [
          "-nP",
          "-a",
          "-p",
          String(lock.backendPid),
          "-iTCP",
          "-sTCP:LISTEN",
        ]);
        const listeners = sockets.stdout.trim().split("\n").slice(1);
        expect(listeners).toHaveLength(2);
        expect(listeners.every((line) => line.includes("127.0.0.1:"))).toBe(
          true,
        );
        await expect(startLocalConvex(options)).rejects.toThrow(
          "already owned",
        );
        await first.internalClient.mutation(write, {
          value: "survives restart",
        });
        expect(await first.internalClient.query(read, {})).toEqual([
          "survives restart",
        ]);
        const config = await readFile(
          path.join(projectDir, ".convex/config.json"),
          "utf8",
        );
        await Promise.all([first.stop(), first.stop()]);
        await expect(
          fetch(first.url, { signal: AbortSignal.timeout(1000) }),
        ).rejects.toThrow();
        second = await startLocalConvex(options);
        expect(
          await readFile(path.join(projectDir, ".convex/config.json"), "utf8"),
        ).toBe(config);
        expect(await second.internalClient.query(read, {})).toEqual([
          "survives restart",
        ]);
        await second.stop();
        await expect(
          readFile(path.join(projectDir, ".convex/runtime.lock")),
        ).rejects.toThrow();
        await expect(
          readFile(path.join(projectDir, ".convex/deploy.env")),
        ).rejects.toThrow();
      } finally {
        await second?.stop();
        await first?.stop();
        await rm(directory, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it.skipIf(process.env.DASHFRAME_CONVEX_INTEGRATION !== "1")(
    "releases ownership and terminates its backend when deployment fails",
    async () => {
      const directory = await mkdtemp(
        path.join(tmpdir(), "dashframe-convex-failed-start-"),
      );
      try {
        await expect(
          startLocalConvex({
            projectDir: directory,
            functionsDirectory: path.join(directory, "missing-functions"),
            auth: {
              issuer: "https://dashframe.local/test",
              jwksDataUri: "data:application/json;base64,eyJrZXlzIjpbXX0=",
              audience: "dashframe",
            },
          }),
        ).rejects.toThrow("deployment failed");
        await expect(
          readFile(path.join(directory, ".convex/runtime.lock")),
        ).rejects.toThrow();
        await expect(
          readFile(path.join(directory, ".convex/deploy.env")),
        ).rejects.toThrow();
        const processes = await promisify(execFile)("/bin/ps", [
          "-axo",
          "command=",
        ]);
        expect(processes.stdout).not.toContain(
          path.join(directory, ".convex/backend.sqlite3"),
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
