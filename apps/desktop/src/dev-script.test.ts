import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stops desktop startup when terminated during a build", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dashframe-dev-script-"));
  temporaryDirectories.push(directory);
  const invocationLog = path.join(directory, "bun-invocations.log");
  const fakeBun = path.join(directory, "bun");
  writeFileSync(
    fakeBun,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${invocationLog}"\ntrap 'exit 143' TERM INT\nwhile :; do sleep 1; done\n`,
  );
  chmodSync(fakeBun, 0o755);

  // The test-owned PATH entry deliberately replaces Bun with a fake build.
  const child = spawn(process.execPath, ["scripts/dev.mjs"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    stdio: "ignore",
  });

  await waitFor(() => readFileSync(invocationLog, "utf8").trim().length > 0);
  const exitPromise = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  child.kill("SIGTERM");
  const exitCode = await exitPromise;

  expect(exitCode).toBe(143);
  expect(readFileSync(invocationLog, "utf8").trim().split("\n")).toEqual([
    "run build:wystack",
  ]);
});

async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      if (condition()) return;
    } catch {
      // The log is created by the child after startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the desktop dev launcher");
}
