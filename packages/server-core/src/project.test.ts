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
import {
  PROJECT_META_ID,
  PROJECT_META_SINGLETON_KEY,
  projectMeta,
} from "./schema";
import { DASHFRAME_PROJECT_VERSION } from "./version";

type OpenProjectHandle = Awaited<ReturnType<typeof openProject>>;
type CloseableProjectHandle = OpenProjectHandle & {
  db: OpenProjectHandle["db"] & { $client: { close(): Promise<void> } };
};

describe("openProject", () => {
  let root: string;
  let openHandles: CloseableProjectHandle[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dashframe-project-"));
    openHandles = [];
  });

  afterEach(async () => {
    await Promise.all(openHandles.map((handle) => handle.db.$client.close()));
    rmSync(root, { recursive: true, force: true });
  });

  async function openTestProject(options: Parameters<typeof openProject>[0]) {
    const handle = (await openProject(options)) as CloseableProjectHandle;
    openHandles.push(handle);
    return handle;
  }

  test("materializes folder layout and seeds project_meta on first open", async () => {
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

  test("defaults project name to folder basename", async () => {
    const dir = join(root, "my-project");
    const handle = await openTestProject({ dir });
    expect(handle.meta.name).toBe("my-project");
  });

  test("re-opening preserves the original project_meta row", async () => {
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

  test("rejects existing projects with an unsupported schema version", async () => {
    const dir = join(root, "future-schema");
    const first = await openTestProject({ dir, name: "Future" });

    await first.db
      .update(projectMeta)
      .set({ schemaVersion: ARTIFACT_DB_SCHEMA_VERSION + 1 });

    await expect(openProject({ dir })).rejects.toThrow(
      /Unsupported project schema version/,
    );
  });

  test("database enforces a singleton project_meta row", async () => {
    const dir = join(root, "singleton");
    const handle = await openTestProject({ dir });

    await expect(async () => {
      await handle.db.insert(projectMeta).values({
        id: "duplicate",
        singletonKey: PROJECT_META_SINGLETON_KEY,
        version: DASHFRAME_PROJECT_VERSION,
        name: "Duplicate",
        projectId: crypto.randomUUID(),
        schemaVersion: ARTIFACT_DB_SCHEMA_VERSION,
        createdBy: "test",
      });
    }).toThrow(/singleton_key|unique/i);
  });

  test("honors DASHFRAME_PROJECT_DIR via env override", async () => {
    const dir = join(root, "from-env");
    const handle = await openTestProject({
      env: { DASHFRAME_PROJECT_DIR: dir },
    });
    expect(handle.dir).toBe(dir);
    expect(existsSync(join(dir, ARTIFACTS_DB_FILENAME))).toBe(true);
  });
});
