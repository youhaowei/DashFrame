import path from "node:path";
import { describe, expect, test } from "vitest";

import { PROJECT_DIR_ENV, resolveProjectDir } from "./project-dir";

describe("resolveProjectDir", () => {
  test("should prefer explicit dir over env and default", () => {
    const result = resolveProjectDir({
      dir: "/opt/custom",
      env: { [PROJECT_DIR_ENV]: "/opt/env-wins" },
      homeDir: "/home/u",
    });
    expect(result).toBe("/opt/custom");
  });

  test("should use env var when explicit dir is absent", () => {
    const result = resolveProjectDir({
      env: { [PROJECT_DIR_ENV]: "/var/lib/dashframe" },
      homeDir: "/home/u",
    });
    expect(result).toBe("/var/lib/dashframe");
  });

  test("should fall back to ~/.DashFrame/default-project when env is absent", () => {
    const result = resolveProjectDir({ env: {}, homeDir: "/home/u" });
    expect(result).toBe(path.join("/home/u", ".DashFrame", "default-project"));
  });

  test("should treat whitespace-only env var as absent and fall back", () => {
    const result = resolveProjectDir({
      env: { [PROJECT_DIR_ENV]: "   " },
      homeDir: "/home/u",
    });
    expect(result).toBe(path.join("/home/u", ".DashFrame", "default-project"));
  });

  test("should resolve a relative env var to an absolute path", () => {
    const result = resolveProjectDir({
      env: { [PROJECT_DIR_ENV]: "tmp/relative" },
      homeDir: "/home/u",
    });
    expect(path.isAbsolute(result)).toBe(true);
    expect(result.endsWith(path.join("tmp", "relative"))).toBe(true);
  });
});
