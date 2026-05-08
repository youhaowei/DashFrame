import { describe, expect, test } from "bun:test";
import path from "node:path";

import { PROJECT_DIR_ENV, resolveProjectDir } from "./project-dir";

describe("resolveProjectDir", () => {
  test("explicit dir wins over env and default", () => {
    const result = resolveProjectDir({
      dir: "/opt/custom",
      env: { [PROJECT_DIR_ENV]: "/opt/env-wins" },
      homeDir: "/home/u",
    });
    expect(result).toBe("/opt/custom");
  });

  test("env overrides default", () => {
    const result = resolveProjectDir({
      env: { [PROJECT_DIR_ENV]: "/var/lib/dashframe" },
      homeDir: "/home/u",
    });
    expect(result).toBe("/var/lib/dashframe");
  });

  test("falls back to ~/.DashFrame/default-project when env absent", () => {
    const result = resolveProjectDir({ env: {}, homeDir: "/home/u" });
    expect(result).toBe(path.join("/home/u", ".DashFrame", "default-project"));
  });

  test("trims whitespace-only env var and falls back", () => {
    const result = resolveProjectDir({
      env: { [PROJECT_DIR_ENV]: "   " },
      homeDir: "/home/u",
    });
    expect(result).toBe(path.join("/home/u", ".DashFrame", "default-project"));
  });

  test("resolves relative env var to absolute", () => {
    const result = resolveProjectDir({
      env: { [PROJECT_DIR_ENV]: "tmp/relative" },
      homeDir: "/home/u",
    });
    expect(path.isAbsolute(result)).toBe(true);
    expect(result.endsWith(path.join("tmp", "relative"))).toBe(true);
  });
});
