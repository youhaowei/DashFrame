import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { openLocalProject } from "./local-project";

describe("local project identity", () => {
  it("shares one complete identity under concurrent first opens and restart", async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "dashframe-local-project-"),
    );
    try {
      const projects = await Promise.all(
        Array.from({ length: 8 }, () => openLocalProject({ dir })),
      );
      expect(new Set(projects.map((project) => project.workspaceId)).size).toBe(
        1,
      );
      expect((await openLocalProject({ dir })).workspaceId).toBe(
        projects[0]!.workspaceId,
      );
      expect(
        await readFile(path.join(dir, ".convex", "project-id"), "utf8"),
      ).toBe(`${projects[0]!.workspaceId}\n`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses malformed identity without silently resetting the project", async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "dashframe-local-project-"),
    );
    try {
      await openLocalProject({ dir });
      const identity = path.join(dir, ".convex", "project-id");
      await writeFile(identity, "broken");
      await expect(openLocalProject({ dir })).rejects.toThrow(
        "refusing to replace",
      );
      expect(await readFile(identity, "utf8")).toBe("broken");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

it("does not assign a new workspace to an existing backend with a missing identity", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dashframe-lost-identity-"));
  try {
    await openLocalProject({ dir });
    await rm(path.join(dir, ".convex", "project-id"));
    await writeFile(path.join(dir, ".convex", "backend.sqlite3"), "sentinel");
    await expect(openLocalProject({ dir })).rejects.toThrow(
      "refusing to replace existing Convex data",
    );
    expect(
      await readFile(path.join(dir, ".convex", "backend.sqlite3"), "utf8"),
    ).toBe("sentinel");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
