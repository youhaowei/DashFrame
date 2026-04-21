import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARTIFACT_DB_SCHEMA_VERSION } from "./db";
import {
  ARTIFACTS_DB_FILENAME,
  DATA_SOURCES_DIRNAME,
  openProject,
} from "./project";
import { projectMeta } from "./schema";

describe("openProject", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dashframe-project-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("materializes folder layout and seeds project_meta on first open", async () => {
    const dir = join(root, "fresh");
    const handle = await openProject({ dir, name: "Analytics" });

    expect(handle.dir).toBe(dir);
    expect(existsSync(join(dir, ARTIFACTS_DB_FILENAME))).toBe(true);
    expect(existsSync(join(dir, DATA_SOURCES_DIRNAME))).toBe(true);

    expect(handle.meta.name).toBe("Analytics");
    expect(handle.meta.schemaVersion).toBe(ARTIFACT_DB_SCHEMA_VERSION);
    expect(handle.meta.projectId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(handle.meta.createdBy.length).toBeGreaterThan(0);
  });

  test("defaults project name to folder basename", async () => {
    const dir = join(root, "my-project");
    const handle = await openProject({ dir });
    expect(handle.meta.name).toBe("my-project");
  });

  test("re-opening preserves the original project_meta row", async () => {
    const dir = join(root, "persisted");
    const first = await openProject({ dir, name: "First" });
    const firstId = first.meta.projectId;

    const second = await openProject({
      dir,
      name: "Second (should be ignored)",
    });
    expect(second.meta.projectId).toBe(firstId);
    expect(second.meta.name).toBe("First");

    const rows = await second.db.select().from(projectMeta);
    expect(rows).toHaveLength(1);
  });

  test("honors DASHFRAME_PROJECT_DIR via env override", async () => {
    const dir = join(root, "from-env");
    const handle = await openProject({ env: { DASHFRAME_PROJECT_DIR: dir } });
    expect(handle.dir).toBe(dir);
    expect(existsSync(join(dir, ARTIFACTS_DB_FILENAME))).toBe(true);
  });
});
