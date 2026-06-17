/**
 * Tests for the YW-125 draft delta-table schema.
 *
 * Load-bearing contracts:
 *   1. Each of the 6 draftable artifact tables has a `__draft` shadow with the
 *      correct (draft_id, id) composite PK + `__tombstone` column.
 *   2. NO shadow exists for secret_mappings, project_meta (security boundary).
 *   3. The draft_command_log table exists with the right shape.
 *   4. compactLog collapses add-tweak-delete chains to net effect (the
 *      DashFrame-side port of @wystack/server compactLog, since command-log
 *      compaction is enforced by the schema test before the server primitive
 *      is wired).
 *
 * These tests run against PGlite in-memory to verify the Drizzle schema
 * materialises correctly — not just that the TypeScript types compile.
 */

import { PGlite } from "@electric-sql/pglite";
import { getTableColumns, getTableName, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  dashboardsDraft,
  dataFramesDraft,
  dataSourcesDraft,
  dataTablesDraft,
  draftCommandLog,
  insightsDraft,
  schema,
  visualizationsDraft,
} from "./schema";
import { syncSchema } from "./sync-schema";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Db = ReturnType<typeof drizzle>;
let pg: PGlite;
let db: Db;

beforeEach(async () => {
  pg = new PGlite();
  await pg.waitReady;
  db = drizzle(pg, { schema });
  await syncSchema(db, schema);
});

afterEach(async () => {
  await pg.close();
});

/**
 * Returns true iff the named table exists in the current PGlite database.
 * Uses pg_tables for a direct DDL check (bypasses Drizzle layer).
 */
async function tableExists(tableName: string): Promise<boolean> {
  const res = await db.execute(
    sql`SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = ${tableName}`,
  );
  // PGlite returns { rows: [...] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((res as any).rows?.length ?? 0) > 0;
}

/**
 * Returns the set of column names for the named table from the information
 * schema — a cross-check against the live DDL, not just the Drizzle object.
 */
