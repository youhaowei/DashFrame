import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARTIFACT_DB_SCHEMA_VERSION, openArtifactDb } from "./db";
import {
  type ArtifactProvenance,
  PROJECT_META_ID,
  dashboards,
  dataSources,
  insights,
  schema,
  visualizations,
} from "./schema";

describe("openArtifactDb", () => {
  let dir: string;
  const userProvenance = {
    kind: "user",
    id: "test-user",
  } satisfies ArtifactProvenance;

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

    // Every declared table should accept a SELECT — if `syncSchema` skipped
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
      id: PROJECT_META_ID,
      version: "0.2.0-alpha.0",
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
        createdBy: userProvenance,
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

  test("rejects duplicate (sourceId, secretName) on secrets", async () => {
    const db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    const [source] = await db
      .insert(schema.dataSources)
      .values({
        name: "csv-test",
        kind: "csv",
        storage: "parquet",
        config: {},
        createdBy: userProvenance,
      })
      .returning();

    await db.insert(schema.secrets).values({
      sourceId: source!.id,
      secretName: "notion_token",
      ciphertext: new Uint8Array([1, 2, 3]),
    });

    await expect(async () => {
      await db.insert(schema.secrets).values({
        sourceId: source!.id,
        secretName: "notion_token",
        ciphertext: new Uint8Array([4, 5, 6]),
      });
    }).toThrow();
  });

  test("declares required artifact provenance fields and parent indexes", async () => {
    const db = await openArtifactDb({ path: join(dir, "artifacts.db") });

    await expect(async () => {
      await db.insert(dataSources).values({
        name: "missing-provenance",
        kind: "csv",
        storage: "parquet",
        config: {},
      } as never);
    }).toThrow(/created_by/);

    const [source] = await db
      .insert(dataSources)
      .values({
        name: "derived-source",
        kind: "csv",
        storage: "parquet",
        config: {},
        createdBy: userProvenance,
        parentArtifactId: crypto.randomUUID(),
      })
      .returning();

    expect(source!.createdBy).toEqual(userProvenance);
    expect(source!.parentArtifactId).toBeTruthy();

    const indexRows = await db.execute(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'data_sources_parent_artifact_id_idx',
          'insights_parent_artifact_id_idx',
          'visualizations_parent_artifact_id_idx',
          'dashboards_parent_artifact_id_idx'
        )
    `);

    expect(indexRows.rows.map((row) => row.indexname).sort()).toEqual([
      "dashboards_parent_artifact_id_idx",
      "data_sources_parent_artifact_id_idx",
      "insights_parent_artifact_id_idx",
      "visualizations_parent_artifact_id_idx",
    ]);
  });

  // Regression: PostgreSQL has no native ON UPDATE trigger, so `defaultNow()`
  // alone leaves `updatedAt` frozen at insert time. `$onUpdate` makes Drizzle
  // stamp the column on every UPDATE. See Greptile finding P2 #2 on PR #30.
  describe("updatedAt is bumped on UPDATE via $onUpdate", () => {
    test("data_sources", async () => {
      const db = await openArtifactDb({ path: join(dir, "artifacts.db") });
      const [row] = await db
        .insert(dataSources)
        .values({
          name: "csv-test",
          kind: "csv",
          storage: "parquet",
          config: { originalPath: "./fixtures/test.csv" },
          createdBy: userProvenance,
        })
        .returning();
      const original = row!.updatedAt;

      await new Promise((r) => setTimeout(r, 5));

      const [updated] = await db
        .update(dataSources)
        .set({ name: "csv-renamed" })
        .where(eq(dataSources.id, row!.id))
        .returning();

      expect(updated!.updatedAt.getTime()).toBeGreaterThan(original.getTime());
    });

    test("insights", async () => {
      const db = await openArtifactDb({ path: join(dir, "artifacts.db") });
      const [row] = await db
        .insert(insights)
        .values({
          name: "insight-test",
          definition: { sources: [], fields: [] },
          createdBy: userProvenance,
        })
        .returning();
      const original = row!.updatedAt;

      await new Promise((r) => setTimeout(r, 5));

      const [updated] = await db
        .update(insights)
        .set({ name: "insight-renamed" })
        .where(eq(insights.id, row!.id))
        .returning();

      expect(updated!.updatedAt.getTime()).toBeGreaterThan(original.getTime());
    });

    test("visualizations", async () => {
      const db = await openArtifactDb({ path: join(dir, "artifacts.db") });
      const [insight] = await db
        .insert(insights)
        .values({
          name: "insight-for-viz",
          definition: { sources: [], fields: [] },
          createdBy: userProvenance,
        })
        .returning();
      const [viz] = await db
        .insert(visualizations)
        .values({
          insightId: insight!.id,
          name: "viz-test",
          chartType: "bar",
          encoding: {},
          createdBy: userProvenance,
        })
        .returning();
      const original = viz!.updatedAt;

      await new Promise((r) => setTimeout(r, 5));

      const [updated] = await db
        .update(visualizations)
        .set({ name: "viz-renamed" })
        .where(eq(visualizations.id, viz!.id))
        .returning();

      expect(updated!.updatedAt.getTime()).toBeGreaterThan(original.getTime());
    });

    test("dashboards", async () => {
      const db = await openArtifactDb({ path: join(dir, "artifacts.db") });
      const [row] = await db
        .insert(dashboards)
        .values({
          name: "dashboard-test",
          layout: [],
          createdBy: userProvenance,
        })
        .returning();
      const original = row!.updatedAt;

      await new Promise((r) => setTimeout(r, 5));

      const [updated] = await db
        .update(dashboards)
        .set({ name: "dashboard-renamed" })
        .where(eq(dashboards.id, row!.id))
        .returning();

      expect(updated!.updatedAt.getTime()).toBeGreaterThan(original.getTime());
    });
  });
});
