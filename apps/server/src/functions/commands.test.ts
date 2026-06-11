/**
 * Command vocabulary (YW-106) tests.
 *
 * These exercise the vocabulary THROUGH the real engine: a batch of typed
 * commands (built with `cmd(...)`) dispatched by `@wystack/server`'s
 * `applyCommands` against a real artifact DB. They assert the contracts the
 * spec freezes — atomicity of GetOrCreateDataSource, batch atomicity with the
 * client-id invariant, each command mapping to the right write, mid-batch
 * rollback, and preview persisting nothing.
 */
import { openArtifactDb, schema } from "@dashframe/server-core";
import { createWyStack, type WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { functions } from "../functions";
import { cmd } from "./commands";

const { dataSources, dataTables } = schema;

describe("command vocabulary", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;
  // applyCommands is registered alongside query/mutation on @wystack/server;
  // import lazily so the test reads top-down with the engine right where used.
  let applyCommands: typeof import("@wystack/server").applyCommands;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-cmd-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await createWyStack({ db, functions });
    ({ applyCommands } = await import("@wystack/server"));
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function id(): string {
    return crypto.randomUUID();
  }

  async function commit(...commands: ReturnType<typeof cmd>[]) {
    return applyCommands(app, commands, { mode: "commit" });
  }

  // Assertion reads go through the raw Drizzle handle and filter in JS — the
  // server package has no direct `drizzle-orm` dep for a `where()` operator,
  // and these test DBs hold a handful of rows.
  async function sourcesById(sourceId: string) {
    const rows = await db.select().from(dataSources);
    return rows.filter((r) => r.id === sourceId);
  }
  async function sourcesByKind(kind: string) {
    const rows = await db.select().from(dataSources);
    return rows.filter((r) => r.kind === kind);
  }
  async function allSources() {
    return db.select().from(dataSources);
  }
  async function tablesById(tableId: string) {
    const rows = await db.select().from(dataTables);
    return rows.filter((r) => r.id === tableId);
  }

  describe("GetOrCreateDataSource (the reference atomic command)", () => {
    // Note on the defect & why these assert what they do: the original bug (PR
    // #46 Greptile P1) was two concurrent ingests both passing a `kind`-keyed
    // existence check and both inserting. PGLite is a single-connection WASM
    // Postgres, so `applyCommands` batches here serialize — they can't reproduce
    // a true read-read-write-write interleaving. The fix is therefore tested by
    // its STRUCTURE, not by racing: idempotency is keyed on the PRIMARY KEY (not
    // `kind`), and the PK is the hard backstop that makes a double-insert
    // impossible regardless of interleaving. The two tests below pin exactly
    // that — the kind-keyed racy version would FAIL the first (it returns the
    // existing row for a second, distinct id of the same kind) and could never
    // satisfy the PK guarantee the second asserts.

    it("should key idempotency on the id, not the kind (two ids of one kind = two sources)", async () => {
      const idA = id();
      const idB = id();
      await commit(
        cmd("GetOrCreateDataSource", { id: idA, type: "local", name: "A" }),
      );
      await commit(
        cmd("GetOrCreateDataSource", { id: idB, type: "local", name: "B" }),
      );

      // The racy kind-keyed version would return idA for the second call and
      // leave ONE row. The id-keyed fix keeps them distinct: get-or-create is a
      // PK upsert, so two different ids are two sources even with one kind.
      expect(await sourcesById(idA)).toHaveLength(1);
      expect(await sourcesById(idB)).toHaveLength(1);
      expect(await sourcesByKind("local")).toHaveLength(2);
    });

    it("should make a same-id double-insert impossible — the PK backstop (no double-insert defect)", async () => {
      const sourceId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "local", name: "First" }),
      );

      // A second create with the SAME client id cannot persist a second row —
      // the primary key rejects it. This is the structural guarantee the racy
      // kind-keyed check lacked: even if two ingests both decide to insert, the
      // PK admits exactly one. The losing batch throws and rolls back.
      await expect(
        commit(
          cmd("CreateDataSource", {
            id: sourceId,
            type: "local",
            name: "Second",
          }),
        ),
      ).rejects.toThrow();

      const rows = await sourcesById(sourceId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe("First");
    });

    it("should return the existing row on a second get-or-create with the same id", async () => {
      const sourceId = id();
      await commit(
        cmd("GetOrCreateDataSource", {
          id: sourceId,
          type: "local",
          name: "Local Files",
        }),
      );
      const second = await commit(
        cmd("GetOrCreateDataSource", {
          id: sourceId,
          type: "local",
          name: "Ignored Second Name",
        }),
      );
      expect(second.results[0]?.value).toEqual({ id: sourceId });

      const rows = await allSources();
      expect(rows).toHaveLength(1);
      // The original name is preserved — get-or-create does not overwrite.
      expect(rows[0]?.name).toBe("Local Files");
    });
  });

  describe("client-id invariant across a batch", () => {
    it("should create a DataSource then a DataTable referencing it atomically", async () => {
      const sourceId = id();
      const tableId = id();

      const result = await commit(
        cmd("CreateDataSource", {
          id: sourceId,
          type: "csv",
          name: "Sales CSV",
        }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "Q1",
          table: "q1.csv",
        }),
      );
      expect(result.mode).toBe("commit");
      expect(result.commands).toHaveLength(2);

      const source = await sourcesById(sourceId);
      const table = await tablesById(tableId);
      expect(source).toHaveLength(1);
      expect(table).toHaveLength(1);
      expect(table[0]?.dataSourceId).toBe(sourceId);
    });
  });

  describe("each command maps to the right write", () => {
    it("should write kind/name/config for CreateDataSource", async () => {
      const sourceId = id();
      await commit(
        cmd("CreateDataSource", {
          id: sourceId,
          type: "notion",
          name: "Notion",
          apiKey: "secret-key",
        }),
      );
      const [row] = await sourcesById(sourceId);
      expect(row?.kind).toBe("notion");
      expect(row?.name).toBe("Notion");
      expect((row?.config as { apiKey?: string }).apiKey).toBe("secret-key");
    });

    it("should replace only config (not name) for SetDataSourceConfig, decomposed from updateDataSource", async () => {
      const sourceId = id();
      await commit(
        cmd("CreateDataSource", {
          id: sourceId,
          type: "notion",
          name: "Original",
          apiKey: "old",
        }),
        cmd("SetDataSourceConfig", { id: sourceId, apiKey: "new" }),
      );
      const [row] = await sourcesById(sourceId);
      expect((row?.config as { apiKey?: string }).apiKey).toBe("new");
      expect(row?.name).toBe("Original");
    });

    it("should rename without touching config for RenameNode, decomposed from updateDataSource", async () => {
      const sourceId = id();
      await commit(
        cmd("CreateDataSource", {
          id: sourceId,
          type: "notion",
          name: "Original",
          apiKey: "keep",
        }),
        cmd("RenameNode", { id: sourceId, name: "Renamed" }),
      );
      const [row] = await sourcesById(sourceId);
      expect(row?.name).toBe("Renamed");
      expect((row?.config as { apiKey?: string }).apiKey).toBe("keep");
    });

    it("should edit the jsonb array via AddField then RemoveField, decomposed from patchDataTableArray", async () => {
      const sourceId = id();
      const tableId = id();
      const fieldId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
        cmd("AddField", {
          nodeId: tableId,
          field: {
            id: fieldId,
            name: "Amount",
            tableId,
            columnName: "amount",
            type: "number",
          },
        }),
      );

      let [row] = await tablesById(tableId);
      expect((row?.fields as { id: string }[]).map((f) => f.id)).toEqual([
        fieldId,
      ]);

      await commit(cmd("RemoveField", { nodeId: tableId, fieldId }));
      [row] = await tablesById(tableId);
      expect(row?.fields).toEqual([]);
    });

    it("should reject a duplicate field id in AddField (no illegal two-items-one-id state)", async () => {
      const sourceId = id();
      const tableId = id();
      const fieldId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
        cmd("AddField", {
          nodeId: tableId,
          field: {
            id: fieldId,
            name: "Amount",
            tableId,
            columnName: "amount",
            type: "number",
          },
        }),
      );

      // Second Add of the same id must throw (and roll back), not append a dup.
      await expect(
        commit(
          cmd("AddField", {
            nodeId: tableId,
            field: {
              id: fieldId,
              name: "Amount again",
              tableId,
              columnName: "amount",
              type: "number",
            },
          }),
        ),
      ).rejects.toThrow(/already exists/);

      const [row] = await tablesById(tableId);
      expect((row?.fields as { id: string }[]).map((f) => f.id)).toEqual([
        fieldId,
      ]);
    });

    it("should stamp dataFrameId and lastFetchedAt for RefreshDataTable", async () => {
      const sourceId = id();
      const tableId = id();
      const frameId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
        cmd("RefreshDataTable", { id: tableId, dataFrameId: frameId }),
      );
      const [row] = await tablesById(tableId);
      expect(row?.dataFrameId).toBe(frameId);
      expect(row?.lastFetchedAt).toBeInstanceOf(Date);
    });

    it("should replace the source schema slice for SetDataTableSchema", async () => {
      const sourceId = id();
      const tableId = id();
      const sourceSchema = { columns: [{ name: "amount", type: "number" }] };
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
        cmd("SetDataTableSchema", {
          id: tableId,
          sourceSchema: sourceSchema as never,
        }),
      );
      const [row] = await tablesById(tableId);
      expect(row?.sourceSchema).toEqual(sourceSchema);
    });

    it("should merge updates by id without rebinding the id for UpdateField", async () => {
      const sourceId = id();
      const tableId = id();
      const fieldId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
        cmd("AddField", {
          nodeId: tableId,
          field: {
            id: fieldId,
            name: "Amount",
            tableId,
            columnName: "amount",
            type: "number",
          },
        }),
        // A stray `id` in updates must NOT rebind the field — pinned id wins.
        cmd("UpdateField", {
          nodeId: tableId,
          fieldId,
          updates: { name: "Total", id: id() } as never,
        }),
      );
      const [row] = await tablesById(tableId);
      const fields = row?.fields as { id: string; name: string }[];
      expect(fields).toHaveLength(1);
      expect(fields[0]?.id).toBe(fieldId);
      expect(fields[0]?.name).toBe("Total");
    });

    it("should merge updates by id for UpdateMetric", async () => {
      const sourceId = id();
      const tableId = id();
      const metricId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
        cmd("AddMetric", {
          nodeId: tableId,
          metric: {
            id: metricId,
            name: "Sum",
            expression: "sum(amount)",
          } as never,
        }),
        cmd("UpdateMetric", {
          nodeId: tableId,
          metricId,
          updates: { name: "Total Sum" } as never,
        }),
      );
      const [row] = await tablesById(tableId);
      const metrics = row?.metrics as { id: string; name: string }[];
      expect(metrics).toHaveLength(1);
      expect(metrics[0]?.name).toBe("Total Sum");
    });

    it("should throw on a missing id for SetDataTableSchema (no silent no-op)", async () => {
      await expect(
        commit(
          cmd("SetDataTableSchema", { id: id(), sourceSchema: {} as never }),
        ),
      ).rejects.toThrow(/not found/);
    });

    it("should throw on a missing id for RefreshDataTable (no silent no-op)", async () => {
      await expect(
        commit(cmd("RefreshDataTable", { id: id(), dataFrameId: id() })),
      ).rejects.toThrow(/not found/);
    });
  });

  describe("atomicity", () => {
    it("should roll back the whole batch when a mid-batch command fails", async () => {
      const sourceId = id();
      const tableId = id();

      await expect(
        commit(
          cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
          cmd("CreateDataTable", {
            id: tableId,
            dataSourceId: sourceId,
            name: "T",
            table: "t.csv",
          }),
          // Fails: removing a field that does not exist throws → rolls back ALL.
          cmd("RemoveField", { nodeId: tableId, fieldId: id() }),
        ),
      ).rejects.toThrow();

      // Nothing from the batch persisted — the earlier inserts rolled back too.
      const sources = await sourcesById(sourceId);
      const tables = await tablesById(tableId);
      expect(sources).toHaveLength(0);
      expect(tables).toHaveLength(0);
    });
  });

  describe("preview", () => {
    it("should persist nothing for a preview batch", async () => {
      const sourceId = id();
      const result = await applyCommands(
        app,
        [cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" })],
        { mode: "preview" },
      );
      expect(result.mode).toBe("preview");
      // It WOULD have written the data_sources table.
      expect(result.tablesWritten.size).toBeGreaterThan(0);

      const rows = await sourcesById(sourceId);
      expect(rows).toHaveLength(0);
    });
  });
});