async function liveColumns(tableName: string): Promise<Set<string>> {
  const res = await db.execute(
    sql`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tableName}`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (res as any).rows as Array<{ column_name: string }>;
  return new Set(rows.map((r) => r.column_name));
}

// ─── 1. Shadow tables exist with the correct shape ────────────────────────────

const ARTIFACT_SHADOWS = [
  { name: "data_sources__draft", drizzleTable: dataSourcesDraft },
  { name: "data_tables__draft", drizzleTable: dataTablesDraft },
  { name: "data_frames__draft", drizzleTable: dataFramesDraft },
  { name: "insights__draft", drizzleTable: insightsDraft },
  { name: "visualizations__draft", drizzleTable: visualizationsDraft },
  { name: "dashboards__draft", drizzleTable: dashboardsDraft },
] as const;

describe("draft shadow tables — existence and shape", () => {
  for (const { name, drizzleTable } of ARTIFACT_SHADOWS) {
    test(`${name} is materialised by syncSchema`, async () => {
      expect(await tableExists(name)).toBe(true);
    });

    test(`${name} has draft_id column`, async () => {
      const cols = await liveColumns(name);
      expect(cols.has("draft_id")).toBe(true);
    });

    test(`${name} has __tombstone column`, async () => {
      const cols = await liveColumns(name);
      expect(cols.has("__tombstone")).toBe(true);
    });

    test(`${name} has id column`, async () => {
      const cols = await liveColumns(name);
      expect(cols.has("id")).toBe(true);
    });

    test(`${name} has composite PK (draft_id, id) — enforced by DB`, async () => {
      // Try to insert a duplicate (draft_id, id) pair — must throw a PK violation.
      const tableSqlName = getTableName(drizzleTable);
      const cols = await liveColumns(tableSqlName);
      // Build a minimal insert with only the NOT NULL non-default columns.
      // The shadow columns (draft_id, id, __tombstone) are always present.
      await db.execute(
        sql.raw(
          `INSERT INTO "${tableSqlName}" (draft_id, id, __tombstone) VALUES ('d1', '00000000-0000-0000-0000-000000000001', false)`,
        ),
      );
      // Second insert with the same (draft_id, id) must fail.
      await expect(
        db.execute(
          sql.raw(
            `INSERT INTO "${tableSqlName}" (draft_id, id, __tombstone) VALUES ('d1', '00000000-0000-0000-0000-000000000001', false)`,
          ),
        ),
      ).rejects.toThrow();
      void cols; // consumed above
    });

    test(`${name} Drizzle table name matches SQL name`, () => {
      expect(getTableName(drizzleTable)).toBe(name);
    });

    test(`${name} Drizzle schema has draft_id + __tombstone column defs`, () => {
      const columns = getTableColumns(drizzleTable);
      // draft_id maps to the JS property `draftId`
      expect(columns["draftId"]).toBeDefined();
      expect(columns["draftId"].name).toBe("draft_id");
      // __tombstone maps to the JS property `tombstone`
      expect(columns["tombstone"]).toBeDefined();
      expect(columns["tombstone"].name).toBe("__tombstone");
    });

    test(`${name} composite PK config is (draft_id, id)`, () => {
      const cfg = getTableConfig(drizzleTable);
      expect(cfg.primaryKeys).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const pkCols = cfg.primaryKeys[0]!.columns.map((c) => c.name);
      expect(pkCols).toContain("draft_id");
      expect(pkCols).toContain("id");
    });
  }
});

// ─── 2. Security boundary — NO shadow for credential/infra tables ─────────────

describe("security boundary — no shadow for credential/infra tables", () => {
  test("secret_mappings__draft does NOT exist", async () => {
    expect(await tableExists("secret_mappings__draft")).toBe(false);
  });

  test("project_meta__draft does NOT exist", async () => {
    expect(await tableExists("project_meta__draft")).toBe(false);
  });

  test("schema export has no secret_mappings draft entry", () => {
    const keys = Object.keys(schema);
    const forbidden = keys.filter(
      (k) =>
        k.toLowerCase().includes("secret") && k.toLowerCase().includes("draft"),
    );
    expect(forbidden).toHaveLength(0);
  });

  test("schema export has no project_meta draft entry", () => {
    const keys = Object.keys(schema);
    const forbidden = keys.filter(
      (k) =>
        k.toLowerCase().includes("projectmeta") &&
        k.toLowerCase().includes("draft"),
    );
    expect(forbidden).toHaveLength(0);
  });
});

// ─── 3. Draft command log table ───────────────────────────────────────────────

describe("draft_command_log table", () => {
  test("draft_command_log is materialised by syncSchema", async () => {
    expect(await tableExists("draft_command_log")).toBe(true);
  });

  test("draft_command_log has the expected columns", async () => {
    const cols = await liveColumns("draft_command_log");
    expect(cols.has("id")).toBe(true);
    expect(cols.has("draft_id")).toBe(true);
    expect(cols.has("seq")).toBe(true);
    expect(cols.has("path")).toBe(true);
    expect(cols.has("args")).toBe(true);
    expect(cols.has("compaction_key")).toBe(true);
    expect(cols.has("kind")).toBe(true);
    expect(cols.has("created_at")).toBe(true);
  });

  test("draft_command_log Drizzle table name is 'draft_command_log'", () => {
    expect(getTableName(draftCommandLog)).toBe("draft_command_log");
  });
});

// ─── 4. Command-log compaction — collapses add-tweak-delete to net effect ──────
//
// Mirrors the @wystack/server compactLog contract. DashFrame's compactLog is
// the same algorithm (DashFrame hosts the command log, so it must honour the
// same compaction rules at publish time). These tests verify the algorithm
// independently of the DB layer.

/**
 * Minimal port of @wystack/server DraftCommand + compactLog for the schema
 * tests. The real implementation is in @wystack/server — this is the
 * DashFrame-side verification that the compaction contract is understood and
 * honoured before the server primitive is wired.
 */
interface DraftCommand {
  path: string;
  args?: unknown;
  compactionKey?: string;
  kind?: "create" | "update" | "delete";
}

function compactLog(log: DraftCommand[]): DraftCommand[] {
  const survivingCreate = new Map<string, number>();
  const lastUpdate = new Map<string, number>();
  const survivingDelete = new Map<string, number>();

  log.forEach((cmd, i) => {
    const key = cmd.compactionKey;
    if (key === undefined || cmd.kind === undefined) return;
    if (cmd.kind === "create") {
      survivingCreate.set(key, i);
      lastUpdate.delete(key);
      survivingDelete.delete(key);
    } else if (cmd.kind === "update") {
      lastUpdate.set(key, i);
    } else {
      // delete
      if (survivingCreate.has(key)) {
        // Cancels a live create — row never existed canonically. Drop all.
        survivingCreate.delete(key);
        lastUpdate.delete(key);
        survivingDelete.delete(key);
      } else {
        // Delete of a canonical row — wins, supersedes prior updates.
        lastUpdate.delete(key);
        survivingDelete.set(key, i);
      }
    }
  });

  const survivingIndices = new Set<number>();
  for (const m of [survivingCreate, lastUpdate, survivingDelete]) {
    for (const idx of m.values()) survivingIndices.add(idx);
  }

  const out: DraftCommand[] = [];
  log.forEach((cmd, i) => {
    if (cmd.compactionKey === undefined || cmd.kind === undefined) {
      out.push(cmd);
      return;
    }
    if (survivingIndices.has(i)) out.push(cmd);
  });
  return out;
}

describe("compactLog — net-effect collapse", () => {
  test("create + delete of a NEW row → both dropped (never published)", () => {
    const log: DraftCommand[] = [
      {
        path: "addInsight",
        args: { id: "i1" },
        compactionKey: "insight:i1",
        kind: "create",
      },
      {
        path: "tweakInsight",
        args: { id: "i1", name: "x" },
        compactionKey: "insight:i1",
        kind: "update",
      },
      {
        path: "deleteInsight",
        args: { id: "i1" },
        compactionKey: "insight:i1",
        kind: "delete",
      },
    ];
    expect(compactLog(log)).toHaveLength(0);
  });

  test("redundant updates → only the last survives", () => {
    const log: DraftCommand[] = [
      {
        path: "renameInsight",
        args: { id: "i1", name: "A" },
        compactionKey: "insight:i1",
        kind: "update",
      },
      {
        path: "renameInsight",
        args: { id: "i1", name: "B" },
        compactionKey: "insight:i1",
        kind: "update",
      },
      {
        path: "renameInsight",
        args: { id: "i1", name: "C" },
        compactionKey: "insight:i1",
        kind: "update",
      },
    ];
    const result = compactLog(log);
    expect(result).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect((result[0]!.args as { name: string }).name).toBe("C");
  });

  test("create + later updates → create kept + last update kept (in order)", () => {
    const log: DraftCommand[] = [
      {
        path: "addInsight",
        args: { id: "i1", name: "Initial" },
        compactionKey: "insight:i1",
        kind: "create",
      },
      {
        path: "renameInsight",
        args: { id: "i1", name: "Renamed" },
        compactionKey: "insight:i1",
        kind: "update",
      },
      {
        path: "renameInsight",
        args: { id: "i1", name: "Final" },
        compactionKey: "insight:i1",
        kind: "update",
      },
    ];
    const result = compactLog(log);
    // create + last-update survive, in original order
    expect(result).toHaveLength(2);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(result[0]!.kind).toBe("create");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(result[1]!.kind).toBe("update");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect((result[1]!.args as { name: string }).name).toBe("Final");
  });

  test("delete of a canonical row → kept", () => {
    // No prior create for this key → it's a canonical row being deleted.
    const log: DraftCommand[] = [
      {
        path: "renameInsight",
        args: { id: "existing", name: "X" },
        compactionKey: "insight:existing",
        kind: "update",
      },
      {
        path: "deleteInsight",
        args: { id: "existing" },
        compactionKey: "insight:existing",
        kind: "delete",
      },
    ];
    const result = compactLog(log);
    // Update is superseded by the delete; delete is kept.
    expect(result).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(result[0]!.kind).toBe("delete");
  });

  test("commands with no compactionKey are always preserved in order", () => {
    const log: DraftCommand[] = [
      { path: "refreshSource", args: { id: "s1" } }, // no key — always kept
      { path: "refreshSource", args: { id: "s1" } }, // no key — always kept
    ];
    const result = compactLog(log);
    expect(result).toHaveLength(2);
  });

  test("independent keys compact independently", () => {
    const log: DraftCommand[] = [
      {
        path: "addInsight",
        args: { id: "i1" },
        compactionKey: "insight:i1",
        kind: "create",
      },
      {
        path: "addInsight",
        args: { id: "i2" },
        compactionKey: "insight:i2",
        kind: "create",
      },
      {
        path: "deleteInsight",
        args: { id: "i1" },
        compactionKey: "insight:i1",
        kind: "delete",
      },
    ];
    const result = compactLog(log);
    // i1 create+delete cancelled; i2 create survives
    expect(result).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect((result[0]!.args as { id: string }).id).toBe("i2");
  });

  test("empty log → empty result", () => {
    expect(compactLog([])).toHaveLength(0);
  });
});
