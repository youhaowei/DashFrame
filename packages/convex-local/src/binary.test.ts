import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { backendTarget, verifyBackendBinary } from "./binary.js";

describe("pinned backend platform selection", () => {
  it.each([
    ["darwin", "arm64", "aarch64-apple-darwin", "convex-local-backend"],
    ["darwin", "x64", "x86_64-apple-darwin", "convex-local-backend"],
    ["linux", "arm64", "aarch64-unknown-linux-gnu", "convex-local-backend"],
    ["linux", "x64", "x86_64-unknown-linux-gnu", "convex-local-backend"],
    ["win32", "x64", "x86_64-pc-windows-msvc", "convex-local-backend.exe"],
  ])(
    "selects %s %s without executing a binary",
    (platform, arch, triple, executable) => {
      expect(backendTarget(platform, arch)).toMatchObject({
        triple,
        executable,
      });
    },
  );

  it("rejects an architecture without a pinned official artifact", () => {
    expect(() => backendTarget("win32", "arm64")).toThrow(
      "No pinned Convex backend",
    );
  });

  it("rejects changed executable bytes before process creation", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "dashframe-convex-integrity-"),
    );
    const file = path.join(directory, "backend");
    try {
      await writeFile(file, "not the pinned backend", { mode: 0o700 });
      await expect(
        verifyBackendBinary(file, backendTarget("linux", "x64")),
      ).rejects.toThrow("checksum");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
