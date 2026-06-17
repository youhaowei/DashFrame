import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { ARTIFACT_DB_SCHEMA_VERSION, openArtifactDb } from "./db";
import {
  ARTIFACTS_DB_FILENAME,
  DATA_SOURCES_DIRNAME,
  openProject,
  type ProjectHandle,
} from "./project";
import {
  dataFrames,
  PROJECT_META_ID,
  PROJECT_META_SINGLETON_KEY,
  projectMeta,
} from "./schema";
import { DASHFRAME_PROJECT_VERSION } from "./version";

describe("openProject", () => {
  let root: string;
  let openHandles: ProjectHandle[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dashframe-project-"));
    openHandles = [];
  });

  afterEach(async () => {
    await Promise.allSettled(openHandles.map((h) => h.close()));
    rmSync(root, { recursive: true, force: true });
  });

  async function openTestProject(opts: Parameters<typeof openProject>[0] = {}) {
    const handle = await openProject(opts);
    openHandles.push(handle);
    return handle;
  }

  test("should materialize folder layout and seed project_meta on first open", async () => {
    const dir = join(root, "fresh");
    const handle = await openTestProject({ dir, name: "Analytics" });

    expect(handle.dir).toBe(dir);
    expect(existsSync(join(dir, ARTIFACTS_DB_FILENAME))).toBe(true);
    expect(existsSync(join(dir, DATA_SOURCES_DIRNAME))).toBe(true);

    expect(handle.meta.name).toBe("Analytics");
    expect(handle.meta.id).toBe(PROJECT_META_ID);
    expect(handle.meta.singletonKey).toBe(PROJECT_META_SINGLETON_KEY);
    expect(handle.meta.version).toBe(DASHFRAME_PROJECT_VERSION);
    expect(handle.meta.schemaVersion).toBe(ARTIFACT_DB_SCHEMA_VERSION);
    expect(handle.meta.projectId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(handle.meta.createdBy.length).toBeGreaterThan(0);
  });

  test("should default project name to folder basename", async () => {
    const dir = join(root, "my-project");
    const handle = await openTestProject({ dir });
    expect(handle.meta.name).toBe("my-project");
  });

  test("should preserve the original project_meta row on re-open", async () => {
    const dir = join(root, "persisted");
    const first = await openTestProject({ dir, name: "First" });
    const firstId = first.meta.projectId;

    const second = await openTestProject({
      dir,
      name: "Second (should be ignored)",
    });
    expect(second.meta.projectId).toBe(firstId);
    expect(second.meta.name).toBe("First");

    const rows = await second.db.select().from(projectMeta);
    expect(rows).toHaveLength(1);
  });

  test("should reject existing projects with an unsupported schema version", async () => {
    const dir = join(root, "future-schema");
    const first = await openTestProject({ dir, name: "Future" });

    await first.db
      .update(projectMeta)
      .set({ schemaVersion: ARTIFACT_DB_SCHEMA_VERSION + 1 });

    await expect(openTestProject({ dir })).rejects.toThrow(
      /Unsupported project schema version/,
    );
  });

  test("should enforce a singleton project_meta row", async () => {
    const dir = join(root, "singleton");
    const handle = await openTestProject({ dir });

    await expect(
      handle.db.insert(projectMeta).values({
        id: "duplicate",
        singletonKey: PROJECT_META_SINGLETON_KEY,
        version: DASHFRAME_PROJECT_VERSION,
        name: "Duplicate",
        projectId: crypto.randomUUID(),
        schemaVersion: ARTIFACT_DB_SCHEMA_VERSION,
        createdBy: "test",
      }),
    ).rejects.toThrow(/singleton_key|unique/i);
  });

  test("should honor DASHFRAME_PROJECT_DIR via env override", async () => {
    const dir = join(root, "from-env");
    const handle = await openTestProject({
      env: { DASHFRAME_PROJECT_DIR: dir },
    });
    expect(handle.dir).toBe(dir);
    expect(existsSync(join(dir, ARTIFACTS_DB_FILENAME))).toBe(true);
  });

  // ============================================================================
  // v2→v3 migration — strip sampleValues from persisted analysis
  // ============================================================================

  test("should migrate v2 DB by stripping sampleValues from data_frames.analysis", async () => {
    const dir = join(root, "v2-migration");
    const dbPath = join(dir, ARTIFACTS_DB_FILENAME);

    // Bootstrap a v2 DB: open via openArtifactDb (which creates tables) and
    // manually seed a project_meta row at schemaVersion=2 plus a dataFrames row
    // whose analysis contains raw sampleValues.
    mkdirSync(dir, { recursive: true });
    const db2 = await openArtifactDb({ path: dbPath });
    openHandles.push({
      close: async () => {
        await db2.$client.close();
        return { snapshotError: null };
      },
    } as ProjectHandle);

    await db2.insert(projectMeta).values({
      id: PROJECT_META_ID,
      singletonKey: PROJECT_META_SINGLETON_KEY,
      version: "0.2.0",
      name: "Old Project",
      projectId: crypto.randomUUID(),
      schemaVersion: 2, // Simulate a v2 project DB
      createdBy: "test",
    });

    const frameId = crypto.randomUUID();
    await db2.insert(dataFrames).values({
      id: frameId,
      storage: { type: "indexeddb", key: "k" },
      fieldIds: [],
      name: "Frame",
      analysis: {
        rowCount: 5,
        analyzedAt: Date.now(),
        fieldHash: "hash",
        columns: [
          {
            columnName: "email",
            dataType: "string",
            semantic: "email",
            cardinality: 5,
            uniqueness: 1,
            nullCount: 0,
            // Raw PII values that must be purged by the migration.
            sampleValues: ["alice@example.com", "bob@example.com"],
          },
        ],
      },
    });
    await db2.$client.close();

    // Re-open as the current version — openProject runs the v2→v3 migration.
    const migrated = await openTestProject({ dir });

    // schemaVersion must now be 3 (current).
    expect(migrated.meta.schemaVersion).toBe(ARTIFACT_DB_SCHEMA_VERSION);

    // The analysis must have sampleValues stripped.
    const rows = await migrated.db.select().from(dataFrames);
    const stored = rows[0]?.analysis as {
      columns: { columnName: string; sampleValues: unknown[] }[];
    } | null;
    expect(stored).not.toBeNull();
    const emailCol = stored!.columns.find((c) => c.columnName === "email");
    expect(emailCol).toBeDefined();
    // The invariant: zero raw values at rest.
    expect(emailCol!.sampleValues).toEqual([]);
  });

  test("should leave analysis intact (null columns) when analysis IS NULL during migration", async () => {
    const dir = join(root, "v2-null-analysis");
    const dbPath = join(dir, ARTIFACTS_DB_FILENAME);

    mkdirSync(dir, { recursive: true });
    const db2 = await openArtifactDb({ path: dbPath });
    openHandles.push({
      close: async () => {
        await db2.$client.close();
        return { snapshotError: null };
      },
    } as ProjectHandle);

    await db2.insert(projectMeta).values({
      id: PROJECT_META_ID,
      singletonKey: PROJECT_META_SINGLETON_KEY,
      version: "0.2.0",
      name: "Old Project",
      projectId: crypto.randomUUID(),
      schemaVersion: 2,
      createdBy: "test",
    });

    // A frame with no analysis — should survive migration untouched.
    const frameId = crypto.randomUUID();
    await db2.insert(dataFrames).values({
      id: frameId,
      storage: { type: "indexeddb", key: "k2" },
      fieldIds: [],
      name: "Frame No Analysis",
      analysis: null,
    });
    await db2.$client.close();

    const migrated = await openTestProject({ dir });
    const rows = await migrated.db.select().from(dataFrames);
    expect(rows[0]?.analysis).toBeNull();
  });
});
