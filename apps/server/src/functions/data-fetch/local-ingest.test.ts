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
        from: (target: unknown) => ({
          where: () => ({
            first: async () => (target === schema.dataTables ? table : source),
          }),
        }),
        transaction,
      },
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
        { principal: { kind: "user", userId: LOCAL_USER_ID } },
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
});
