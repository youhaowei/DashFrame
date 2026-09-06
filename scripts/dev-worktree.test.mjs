import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearManifest,
  clearStoppedManifest,
  createDevIdentity,
  getDevInfo,
  sanitizeHostnameLabel,
  status,
  writeManifest,
} from "./dev-worktree.mjs";

const cliPath = join(import.meta.dir, "dev-worktree.mjs");

function withManifestEnvironment(run) {
  const previous = {
    launcherPid: process.env.DASHFRAME_DEV_LAUNCHER_PID,
    serverPid: process.env.DASHFRAME_DEV_SERVER_PID,
    vitePid: process.env.DASHFRAME_DEV_VITE_PID,
    portlessUrl: process.env.PORTLESS_URL,
    apiUrl: process.env.VITE_DASHFRAME_URL,
    projectDir: process.env.DASHFRAME_PROJECT_DIR,
  };
  const root = mkdtempSync(join(tmpdir(), "dashframe-dev-worktree-"));
  const info = {
    id: "test",
    name: "dashframe-test",
    surface: "web",
    root,
    manifest: join(root, ".data", "dev-web.json"),
  };

  process.env.DASHFRAME_DEV_LAUNCHER_PID = String(process.pid);
  process.env.DASHFRAME_DEV_SERVER_PID = String(process.pid);
  process.env.DASHFRAME_DEV_VITE_PID = String(process.pid);
  process.env.PORTLESS_URL = "https://dashframe-test.localhost";
  process.env.VITE_DASHFRAME_URL = "http://127.0.0.1:4000";
  process.env.DASHFRAME_PROJECT_DIR = join(root, "project");

  try {
    run(info);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const environmentKey = {
        launcherPid: "DASHFRAME_DEV_LAUNCHER_PID",
        serverPid: "DASHFRAME_DEV_SERVER_PID",
        vitePid: "DASHFRAME_DEV_VITE_PID",
        portlessUrl: "PORTLESS_URL",
        apiUrl: "VITE_DASHFRAME_URL",
        projectDir: "DASHFRAME_PROJECT_DIR",
      }[key];
      if (value === undefined) delete process.env[environmentKey];
      else process.env[environmentKey] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

describe("worktree dev identity", () => {
  test("keeps the default info command and documents the available commands", () => {
    const defaultResult = spawnSync("node", [cliPath], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const infoResult = spawnSync("node", [cliPath, "info"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const helpResult = spawnSync("node", [cliPath, "--help"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(defaultResult.status).toBe(0);
    expect(defaultResult.stdout).toBe(infoResult.stdout);
    expect(JSON.parse(defaultResult.stdout)).toMatchObject({
      surface: "web",
      root: process.cwd(),
    });
    expect(helpResult.status).toBe(0);
    expect(helpResult.stdout).toContain("identity [root]");
    expect(helpResult.stdout).toContain("status-all [root]");
  });

  test("keeps invalid commands and options as usage errors", () => {
    const invalidInvocations = [["unknown"], ["status", "--unknown"]];

    for (const args of invalidInvocations) {
      const result = spawnSync("node", [cliPath, ...args], {
        cwd: process.cwd(),
        encoding: "utf8",
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Usage: dev-worktree");
    }
  });

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
        schemaVersion: 2,
        surface: "web",
        launcherPid: process.pid,
        processes: { server: process.pid, vite: process.pid },
        endpoints: {
          app: "https://dashframe-test.localhost",
          api: "http://127.0.0.1:4000",
        },
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
        JSON.stringify({
          launcherPid: 2147483647,
          processes: { server: 2147483647 },
        }),
      );
      expect(status(info)).toMatchObject({ running: false, stale: true });
    });
  });

  test("rejects non-positive runtime PIDs", () => {
    withManifestEnvironment((info) => {
      process.env.DASHFRAME_DEV_LAUNCHER_PID = "0";
      expect(() => writeManifest(info)).toThrow(
        "A positive development launcher PID is required",
      );
    });
  });

  test("clears a manifest only after every owned process stops", () => {
    withManifestEnvironment((info) => {
      writeManifest(info);
      expect(clearStoppedManifest(info, process.pid)).toBe(false);
      expect(status(info).manifest).not.toBeNull();

      writeFileSync(
        info.manifest,
        JSON.stringify({
          launcherPid: process.pid,
          processes: { server: 2147483647, vite: 2147483647 },
        }),
      );
      expect(clearStoppedManifest(info, process.pid + 1)).toBe(false);
      expect(clearStoppedManifest(info, process.pid)).toBe(true);
      expect(status(info).manifest).toBeNull();
    });
  });

  test("keeps surface manifests separate within one worktree", () => {
    const root = process.cwd();
    expect(getDevInfo(root, "web").manifest).toEndWith("/.data/dev-web.json");
    expect(getDevInfo(root, "desktop").manifest).toEndWith(
      "/.data/dev-desktop.json",
    );
  });

  test("records a surface-neutral desktop runtime", () => {
    withManifestEnvironment((webInfo) => {
      const info = {
        ...webInfo,
        surface: "desktop",
        manifest: join(webInfo.root, ".data", "dev-desktop.json"),
      };
      writeManifest(info, {
        launcherPid: process.pid,
        processes: {
          renderer: process.pid,
          electron: process.pid,
        },
        endpoints: {
          renderer: "http://127.0.0.1:5173",
          api: "http://127.0.0.1:4000",
          cdp: "http://127.0.0.1:9222",
        },
        projectDir: join(webInfo.root, "desktop-project"),
      });

      expect(status(info)).toMatchObject({
        running: true,
        stale: false,
        manifest: {
          schemaVersion: 2,
          surface: "desktop",
          processes: {
            renderer: process.pid,
            electron: process.pid,
          },
          endpoints: {
            renderer: "http://127.0.0.1:5173",
            api: "http://127.0.0.1:4000",
            cdp: "http://127.0.0.1:9222",
          },
        },
      });
    });
  });
});
