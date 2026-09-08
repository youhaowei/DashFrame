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

const { query, ga4Query } = vi.hoisted(() => ({
  query: vi.fn(),
  ga4Query: vi.fn(),
}));
vi.mock("@dashframe/connector-notion", () => ({
  makeNotionConnector: () => ({ query }),
}));
vi.mock("@dashframe/connector-ga4", () => ({
  makeGa4Connector: (_auth: unknown, dependencies: unknown) => ({
    query: (...args: unknown[]) => ga4Query(dependencies, ...args),
  }),
}));
import { queryGa4Property, queryNotionDatabase } from "./connectors";
const modules = import.meta.glob(
  "../../../../packages/convex-backend/convex/**/*.ts",
);

async function fixture(
  outcome:
    | "success"
    | "committed"
    | "unknown"
    | "unavailable"
    | "beginCommitted",
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
  const vault = {
    resolve: vi.fn(async () => "credential"),
    store: vi.fn(async () => `secret:${crypto.randomUUID()}`),
    delete: vi.fn(async () => undefined),
  };
  const commitImportedFrame = vi.fn(
    async (
      input: Parameters<HostContext["metadata"]["commitImportedFrame"]>[0],
    ) => {
      if (
        outcome === "success" ||
        outcome === "committed" ||
        outcome === "beginCommitted"
      ) {
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
  let loseBeginAcknowledgement = outcome === "beginCommitted";
  const beginLocalImport = vi.fn(
    async (input: { operationId: string; requestHash: string }) => {
      const claim = await native.mutation(internal.host.beginLocalImport, {
        workspaceId: "workspace",
        ...input,
      });
      if (loseBeginAcknowledgement) {
        loseBeginAcknowledgement = false;
        throw new Error("begin connection lost");
      }
      return claim;
    },
  );
  const ctx = {
    principal: { kind: "user", userId: "local-user" },
    vault,
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
      beginLocalImport,
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
      replaceDataSourceConfig: (input: {
        id: string;
        expectedRevision: number;
        expectedConfig: unknown;
        config: unknown;
      }) =>
        native.mutation(internal.host.replaceDataSourceConfig, {
          workspaceId: "workspace",
          ...input,
        } as never),
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
    beginLocalImport,
    queryResult,
    execute,
    dataSourceId,
    fields,
    tableId,
    ctx,
    vault,
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

  it("recovers the same claim when its begin acknowledgement is lost", async () => {
    const h = await fixture("beginCommitted");
    const result = await h.execute();
    expect(result.dataFrameId).toEqual(expect.any(String));
    expect(h.beginLocalImport).toHaveBeenCalledOnce();
    expect(
      await h.native.run((ctx) => ctx.db.query("localImports").collect()),
    ).toMatchObject([{ frameId: result.dataFrameId, status: "complete" }]);
  });

  it("advances the GA4 source fence after its own credential refresh", async () => {
    const h = await fixture("success");
    await h.native.run(async (ctx) => {
      const source = await ctx.db
        .query("dataSources")
        .withIndex("by_workspaceId_and_id", (q) =>
          q.eq("workspaceId", "workspace").eq("id", h.dataSourceId),
        )
        .unique();
      await ctx.db.patch(source!._id, { kind: "googleAnalytics" });
    });
    ga4Query.mockImplementationOnce(async (dependencies) => {
      await dependencies.persistTokenBundle({
        accessToken: "fresh",
        refreshToken: "refresh",
        expiresAt: Date.now() + 3_600_000,
        scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      });
      return h.queryResult;
    });
    const result = await queryGa4Property(h.ctx, {
      dataSourceId: h.dataSourceId,
      tableId: h.tableId,
      snapshot: true,
      approvedFields: h.fields,
    });
    expect(result.dataFrameId).toEqual(expect.any(String));
    expect(
      h.commitImportedFrame.mock.calls[0]![0].expectedDataSourceRevision,
    ).toBe(2);
  });

  it("recovers an exact GA4 token write after its acknowledgement is lost", async () => {
    const h = await fixture("success");
    await h.native.run(async (ctx) => {
      const source = await ctx.db
        .query("dataSources")
        .withIndex("by_workspaceId_and_id", (q) =>
          q.eq("workspaceId", "workspace").eq("id", h.dataSourceId),
        )
        .unique();
      await ctx.db.patch(source!._id, { kind: "googleAnalytics" });
    });
    const replace = h.ctx.metadata.replaceDataSourceConfig.bind(h.ctx.metadata);
    h.ctx.metadata.replaceDataSourceConfig = async (input) => {
      await replace(input);
      throw new Error("token write acknowledgement lost");
    };
    ga4Query.mockImplementationOnce(async (dependencies) => {
      await dependencies.persistTokenBundle({
        accessToken: "fresh",
        refreshToken: "refresh",
        expiresAt: Date.now() + 3_600_000,
        scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      });
      return h.queryResult;
    });
    const result = await queryGa4Property(h.ctx, {
      dataSourceId: h.dataSourceId,
      tableId: h.tableId,
      snapshot: true,
      approvedFields: h.fields,
    });
    expect(result.dataFrameId).toEqual(expect.any(String));
    expect(
      h.commitImportedFrame.mock.calls[0]![0].expectedDataSourceRevision,
    ).toBe(2);
  });

  it("publishes a confirmed GA4 refresh when obsolete credential deletion fails", async () => {
    const h = await fixture("success");
    await h.native.run(async (ctx) => {
      const source = await ctx.db
        .query("dataSources")
        .withIndex("by_workspaceId_and_id", (q) =>
          q.eq("workspaceId", "workspace").eq("id", h.dataSourceId),
        )
        .unique();
      await ctx.db.patch(source!._id, { kind: "googleAnalytics" });
    });
    h.vault.delete.mockRejectedValueOnce(
      new Error("secret must not be logged"),
    );
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    ga4Query.mockImplementationOnce(async (dependencies) => {
      await dependencies.persistTokenBundle({
        accessToken: "fresh",
        refreshToken: "refresh",
        expiresAt: Date.now() + 3_600_000,
        scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      });
      return h.queryResult;
    });
    const result = await queryGa4Property(h.ctx, {
      dataSourceId: h.dataSourceId,
      tableId: h.tableId,
      snapshot: true,
      approvedFields: h.fields,
    });
    expect(result.dataFrameId).toEqual(expect.any(String));
    expect(
      h.commitImportedFrame.mock.calls[0]![0].expectedDataSourceRevision,
    ).toBe(2);
    expect(warning).toHaveBeenCalledWith(
      "[GA4Connector] obsolete credential cleanup failed",
    );
    warning.mockRestore();
  });

  it("does not absorb an external GA4 config change during token refresh", async () => {
    const h = await fixture("success");
    await h.native.run(async (ctx) => {
      const source = await ctx.db
        .query("dataSources")
        .withIndex("by_workspaceId_and_id", (q) =>
          q.eq("workspaceId", "workspace").eq("id", h.dataSourceId),
        )
        .unique();
      await ctx.db.patch(source!._id, { kind: "googleAnalytics" });
    });
    ga4Query.mockImplementationOnce(async (dependencies) => {
      const source = await h.native.query(internal.host.getDataSource, {
        workspaceId: "workspace",
        id: h.dataSourceId,
      });
      await h.native.mutation(internal.host.replaceDataSourceConfig, {
        workspaceId: "workspace",
        id: h.dataSourceId,
        expectedRevision: source!.revision,
        expectedConfig: source!.config ?? {},
        config: {
          ...(source!.config ?? {}),
          sourceBindingVersion: "v2",
        },
      });
      await dependencies
        .persistTokenBundle({
          accessToken: "fresh",
          refreshToken: "refresh",
          expiresAt: Date.now() + 3_600_000,
          scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
        })
        .catch(() => undefined);
      return h.queryResult;
    });
    await expect(
      queryGa4Property(h.ctx, {
        dataSourceId: h.dataSourceId,
        tableId: h.tableId,
        snapshot: true,
        approvedFields: h.fields,
      }),
    ).rejects.toBeInstanceOf(ImportPublicationRejectedError);
    expect(h.bytes.size).toBe(0);
  });

  it("does not absorb a same-config revision bump after its GA4 token write", async () => {
    const h = await fixture("success");
    await h.native.run(async (ctx) => {
      const source = await ctx.db
        .query("dataSources")
        .withIndex("by_workspaceId_and_id", (q) =>
          q.eq("workspaceId", "workspace").eq("id", h.dataSourceId),
        )
        .unique();
      await ctx.db.patch(source!._id, { kind: "googleAnalytics" });
    });
    const replace = h.ctx.metadata.replaceDataSourceConfig.bind(h.ctx.metadata);
    h.ctx.metadata.replaceDataSourceConfig = async (input) => {
      await replace(input);
      const source = await h.native.query(internal.host.getDataSource, {
        workspaceId: "workspace",
        id: h.dataSourceId,
      });
      await h.native.mutation(internal.host.replaceDataSourceConfig, {
        workspaceId: "workspace",
        id: h.dataSourceId,
        expectedRevision: source!.revision,
        expectedConfig: source!.config ?? {},
        config: source!.config ?? {},
      });
    };
    ga4Query.mockImplementationOnce(async (dependencies) => {
      await dependencies
        .persistTokenBundle({
          accessToken: "fresh",
          refreshToken: "refresh",
          expiresAt: Date.now() + 3_600_000,
          scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
        })
        .catch(() => undefined);
      return h.queryResult;
    });
    await expect(
      queryGa4Property(h.ctx, {
        dataSourceId: h.dataSourceId,
        tableId: h.tableId,
        snapshot: true,
        approvedFields: h.fields,
      }),
    ).rejects.toBeInstanceOf(ImportPublicationRejectedError);
  });

  it("durably queues rejected frame cleanup when eager deletion fails", async () => {
    const h = await fixture("success");
    h.commitImportedFrame.mockRejectedValueOnce(
      new ImportPublicationRejectedError("SOURCE_BINDING_CHANGED"),
    );
    vi.mocked(h.storage.delete).mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    await expect(h.execute()).rejects.toBeInstanceOf(
      ImportPublicationRejectedError,
    );
    expect(h.bytes.size).toBe(1);
    expect(
      await h.native.run((ctx) => ctx.db.query("localImports").collect()),
    ).toEqual([]);
    expect(
      await h.native.run((ctx) => ctx.db.query("cleanupJobs").collect()),
    ).toMatchObject([{ kind: "frame", state: "pending" }]);
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
