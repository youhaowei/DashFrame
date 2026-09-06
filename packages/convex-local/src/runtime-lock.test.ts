import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./binary.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./binary.js")>()),
  verifyBackendBinary: vi.fn(async () =>
    path.join(tmpdir(), "dashframe-missing-convex-backend"),
  ),
}));

import { startLocalConvex } from "./runtime.js";

const auth = {
  issuer: "https://dashframe.local/test",
  jwksDataUri: "data:application/json;base64,eyJrZXlzIjpbXX0=",
  audience: "dashframe" as const,
};

async function deadPid() {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  if (!child.pid) throw new Error("Test child did not receive a PID.");
  await once(child, "exit");
  return child.pid;
}

async function fixture(ownerPid: number) {
  const projectDir = await mkdtemp(
    path.join(tmpdir(), "dashframe-runtime-lock-"),
  );
  const state = path.join(projectDir, ".convex");
  await mkdir(state);
  const lockPath = path.join(state, "runtime.lock");
  await writeFile(lockPath, JSON.stringify({ ownerPid }), { mode: 0o600 });
  return { projectDir, lockPath };
}

function start(projectDir: string) {
  return startLocalConvex({
    projectDir,
    functionsDirectory: projectDir,
    auth,
  });
}

async function captureFailure(projectDir: string): Promise<Error> {
  try {
    await start(projectDir);
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Local Convex startup rejected with a non-Error value");
  }
  throw new Error("Expected local Convex startup to fail");
}

describe("local Convex runtime ownership lock", () => {
  it("reclaims a lock whose recorded owner has exited", async () => {
    const { projectDir, lockPath } = await fixture(await deadPid());
    try {
      await expect(start(projectDir)).rejects.toThrow(
        "key provisioning failed",
      );
      await expect(readFile(lockPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("refuses a lock whose recorded owner is still alive", async () => {
    const { projectDir, lockPath } = await fixture(process.pid);
    try {
      await expect(start(projectDir)).rejects.toThrow("already owned");
      expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual({
        ownerPid: process.pid,
      });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("allows only one of two concurrent stale-lock reclaimers", async () => {
    const { projectDir } = await fixture(await deadPid());
    try {
      const failures = await Promise.all([
        captureFailure(projectDir),
        captureFailure(projectDir),
      ]);
      expect(
        failures.filter((error) => error.message.includes("already owned")),
      ).toHaveLength(1);
      expect(
        failures.filter((error) =>
          error.message.includes("key provisioning failed"),
        ),
      ).toHaveLength(1);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
