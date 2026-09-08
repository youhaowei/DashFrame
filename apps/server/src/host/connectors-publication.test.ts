/// <reference types="vite/client" />
import { internal } from "@dashframe/convex-backend/api";
import schema from "@dashframe/convex-backend/schema";
import type { DataFrameStorage } from "@dashframe/engine";
import type { Field } from "@dashframe/types";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vite-plus/test";
import type { HostContext } from "./context";
import { PublicationOutcomeUnknownError } from "./data-fetch/publisher";
import { ImportPublicationRejectedError } from "./metadata";
import { createHostMetadata } from "./convex-metadata";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@dashframe/connector-notion", () => ({
  makeNotionConnector: () => ({ query }),
}));
import { queryNotionDatabase } from "./connectors";
const modules = import.meta.glob(
  "../../../../packages/convex-backend/convex/**/*.ts",
);

async function fixture(
  outcome: "success" | "committed" | "unknown" | "unavailable",
) {
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
  const nativeMetadata = createHostMetadata(native as never, "workspace");
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
      if (outcome === "success" || outcome === "committed") {
        await nativeMetadata.commitImportedFrame(input);
      }
      if (outcome === "success") return;
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
      beginLocalImport: (input: { operationId: string; requestHash: string }) =>
        native.mutation(internal.host.beginLocalImport, {
          workspaceId: "workspace",
          ...input,
        }),
      getLocalImport: (input: { operationId: string; requestHash: string }) =>
        native.query(internal.host.getLocalImport, {
          workspaceId: "workspace",
          ...input,
        }),
      cancelLocalImport: (input: {
        operationId: string;
        requestHash: string;
      }) =>
        native.mutation(internal.host.cancelLocalImport, {
          workspaceId: "workspace",
          ...input,
        }),
      commitImportedFrame,
      getOperation,
    },
  } as unknown as HostContext;
  const queryResult = {
    arrowBuffer: Buffer.from(
      tableToIPC(tableFromArrays({ value: [42] })),
    ).toString("base64"),
    fields,
    fieldIds: [fieldId],
    rowCount: 1,
  };
  query.mockResolvedValue(queryResult);
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
    queryResult,
    execute,
    dataSourceId,
    fields,
    tableId,
  };
}

