import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearManifest,
  createDevIdentity,
  sanitizeHostnameLabel,
  status,
  writeManifest,
} from "./dev-worktree.mjs";

function withManifestEnvironment(run) {
  const previous = {
    launcherPid: process.env.DASHFRAME_DEV_LAUNCHER_PID,
    serverPid: process.env.DASHFRAME_DEV_SERVER_PID,
    portlessUrl: process.env.PORTLESS_URL,
    apiUrl: process.env.VITE_WYSTACK_URL,
    projectDir: process.env.DASHFRAME_PROJECT_DIR,
  };
  const root = mkdtempSync(join(tmpdir(), "dashframe-dev-worktree-"));
  const info = {
    id: "test",
    name: "dashframe-test",
    root,
    manifest: join(root, ".data", "dev-web.json"),
  };

  process.env.DASHFRAME_DEV_LAUNCHER_PID = String(process.pid);
  process.env.DASHFRAME_DEV_SERVER_PID = String(process.pid);
  process.env.PORTLESS_URL = "https://dashframe-test.localhost";
  process.env.VITE_WYSTACK_URL = "http://127.0.0.1:4000";
  process.env.DASHFRAME_PROJECT_DIR = join(root, "project");

  try {
    run(info);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const environmentKey = {
        launcherPid: "DASHFRAME_DEV_LAUNCHER_PID",
        serverPid: "DASHFRAME_DEV_SERVER_PID",
        portlessUrl: "PORTLESS_URL",
        apiUrl: "VITE_WYSTACK_URL",
        projectDir: "DASHFRAME_PROJECT_DIR",
      }[key];
      if (value === undefined) delete process.env[environmentKey];
      else process.env[environmentKey] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

describe("worktree dev identity", () => {
  test("keeps the main checkout on the short canonical name", () => {
    expect(createDevIdentity({ root: "/repo", isMainWorktree: true })).toEqual({
      id: "main",
      name: "dashframe",
    });
  });

  test("gives detached worktrees stable collision-free names", () => {
    const first = createDevIdentity({ root: "/tasks/alpha/DashFrame" });
    const repeated = createDevIdentity({ root: "/tasks/alpha/DashFrame" });
    const second = createDevIdentity({ root: "/tasks/beta/DashFrame" });

    expect(first).toEqual(repeated);
    expect(first.name).toMatch(/^dashframe-alpha-[a-f0-9]{6}$/);
    expect(second.name).toMatch(/^dashframe-beta-[a-f0-9]{6}$/);
    expect(first.name).not.toBe(second.name);
  });

  test("preserves the path hash when long worktree hints are truncated", () => {
    const sharedPrefix = "a".repeat(60);
    const first = createDevIdentity({
      root: `/tasks/${sharedPrefix}-one/DashFrame`,
    });
    const second = createDevIdentity({
      root: `/tasks/${sharedPrefix}-two/DashFrame`,
    });

    expect(first.name).toHaveLength(63);
    expect(second.name).toHaveLength(63);
    expect(first.name).not.toBe(second.name);
    expect(first.name).toMatch(/-[a-f0-9]{6}$/);
    expect(second.name).toMatch(/-[a-f0-9]{6}$/);
  });

  test("sanitizes an explicit agent-friendly name", () => {
    expect(
      createDevIdentity({
        root: "/repo",
        explicitName: "Task 788 / Source Binding",
      }).name,
    ).toBe("task-788-source-binding");
  });

  test("bounds explicit names to one DNS label", () => {
    const { name } = createDevIdentity({
      root: "/repo",
      explicitName: "x".repeat(80),
    });
    expect(name).toHaveLength(63);
  });

  test("produces valid hostname labels", () => {
    expect(sanitizeHostnameLabel(" Codex/Feature__One ")).toBe(
      "codex-feature-one",
    );
  });

  test("writes, reports, and clears only the owning runtime manifest", () => {
    withManifestEnvironment((info) => {
      writeManifest(info);

      expect(JSON.parse(readFileSync(info.manifest, "utf8"))).toMatchObject({
        launcherPid: process.pid,
        serverPid: process.pid,
      });
      expect(status(info)).toMatchObject({ running: true, stale: false });

      clearManifest(info, process.pid + 1);
      expect(status(info).manifest).not.toBeNull();

      clearManifest(info, process.pid);
      expect(status(info)).toMatchObject({
        running: false,
        stale: false,
        manifest: null,
      });
    });
  });

  test("treats malformed and dead runtime manifests as unavailable or stale", () => {
    withManifestEnvironment((info) => {
      writeManifest(info);
      writeFileSync(info.manifest, "not-json\n");
      expect(status(info)).toMatchObject({
        running: false,
        stale: false,
        manifest: null,
      });

      writeFileSync(
        info.manifest,
        JSON.stringify({ launcherPid: 2147483647, serverPid: 2147483647 }),
      );
      expect(status(info)).toMatchObject({ running: false, stale: true });
    });
  });

  test("rejects non-positive runtime PIDs", () => {
    withManifestEnvironment((info) => {
      process.env.DASHFRAME_DEV_LAUNCHER_PID = "0";
      expect(() => writeManifest(info)).toThrow(
        "Positive dev launcher and server PIDs are required",
      );
    });
  });
});
