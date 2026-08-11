import { FileDataFrameStorage } from "@dashframe/engine-server/file-dataframe-storage";
import { openArtifactDb, schema } from "@dashframe/server-core";
import type { Field, UUID } from "@dashframe/types";
import { Table, tableToIPC, vectorFromArray } from "apache-arrow";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { buildDashframeApp } from "../../app";
import { LOCAL_USER_ID } from "../../permissions";
import { ingestLocalFrame } from "./local-ingest";

const sourceId = "10000000-0000-4000-8000-000000000001" as UUID;
const tableId = "10000000-0000-4000-8000-000000000002" as UUID;
const fieldId = "10000000-0000-4000-8000-000000000003" as UUID;
const fields: Field[] = [
  {
    id: fieldId,
    tableId,
    name: "amount",
    columnName: "amount",
    type: "number",
  },
];

function arrowBase64(name = "amount") {
  return Buffer.from(
    tableToIPC(new Table({ [name]: vectorFromArray([1, 2]) })),
  ).toString("base64");
}

function preparedContext(transaction: () => Promise<never>) {
  const storage = {
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const table = {
    id: tableId,
    dataSourceId: sourceId,
    name: "Orders",
    fields,
  };
  const source = { id: sourceId, kind: "local" };
  return {
    storage,
    ctx: {
      dataFrameStorage: storage,
      db: {
        tablesWritten: new Set<string>(),
        from: (target: unknown) => ({
          where: () => ({
            first: async () => (target === schema.dataTables ? table : source),
          }),
        }),
      },
      artifactDb: { transaction },
    } as never,
  };
}

describe("local DataFrame ingestion", () => {
  it("persists Arrow bytes and atomically links a server-owned local frame", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashframe-local-ingest-"));
    const db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    const storage = new FileDataFrameStorage(join(dir, "frames"));
    try {
      await db.insert(schema.dataSources).values({
        id: sourceId,
        name: "Local Files",
        kind: "local",
        storage: "local",
        config: {},
        createdBy: { kind: "user" },
      });
      await db.insert(schema.dataTables).values({
        id: tableId,
        dataSourceId: sourceId,
        name: "Orders",
        table: "orders.csv",
        fields,
        metrics: [],
      });

      const app = await buildDashframeApp({ db, dataFrameStorage: storage });
      const { result } = await app.call(
        "ingestLocalDataFrame",
        {
          dataTableId: tableId,
          arrowBase64: arrowBase64(),
          primaryKey: "amount",
        },
        { principal: { kind: "user", userId: LOCAL_USER_ID }, artifactDb: db },
      );

      expect(result).toMatchObject({ rowCount: 2, columnCount: 1 });
      const ready = result as { dataFrameId: UUID };
      await expect(storage.load(ready.dataFrameId)).resolves.toBeInstanceOf(
        Uint8Array,
      );
      const frame = await db
        .select()
        .from(schema.dataFrames)
        .where(eq(schema.dataFrames.id, ready.dataFrameId));
      expect(frame[0]).toMatchObject({
        id: ready.dataFrameId,
        definitionId: tableId,
        sourceId,
        primaryKey: "amount",
        rowCount: 2,
        columnCount: 1,
      });
      const table = await db
        .select()
        .from(schema.dataTables)
        .where(eq(schema.dataTables.id, tableId));
      expect(table[0]?.dataFrameId).toBe(ready.dataFrameId);

      const replaced = await app.call(
        "ingestLocalDataFrame",
        {
          dataTableId: tableId,
          arrowBase64: arrowBase64(),
          replacement: {
            expectedDataFrameId: ready.dataFrameId,
            name: "Orders v2",
            table: "orders-v2.csv",
            sourceSchema: {
              columns: [{ name: "amount", type: "number" }],
              version: 1,
              lastSyncedAt: 1,
            },
            fields,
            metrics: [],
          },
        },
        { principal: { kind: "user", userId: LOCAL_USER_ID }, artifactDb: db },
      );
      const replacement = replaced.result as { dataFrameId: UUID };
      expect([...replaced.tablesWritten].sort()).toEqual([
        "data_frames",
        "data_tables",
      ]);
      expect(
        (
          await db
            .select()
            .from(schema.dataTables)
            .where(eq(schema.dataTables.id, tableId))
        )[0],
      ).toMatchObject({
        name: "Orders v2",
        table: "orders-v2.csv",
        dataFrameId: replacement.dataFrameId,
      });
      expect(
        await db
          .select()
          .from(schema.dataFrames)
          .where(eq(schema.dataFrames.id, ready.dataFrameId)),
      ).toHaveLength(1);
      await expect(storage.load(ready.dataFrameId)).resolves.toBeInstanceOf(
        Uint8Array,
      );
      await expect(
        storage.load(replacement.dataFrameId),
      ).resolves.toBeInstanceOf(Uint8Array);
    } finally {
      await db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects schema or primary-key drift before writing bytes", async () => {
    const h = preparedContext(async () => {
      throw new Error("transaction should not run");
    });
    await expect(
      ingestLocalFrame(h.ctx, tableId, arrowBase64("other")),
    ).rejects.toThrow("SOURCE_SCHEMA_CHANGED");
    await expect(
      ingestLocalFrame(h.ctx, tableId, arrowBase64(), "missing"),
    ).rejects.toThrow("LOCAL_FRAME_INVALID");
    await expect(
      ingestLocalFrame(h.ctx, tableId, arrowBase64(), undefined, {
        expectedDataFrameId: null,
        name: "Orders",
        table: "orders.csv",
        sourceSchema: { columns: [], version: 1, lastSyncedAt: 1 },
        fields,
        metrics: [],
      }),
    ).rejects.toThrow("LOCAL_FRAME_INVALID");
    await expect(
      ingestLocalFrame(h.ctx, tableId, arrowBase64(), undefined, {
        expectedDataFrameId: null,
        name: "Orders",
        table: "orders.csv",
        sourceSchema: {
          columns: [{ name: "amount", type: "number", isIdentifier: "yes" }],
          version: 1,
          lastSyncedAt: 1,
        },
        fields,
        metrics: [],
      }),
    ).rejects.toThrow("LOCAL_FRAME_INVALID");
    await expect(
      ingestLocalFrame(h.ctx, tableId, arrowBase64(), undefined, {
        expectedDataFrameId: null,
        name: "Orders",
        table: "orders.csv",
        sourceSchema: {
          columns: [{ name: "amount", type: "number" }],
          version: 1,
          lastSyncedAt: 1,
        },
        fields: [{ ...fields[0], sensitivity: "secret" }],
        metrics: [],
      }),
    ).rejects.toThrow("LOCAL_FRAME_INVALID");
    expect(h.storage.save).not.toHaveBeenCalled();
  });

  it("deletes newly saved bytes when publication fails", async () => {
    const h = preparedContext(async () => {
      throw new Error("db failed");
    });
    await expect(
      ingestLocalFrame(h.ctx, tableId, arrowBase64()),
    ).rejects.toThrow("db failed");
    expect(h.storage.save).toHaveBeenCalledOnce();
    expect(h.storage.delete).toHaveBeenCalledWith(
      h.storage.save.mock.calls[0]?.[0],
    );
  });

  it("preserves the publication error when cleanup also fails", async () => {
    const h = preparedContext(async () => {
      throw new Error("primary publication failure");
    });
    h.storage.delete.mockRejectedValueOnce(new Error("cleanup failure"));
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await expect(
      ingestLocalFrame(h.ctx, tableId, arrowBase64()),
    ).rejects.toThrow("primary publication failure");
    expect(logged).toHaveBeenCalledWith(
      "Failed to clean up unpublished local frame",
      expect.objectContaining({ message: "cleanup failure" }),
    );
    logged.mockRestore();
  });

  it("fails initial ingest without an orphan when its table is deleted during durable save", async () => {
    let deleted = false;
    const storage = {
      save: vi.fn(async () => {
        // Deterministically model DeleteNode winning after bytes become durable
        // but before the publication transaction begins.
        deleted = true;
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const insert = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      dataFrameStorage: storage,
      db: {
        tablesWritten: new Set<string>(),
        from: (target: unknown) => ({
          where: () => ({
            first: async () =>
              target === schema.dataTables
                ? {
                    id: tableId,
                    dataSourceId: sourceId,
                    name: "Orders",
                    fields,
                    dataFrameId: null,
                  }
                : { id: sourceId, kind: "local" },
          }),
        }),
      },
      artifactDb: {
        transaction: async (publish: (tx: unknown) => Promise<void>) =>
          publish({
            update: () => ({
              set: () => ({
                where: () => ({
                  returning: async () => (deleted ? [] : [{ id: tableId }]),
                }),
              }),
            }),
            insert: () => ({ values: insert }),
          }),
      },
    } as never;

    await expect(ingestLocalFrame(ctx, tableId, arrowBase64())).rejects.toThrow(
      "TARGET_NOT_READY",
    );

    expect(insert).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledOnce();
    expect(
      (ctx as { db: { tablesWritten: Set<string> } }).db.tablesWritten,
    ).toHaveProperty("size", 0);
  });

  it("preserves the prior frame and table metadata when replacement storage fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashframe-local-replace-fail-"));
    const db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    const storage = new FileDataFrameStorage(join(dir, "frames"));
    const priorFrameId = "10000000-0000-4000-8000-000000000010" as UUID;
    try {
      await db.insert(schema.dataSources).values({
        id: sourceId,
        name: "Local Files",
        kind: "local",
        storage: "local",
        config: {},
        createdBy: { kind: "user" },
      });
      await storage.save(priorFrameId, Buffer.from(arrowBase64(), "base64"));
      await db.insert(schema.dataFrames).values({
        id: priorFrameId,
        storage: { type: "file", key: priorFrameId },
        fieldIds: [fieldId],
        name: "Orders",
        sourceId,
        definitionId: tableId,
        rowCount: 2,
        columnCount: 1,
      });
      await db.insert(schema.dataTables).values({
        id: tableId,
        dataSourceId: sourceId,
        name: "Orders",
        table: "orders.csv",
        fields,
        metrics: [],
        dataFrameId: priorFrameId,
      });
      const before = await db
        .select()
        .from(schema.dataTables)
        .where(eq(schema.dataTables.id, tableId));
      const beforeBytes = await storage.load(priorFrameId);
      const app = await buildDashframeApp({ db, dataFrameStorage: storage });
      vi.spyOn(storage, "save").mockRejectedValueOnce(
        new Error("injected storage failure"),
      );

      await expect(
        app.call(
          "ingestLocalDataFrame",
          {
            dataTableId: tableId,
            arrowBase64: arrowBase64(),
            replacement: {
              expectedDataFrameId: priorFrameId,
              name: "Orders v2",
              table: "orders-v2.csv",
              sourceSchema: {
                columns: [{ name: "amount", type: "number" }],
                version: 1,
                lastSyncedAt: 1,
              },
              fields,
              metrics: [],
            },
          },
          {
            principal: { kind: "user", userId: LOCAL_USER_ID },
            artifactDb: db,
          },
        ),
      ).rejects.toThrow("injected storage failure");

      expect(
        await db
          .select()
          .from(schema.dataTables)
          .where(eq(schema.dataTables.id, tableId)),
      ).toEqual(before);
      await expect(storage.load(priorFrameId)).resolves.toEqual(beforeBytes);
      expect(await storage.list()).toEqual([priorFrameId]);
    } finally {
      await db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a stale replacement pointer and removes only its new bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashframe-local-replace-stale-"));
    const db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    const storage = new FileDataFrameStorage(join(dir, "frames"));
    const expectedFrameId = "10000000-0000-4000-8000-000000000011" as UUID;
    const currentFrameId = "10000000-0000-4000-8000-000000000012" as UUID;
    try {
      await db.insert(schema.dataSources).values({
        id: sourceId,
        name: "Local Files",
        kind: "local",
        storage: "local",
        config: {},
        createdBy: { kind: "user" },
      });
      for (const id of [expectedFrameId, currentFrameId]) {
        await storage.save(id, Buffer.from(arrowBase64(), "base64"));
        await db.insert(schema.dataFrames).values({
          id,
          storage: { type: "file", key: id },
          fieldIds: [fieldId],
          name: "Orders",
          sourceId,
          definitionId: tableId,
          rowCount: 2,
          columnCount: 1,
        });
      }
      await db.insert(schema.dataTables).values({
        id: tableId,
        dataSourceId: sourceId,
        name: "Concurrent winner",
        table: "winner.csv",
        fields,
        metrics: [],
        dataFrameId: currentFrameId,
      });
      const onWrite = vi.fn();
      const app = await buildDashframeApp({
        db,
        dataFrameStorage: storage,
        onWrite,
      });

      await expect(
        app.call(
          "ingestLocalDataFrame",
          {
            dataTableId: tableId,
            arrowBase64: arrowBase64(),
            replacement: {
              expectedDataFrameId: expectedFrameId,
              name: "Stale loser",
              table: "loser.csv",
              sourceSchema: {
                columns: [{ name: "amount", type: "number" }],
                version: 1,
                lastSyncedAt: 1,
              },
              fields,
              metrics: [],
            },
          },
          {
            principal: { kind: "user", userId: LOCAL_USER_ID },
            artifactDb: db,
          },
        ),
      ).rejects.toThrow("STALE_LOCAL_REPLACEMENT");

      const table = await db
        .select()
        .from(schema.dataTables)
        .where(eq(schema.dataTables.id, tableId));
      expect(table[0]).toMatchObject({
        name: "Concurrent winner",
        table: "winner.csv",
        dataFrameId: currentFrameId,
      });
      expect((await storage.list()).sort()).toEqual(
        [currentFrameId, expectedFrameId].sort(),
      );
      expect(onWrite).not.toHaveBeenCalled();
    } finally {
      await db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allows exactly one of two replacements validated against the same prior frame", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashframe-local-replace-race-"));
    const db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    const storage = new FileDataFrameStorage(join(dir, "frames"));
    const priorFrameId = "10000000-0000-4000-8000-000000000013" as UUID;
    try {
      await db.insert(schema.dataSources).values({
        id: sourceId,
        name: "Local Files",
        kind: "local",
        storage: "local",
        config: {},
        createdBy: { kind: "user" },
      });
      await storage.save(priorFrameId, Buffer.from(arrowBase64(), "base64"));
      await db.insert(schema.dataFrames).values({
        id: priorFrameId,
        storage: { type: "file", key: priorFrameId },
        fieldIds: [fieldId],
        name: "Orders",
        sourceId,
        definitionId: tableId,
        rowCount: 2,
        columnCount: 1,
      });
      await db.insert(schema.dataTables).values({
        id: tableId,
        dataSourceId: sourceId,
        name: "Orders",
        table: "orders.csv",
        fields,
        metrics: [],
        dataFrameId: priorFrameId,
      });
      const realSave = storage.save.bind(storage);
      let savesReady = 0;
      let releaseSaves!: () => void;
      const bothSaved = new Promise<void>((resolve) => {
        releaseSaves = resolve;
      });
      vi.spyOn(storage, "save").mockImplementation(async (id, bytes) => {
        await realSave(id, bytes);
        savesReady += 1;
        if (savesReady === 2) releaseSaves();
        await bothSaved;
      });
      const app = await buildDashframeApp({ db, dataFrameStorage: storage });
      const replace = (name: string) =>
        app.call(
          "ingestLocalDataFrame",
          {
            dataTableId: tableId,
            arrowBase64: arrowBase64(),
            replacement: {
              expectedDataFrameId: priorFrameId,
              name,
              table: `${name}.csv`,
              sourceSchema: {
                columns: [{ name: "amount", type: "number" }],
                version: 1,
                lastSyncedAt: 1,
              },
              fields,
              metrics: [],
            },
          },
          {
            principal: { kind: "user", userId: LOCAL_USER_ID },
            artifactDb: db,
          },
        );

      const settled = await Promise.allSettled([
        replace("First"),
        replace("Second"),
      ]);
      const fulfilled = settled.filter(
        (result) => result.status === "fulfilled",
      );
      const rejected = settled.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        message: "STALE_LOCAL_REPLACEMENT",
      });
      const winner = (
        fulfilled[0] as PromiseFulfilledResult<{
          result: { dataFrameId: UUID };
          tablesWritten: Set<string>;
        }>
      ).value.result;
      expect(
        [
          ...(
            fulfilled[0] as PromiseFulfilledResult<{
              tablesWritten: Set<string>;
            }>
          ).value.tablesWritten,
        ].sort(),
      ).toEqual(["data_frames", "data_tables"]);
      const table = (
        await db
          .select()
          .from(schema.dataTables)
          .where(eq(schema.dataTables.id, tableId))
      )[0];
      expect(table?.dataFrameId).toBe(winner.dataFrameId);
      expect(["First", "Second"]).toContain(table?.name);
      await expect(storage.load(priorFrameId)).resolves.toBeInstanceOf(
        Uint8Array,
      );
      await expect(storage.load(winner.dataFrameId)).resolves.toBeInstanceOf(
        Uint8Array,
      );
      expect(await storage.list()).toHaveLength(2);
      expect(await db.select().from(schema.dataFrames)).toHaveLength(2);
    } finally {
      await db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
