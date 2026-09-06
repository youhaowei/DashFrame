/// <reference types="vite/client" />
import { internal } from "@dashframe/convex-backend/api";
import schema from "@dashframe/convex-backend/schema";
import type { DataFrameStorage } from "@dashframe/engine";
import type { Field } from "@dashframe/types";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { describe, expect, it, vi } from "vite-plus/test";
import type { HostContext } from "./context";
import { PublicationOutcomeUnknownError } from "./data-fetch/publisher";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@dashframe/connector-notion", () => ({
  makeNotionConnector: () => ({ query }),
}));
import { queryNotionDatabase } from "./connectors";
const modules = import.meta.glob(
  "../../../../packages/convex-backend/convex/**/*.ts",
);

async function fixture(outcome: "committed" | "unknown" | "unavailable") {
  const native = convexTest(schema, modules);
  const dataSourceId = crypto.randomUUID(),
    tableId = crypto.randomUUID(),
    fieldId = crypto.randomUUID();
  const fields: Field[] = [
    {
      id: fieldId,
      name: "value",
      columnName: "value",
      tableId,
      type: "number",
      sensitivity: "cleared",
      sensitivitySource: "user",
    },
  ];
  await native.run(async (ctx) => {
    await ctx.db.insert("dataSources", {
      workspaceId: "workspace",
      id: dataSourceId,
      revision: 1,
      name: "Notion",
      kind: "notion",
      config: { apiKey: `secret:${crypto.randomUUID()}` },
      createdAt: 0,
    });
    await ctx.db.insert("dataTables", {
      workspaceId: "workspace",
      id: tableId,
      revision: 1,
      name: "Values",
      dataSourceId,
      table: "remote-database",
      fields,
      metrics: [],
      sourceSchema: null,
      createdAt: 0,
    });
  });
  const bytes = new Map<string, Uint8Array>();
  const storage: DataFrameStorage = {
    save: vi.fn(async (id, value) => {
      bytes.set(id, value);
    }),
    delete: vi.fn(async (id) => {
      bytes.delete(id);
    }),
    load: async (id) => bytes.get(id) ?? null,
    exists: async (id) => bytes.has(id),
    list: async () => [...bytes.keys()],
    getUsage: async () => ({ count: bytes.size }),
  };
  const commitImportedFrame = vi.fn(
    async (
      input: Parameters<HostContext["metadata"]["commitImportedFrame"]>[0],
    ) => {
      if (outcome === "committed")
        await native.mutation(
          internal.host.commitImportedFrame,
          JSON.parse(
            JSON.stringify({ workspaceId: "workspace", ...input }),
          ) as FunctionArgs<typeof internal.host.commitImportedFrame>,
        );
      throw new Error("publication connection lost");
    },
  );
  const getOperation = vi.fn(async (operationId: string) => {
    if (outcome === "unavailable") throw new Error("confirmation unavailable");
    return native.query(internal.host.getOperation, {
      workspaceId: "workspace",
      operationId,
    });
  });
  const ctx = {
    principal: { kind: "user", userId: "local-user" },
    vault: {},
    dataFrameStorage: storage,
    metadata: {
      getDataSource: (id: string) =>
        native.query(internal.host.getDataSource, {
          workspaceId: "workspace",
          id,
        }),
      getDataTable: (id: string) =>
        native.query(internal.host.getDataTable, {
          workspaceId: "workspace",
          id,
        }),
      commitImportedFrame,
      getOperation,
    },
  } as unknown as HostContext;
  query.mockResolvedValue({
    arrowBuffer: Buffer.from(
      tableToIPC(tableFromArrays({ value: [42] })),
    ).toString("base64"),
    fields,
    fieldIds: [fieldId],
    rowCount: 1,
  });
  const execute = () =>
    queryNotionDatabase(ctx, {
      dataSourceId,
      tableId,
      databaseId: "remote-database",
      snapshot: true,
      approvedFields: fields,
    });
  return {
    native,
    bytes,
    storage,
    commitImportedFrame,
    getOperation,
    execute,
    tableId,
  };
}

describe("connector snapshot publication", () => {
  it("returns the saved frame when its native commit succeeded but the acknowledgement was lost", async () => {
    const h = await fixture("committed");
    const result = await h.execute();
    expect(result.dataFrameId).toEqual(expect.any(String));
    expect(h.bytes.has(result.dataFrameId!)).toBe(true);
    expect(h.commitImportedFrame).toHaveBeenCalledOnce();
    expect(h.getOperation).toHaveBeenCalledWith(`import:${result.dataFrameId}`);
    expect(
      await h.native.query(internal.host.getDataTable, {
        workspaceId: "workspace",
        id: h.tableId,
      }),
    ).toMatchObject({ dataFrameId: result.dataFrameId });
    expect(h.storage.delete).not.toHaveBeenCalled();
  });

  it.each(["unknown", "unavailable"] as const)(
    "retains immutable bytes when publication is %s",
    async (outcome) => {
      const h = await fixture(outcome);
      await expect(h.execute()).rejects.toBeInstanceOf(
        PublicationOutcomeUnknownError,
      );
      expect(h.bytes.size).toBe(1);
      expect(h.storage.delete).not.toHaveBeenCalled();
      expect(h.commitImportedFrame).toHaveBeenCalledOnce();
      expect(
        await h.native.query(internal.host.getDataTable, {
          workspaceId: "workspace",
          id: h.tableId,
        }),
      ).not.toHaveProperty("dataFrameId");
    },
  );
});
