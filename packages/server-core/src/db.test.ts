import { eq, sql } from "drizzle-orm";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  type ArtifactDb,
  ARTIFACT_DB_SCHEMA_VERSION,
  openArtifactDb,
} from "./db";
import {
  type ArtifactProvenance,
  PROJECT_META_ID,
  dashboards,
  dataFrames,
  dataSources,
  insights,
  schema,
  visualizations,
} from "./schema";

describe("openArtifactDb", () => {
  let dir: string;
  let openDbs: ArtifactDb[];
  const userProvenance = {
    kind: "user",
    id: "test-user",
  } satisfies ArtifactProvenance;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-test-"));
    openDbs = [];
  });

  afterEach(async () => {
    await Promise.allSettled(openDbs.map((db) => db.$client.close()));
    rmSync(dir, { recursive: true, force: true });
  });

  async function openTestArtifactDb(path = join(dir, "artifacts.db")) {
    const db = await openArtifactDb({ path });
    openDbs.push(db);
    return db;
  }

  test("should create artifact db file and seed all tables on first open", async () => {
    const dbPath = join(dir, "artifacts.db");
    const db = await openTestArtifactDb(dbPath);

    expect(existsSync(dbPath)).toBe(true);

    // Every declared table should accept a SELECT — if `syncSchema` skipped
    // one, this would throw "relation does not exist".
    for (const table of Object.values(schema)) {
      const rows = await db.select().from(table);
      expect(Array.isArray(rows)).toBe(true);
    }
  });

  test("should be idempotent across re-opens", async () => {
    const dbPath = join(dir, "artifacts.db");
    const first = await openTestArtifactDb(dbPath);

    await first.insert(schema.projectMeta).values({
      id: PROJECT_META_ID,
      version: "0.2.0-alpha.0",
      projectId: crypto.randomUUID(),
      name: "test-project",
      schemaVersion: ARTIFACT_DB_SCHEMA_VERSION,
      createdBy: "dashframe@0.2.0-alpha.0",
    });

    // Re-open should not error (CREATE TABLE IF NOT EXISTS) and should preserve rows.
    const second = await openTestArtifactDb(dbPath);
    const rows = await second.select().from(schema.projectMeta);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("test-project");
  });

  test("should enforce cascade delete from data_sources to secrets", async () => {
    const db = await openTestArtifactDb();

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

  test("should reject duplicate (sourceId, secretName) on secrets", async () => {
    const db = await openTestArtifactDb();
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

    await expect(
      db.insert(schema.secrets).values({
        sourceId: source!.id,
        secretName: "notion_token",
        ciphertext: new Uint8Array([4, 5, 6]),
      }),
    ).rejects.toThrow();
  });

  test("should declare required artifact provenance fields and parent indexes", async () => {
    const db = await openTestArtifactDb();

    await expect(
      db.insert(dataSources).values({
        name: "missing-provenance",
        kind: "csv",
        storage: "parquet",
        config: {},
      } as never),
    ).rejects.toThrow(/created_by/);

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

  // ============================================================================
  // Artifact-DB write gate — profiles only by construction (YW-131)
  //
  // Contract: a raw `sampleValues` array written via ANY Drizzle path (insert
  // or update) against `data_frames` is stripped to `[]` before the bytes
  // reach PGLite. The invariant is enforced at the DB instance level so no
  // caller can bypass it — violating writes are unrepresentable, not policed
  // by callers.
  // ============================================================================
  describe("write gate — no raw sampleValues can land in data_frames (YW-131)", () => {
    function makeAnalysis(sampleValues: unknown[] = ["pii@example.com"]) {
      return {
        rowCount: 1,
        analyzedAt: Date.now(),
        fieldHash: "h",
        columns: [
          {
            columnName: "email",
            dataType: "string",
            semantic: "email",
            cardinality: 1,
            uniqueness: 1,
            nullCount: 0,
            sampleValues,
          },
        ],
      };
    }

    test("should strip sampleValues on insert even when caller passes raw values", async () => {
      const db = await openTestArtifactDb();
      const id = crypto.randomUUID();

      // Attempt to persist raw PII via a direct Drizzle insert —
      // the gate must strip it before the row lands in PGLite.
      await db
        .insert(dataFrames)
        .values({
          id,
          storage: { type: "indexeddb", key: "k" },
          fieldIds: [],
          name: "Gate Test Frame",
          analysis: makeAnalysis(["alice@example.com", "bob@example.com"]),
        })
        .returning();

      const rows = await db.select().from(dataFrames);
      const stored = rows.find((r) => r.id === id);
      expect(stored).toBeDefined();

      const analysis = stored!.analysis as ReturnType<typeof makeAnalysis>;
      // The invariant: zero raw cell values at rest.
      expect(analysis.columns[0]!.sampleValues).toEqual([]);
      // Profile stats survive the strip.
      expect(analysis.columns[0]!.cardinality).toBe(1);
      expect(analysis.columns[0]!.semantic).toBe("email");
    });

    test("should strip sampleValues on update even when caller passes raw values", async () => {
      const db = await openTestArtifactDb();
      const id = crypto.randomUUID();

      // Insert a clean frame first.
      await db
        .insert(dataFrames)
        .values({
          id,
          storage: { type: "indexeddb", key: "k" },
          fieldIds: [],
          name: "Gate Test Frame",
        })
        .returning();

      // Attempt to write raw values via a direct Drizzle update.
      await db
        .update(dataFrames)
        .set({ analysis: makeAnalysis([42, 99, 101]) })
        .where(eq(dataFrames.id, id))
        .returning();

      const rows = await db.select().from(dataFrames);
      const stored = rows.find((r) => r.id === id);
      expect(stored).toBeDefined();

      const analysis = stored!.analysis as ReturnType<typeof makeAnalysis>;
      // Raw numeric values must not have landed.
      expect(analysis.columns[0]!.sampleValues).toEqual([]);
    });

    test("should preserve profile fields and leave null analysis untouched", async () => {
      const db = await openTestArtifactDb();
      const id = crypto.randomUUID();

      // Insert with null analysis — gate must not break the write.
      await db
        .insert(dataFrames)
        .values({
          id,
          storage: { type: "indexeddb", key: "k" },
          fieldIds: [],
          name: "Null Analysis Frame",
          analysis: null,
        })
        .returning();

      const rows = await db.select().from(dataFrames);
      expect(rows.find((r) => r.id === id)?.analysis).toBeNull();
    });

    test("should strip sampleValues in onConflictDoUpdate set clause", async () => {
      const db = await openTestArtifactDb();
      const id = crypto.randomUUID();

      // Insert a clean frame first.
      await db.insert(dataFrames).values({
        id,
        storage: { type: "indexeddb", key: "k" },
        fieldIds: [],
        name: "Upsert Gate Frame",
      });

      // Attempt a conflict-update that carries raw sampleValues in the set clause.
      await db
        .insert(dataFrames)
        .values({
          id,
          storage: { type: "indexeddb", key: "k" },
          fieldIds: [],
          name: "Upsert Gate Frame",
        })
        .onConflictDoUpdate({
          target: dataFrames.id,
          set: { analysis: makeAnalysis(["secret@example.com"]) },
        });

      const rows = await db.select().from(dataFrames);
      const stored = rows.find((r) => r.id === id);
      expect(stored).toBeDefined();
      const analysis = stored!.analysis as ReturnType<typeof makeAnalysis>;
      // The conflict-update path must also strip raw values.
      expect(analysis.columns[0]!.sampleValues).toEqual([]);
    });

    test("should strip sampleValues on a transactional insert", async () => {
      const db = await openTestArtifactDb();
      const id = crypto.randomUUID();

      // Drizzle hands the tx callback an unwrapped handle; the gate must wrap
      // it so writes inside the transaction are stripped just like top-level ones.
      await db.transaction(async (tx) => {
        await tx
          .insert(dataFrames)
          .values({
            id,
            storage: { type: "indexeddb", key: "k" },
            fieldIds: [],
            name: "Tx Gate Frame",
            analysis: makeAnalysis(["pii-in-tx@example.com"]),
          })
          .returning();
      });

      const rows = await db.select().from(dataFrames);
      const analysis = rows.find((r) => r.id === id)!.analysis as ReturnType<
        typeof makeAnalysis
      >;
      expect(analysis.columns[0]!.sampleValues).toEqual([]);
    });

    test("should strip sampleValues inside a nested transaction (savepoint)", async () => {
      const db = await openTestArtifactDb();
      const id = crypto.randomUUID();

      // The gate must recurse: the handle passed to a nested transaction is
      // itself gated, so a write at savepoint depth is still stripped.
      await db.transaction(async (tx) => {
        await tx.transaction(async (inner) => {
          await inner
            .insert(dataFrames)
            .values({
              id,
              storage: { type: "indexeddb", key: "k" },
              fieldIds: [],
              name: "Nested Tx Gate Frame",
              analysis: makeAnalysis(["nested-pii@example.com"]),
            })
            .returning();
        });
      });

      const rows = await db.select().from(dataFrames);
      const analysis = rows.find((r) => r.id === id)!.analysis as ReturnType<
        typeof makeAnalysis
      >;
      expect(analysis.columns[0]!.sampleValues).toEqual([]);
    });

    test("should throw on a sql`` analysis value (fail closed, not silent)", async () => {
      const db = await openTestArtifactDb();
      const id = crypto.randomUUID();

      await db.insert(dataFrames).values({
        id,
        storage: { type: "indexeddb", key: "k" },
        fieldIds: [],
        name: "Sql Expr Frame",
      });

      // A SQL expression cannot be statically stripped, so the gate must throw
      // rather than forward raw values to PGLite. The error names the gate.
      expect(() =>
        db
          .update(dataFrames)
          .set({
            analysis: sql`jsonb_set(analysis, '{columns,0,sampleValues}', '["raw"]')`,
          })
          .where(eq(dataFrames.id, id)),
      ).toThrow(/write gate \(YW-131\)/);

      // And the row is untouched — nothing raw landed.
      const rows = await db.select().from(dataFrames);
      expect(rows.find((r) => r.id === id)?.analysis).toBeNull();
    });

    test("should persist nothing when a transaction throws (rollback intact)", async () => {
      const db = await openTestArtifactDb();
      const id = crypto.randomUUID();

      // A write inside a tx that throws must roll back — the gate wraps the
      // handle but does not alter the transaction's atomicity semantics.
      await expect(
        db.transaction(async (tx) => {
          await tx.insert(dataFrames).values({
            id,
            storage: { type: "indexeddb", key: "k" },
            fieldIds: [],
            name: "Rolled-Back Frame",
            analysis: makeAnalysis(["should-not-persist@example.com"]),
          });
          throw new Error("force rollback");
        }),
      ).rejects.toThrow("force rollback");

      const rows = await db.select().from(dataFrames);
      expect(rows.find((r) => r.id === id)).toBeUndefined();
    });

    test("should not interfere with writes to other tables (dataSources)", async () => {
      const db = await openTestArtifactDb();

      // A dataSources write has no analysis column — the gate must be a no-op.
      const [row] = await db
        .insert(dataSources)
        .values({
          name: "unaffected-source",
          kind: "csv",
          storage: "parquet",
          config: { note: "gate should not interfere" },
          createdBy: userProvenance,
        })
        .returning();

      expect(row!.name).toBe("unaffected-source");
      expect((row!.config as Record<string, string>).note).toBe(
        "gate should not interfere",
      );
    });
  });

  // Regression: PostgreSQL has no native ON UPDATE trigger, so `defaultNow()`
  // alone leaves `updatedAt` frozen at insert time. `$onUpdate` makes Drizzle
  // stamp the column on every UPDATE. See Greptile finding P2 #2 on PR #30.
  describe("updatedAt is bumped on UPDATE via $onUpdate", () => {
    test("should bump data_sources", async () => {
      const db = await openTestArtifactDb();
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

      await new Promise((r) => setTimeout(r, 20));

      const [updated] = await db
        .update(dataSources)
        .set({ name: "csv-renamed" })
        .where(eq(dataSources.id, row!.id))
        .returning();

      expect(updated!.updatedAt.getTime()).toBeGreaterThan(original.getTime());
    });

    test("should bump insights", async () => {
      const db = await openTestArtifactDb();
      const [row] = await db
        .insert(insights)
        .values({
          name: "insight-test",
          definition: { sources: [], fields: [] },
          createdBy: userProvenance,
        })
        .returning();
      const original = row!.updatedAt;

      await new Promise((r) => setTimeout(r, 20));

      const [updated] = await db
        .update(insights)
        .set({ name: "insight-renamed" })
        .where(eq(insights.id, row!.id))
        .returning();

      expect(updated!.updatedAt.getTime()).toBeGreaterThan(original.getTime());
    });

    test("should bump visualizations", async () => {
      const db = await openTestArtifactDb();
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

      await new Promise((r) => setTimeout(r, 20));

      const [updated] = await db
        .update(visualizations)
        .set({ name: "viz-renamed" })
        .where(eq(visualizations.id, viz!.id))
        .returning();

      expect(updated!.updatedAt.getTime()).toBeGreaterThan(original.getTime());
    });

    test("should bump dashboards", async () => {
      const db = await openTestArtifactDb();
      const [row] = await db
        .insert(dashboards)
        .values({
          name: "dashboard-test",
          layout: [],
          createdBy: userProvenance,
        })
        .returning();
      const original = row!.updatedAt;

      await new Promise((r) => setTimeout(r, 20));

      const [updated] = await db
        .update(dashboards)
        .set({ name: "dashboard-renamed" })
        .where(eq(dashboards.id, row!.id))
        .returning();

      expect(updated!.updatedAt.getTime()).toBeGreaterThan(original.getTime());
    });
  });
});