describe("connector snapshot publication", () => {
  it("claims before fetch and completes an ordinary connector snapshot", async () => {
    const h = await fixture("success");
    query.mockImplementationOnce(async () => {
      expect(
        await h.native.run((ctx) => ctx.db.query("localImports").collect()),
      ).toMatchObject([{ status: "pending" }]);
      return h.queryResult;
    });
    const result = await h.execute();
    expect(result.dataFrameId).toEqual(expect.any(String));
    expect(h.commitImportedFrame).toHaveBeenCalledOnce();
    expect(
      await h.native.run((ctx) => ctx.db.query("localImports").collect()),
    ).toMatchObject([
      {
        frameId: result.dataFrameId,
        status: "complete",
        requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
  });

  it("cancels the claim when connector fetch fails before publication", async () => {
    const h = await fixture("success");
    query.mockRejectedValueOnce(new Error("connector unavailable"));
    await expect(h.execute()).rejects.toThrow("connector unavailable");
    expect(
      await h.native.run((ctx) => ctx.db.query("localImports").collect()),
    ).toEqual([]);
    expect(
      await h.native.run((ctx) => ctx.db.query("cleanupJobs").collect()),
    ).toMatchObject([{ kind: "frame", state: "pending" }]);
    expect(h.commitImportedFrame).not.toHaveBeenCalled();
    expect(h.bytes.size).toBe(0);
  });

  it("returns the saved frame when its native commit succeeded but the acknowledgement was lost", async () => {
    const h = await fixture("committed");
    const result = await h.execute();
    expect(result.dataFrameId).toEqual(expect.any(String));
    expect(h.bytes.has(result.dataFrameId!)).toBe(true);
    expect(h.commitImportedFrame).toHaveBeenCalledOnce();
    expect(h.getOperation).toHaveBeenCalledWith(
      `local-import:${h.commitImportedFrame.mock.calls[0]![0].operationId}`,
    );
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

  it("rejects publication when the workspace is cleared during connector fetch", async () => {
    const h = await fixture("committed");
    let releaseQuery!: () => void;
    const queryReleased = new Promise<void>((resolve) => {
      releaseQuery = resolve;
    });
    let markQueryStarted!: () => void;
    const queryStarted = new Promise<void>((resolve) => {
      markQueryStarted = resolve;
    });
    query.mockImplementationOnce(async () => {
      markQueryStarted();
      await queryReleased;
      return h.queryResult;
    });
    const executing = h.execute();
    await queryStarted;
    expect(
      await h.native.run((ctx) => ctx.db.query("localImports").collect()),
    ).toHaveLength(1);
    await h.native.mutation(internal.host.clearAllData, {
      workspaceId: "workspace",
    });
    await h.native.run(async (ctx) => {
      await ctx.db.insert("dataSources", {
        workspaceId: "workspace",
        id: h.dataSourceId,
        revision: 1,
        name: "Notion",
        kind: "notion",
        config: { apiKey: `secret:${crypto.randomUUID()}` },
        createdAt: 0,
      });
      await ctx.db.insert("dataTables", {
        workspaceId: "workspace",
        id: h.tableId,
        revision: 1,
        name: "Values",
        dataSourceId: h.dataSourceId,
        table: "remote-database",
        fields: h.fields,
        metrics: [],
        sourceSchema: null,
        createdAt: 0,
      });
    });
    releaseQuery();
    await expect(executing).rejects.toBeInstanceOf(
      ImportPublicationRejectedError,
    );
    expect(h.commitImportedFrame).toHaveBeenCalledOnce();
    expect(h.bytes.size).toBe(0);
    expect(
      await h.native.query(internal.host.getDataTable, {
        workspaceId: "workspace",
        id: h.tableId,
      }),
    ).not.toHaveProperty("dataFrameId");
  });

  it("rejects a snapshot fetched with an older source configuration", async () => {
    const h = await fixture("success");
    let releaseQuery!: () => void;
    const queryReleased = new Promise<void>((resolve) => {
      releaseQuery = resolve;
    });
    let markQueryStarted!: () => void;
    const queryStarted = new Promise<void>((resolve) => {
      markQueryStarted = resolve;
    });
    query.mockImplementationOnce(async () => {
      markQueryStarted();
      await queryReleased;
      return h.queryResult;
    });
    const executing = h.execute();
    await queryStarted;
    const source = await h.native.query(internal.host.getDataSource, {
      workspaceId: "workspace",
      id: h.dataSourceId,
    });
    await h.native.mutation(internal.host.replaceDataSourceConfig, {
      workspaceId: "workspace",
      id: h.dataSourceId,
      expectedConfig: source!.config ?? {},
      config: { apiKey: `secret:${crypto.randomUUID()}` },
    });
    releaseQuery();
    await expect(executing).rejects.toBeInstanceOf(
      ImportPublicationRejectedError,
    );
    expect(h.bytes.size).toBe(0);
    expect(
      await h.native.query(internal.host.getDataTable, {
        workspaceId: "workspace",
        id: h.tableId,
      }),
    ).not.toHaveProperty("dataFrameId");
  });

  it("does not let an older connector fetch overwrite a newer snapshot", async () => {
    const h = await fixture("success");
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    query
      .mockImplementationOnce(async () => {
        markFirstStarted();
        await firstReleased;
        return h.queryResult;
      })
      .mockResolvedValueOnce(h.queryResult);
    const first = h.execute();
    await firstStarted;
    const second = await h.execute();
    releaseFirst();
    await expect(first).rejects.toBeInstanceOf(ImportPublicationRejectedError);
    expect(
      await h.native.query(internal.host.getDataTable, {
        workspaceId: "workspace",
        id: h.tableId,
      }),
    ).toMatchObject({ dataFrameId: second.dataFrameId });
    expect(h.bytes.size).toBe(1);
  });
});
