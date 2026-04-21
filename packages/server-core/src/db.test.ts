import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARTIFACT_DB_SCHEMA_VERSION, openArtifactDb } from "./db";
import { schema } from "./schema";

describe("openArtifactDb", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("creates artifact db file and seeds all tables on first open", async () => {
    const dbPath = join(dir, "artifacts.db");
    const db = await openArtifactDb({ path: dbPath });

    expect(existsSync(dbPath)).toBe(true);

    // Every declared table should accept a SELECT — if `ensureSchema` skipped
    // one, this would throw "relation does not exist".
    for (const table of Object.values(schema)) {
      const rows = await db.select().from(table);
      expect(Array.isArray(rows)).toBe(true);
    }
  });

  test("is idempotent across re-opens", async () => {
    const dbPath = join(dir, "artifacts.db");
    const first = await openArtifactDb({ path: dbPath });

    await first.insert(schema.projectMeta).values({
      projectId: crypto.randomUUID(),
      name: "test-project",
      schemaVersion: ARTIFACT_DB_SCHEMA_VERSION,
      createdBy: "dashframe@0.2.0-alpha.0",
    });

    // Re-open should not error (CREATE TABLE IF NOT EXISTS) and should preserve rows.
    const second = await openArtifactDb({ path: dbPath });
    const rows = await second.select().from(schema.projectMeta);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("test-project");
  });

  test("enforces cascade delete from data_sources to secrets", async () => {
    const db = await openArtifactDb({ path: join(dir, "artifacts.db") });

    const [source] = await db
      .insert(schema.dataSources)
      .values({
        name: "csv-test",
        kind: "csv",
        storage: "parquet",
        config: { originalPath: "./fixtures/test.csv" },
      })
      .returning();

    await db.insert(schema.secrets).values({
      sourceId: source!.id,
      secretName: "notion_token",
      ciphertext: new Uint8Array([1, 2, 3, 4]),
    });

    expect(await db.select().from(schema.secrets)).toHaveLength(1);

    await db.delete(schema.dataSources);

    expect(await db.select().from(schema.secrets)).toHaveLength(0);
  });
});
