import {
  Float64,
  Table,
  tableFromIPC,
  tableToIPC,
  vectorFromArray,
} from "apache-arrow";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MAX_LOCAL_ARROW_BYTES } from "@dashframe/types";

const { ga4ConnectorFor, notionConnectorFor, postgresConnectorFor } =
  vi.hoisted(() => ({
    ga4ConnectorFor: vi.fn(),
    notionConnectorFor: vi.fn(),
    postgresConnectorFor: vi.fn(),
  }));
vi.mock("../connectors", () => ({
  ga4ConnectorFor,
  notionConnectorFor,
  postgresConnectorFor,
}));

import {
  fetchGa4Binding,
  fetchLocalBinding,
  fetchNotionBinding,
  fetchSourceBinding,
  resolveSourceBinding,
  streamPostgresBinding,
} from "./bindings";

const table = {
  id: "table-1",
  dataSourceId: "source-1",
  table: "properties/123",
  fields: [],
};
const source = {
  id: "source-1",
  kind: "googleAnalytics",
  config: {},
};

function context(
  rows: { table?: unknown; source?: unknown; frame?: unknown },
  workspaceOwnerId?: string,
) {
  return {
    workspaceOwnerId,
    metadata: {
      getDataTable: async () => rows.table,
      getDataFrame: async () => rows.frame,
      getDataSource: async () => rows.source,
    },
  } as never;
}

function page(values: number[], field = "value", fieldId = "f") {
  return {
    arrowBuffer: Buffer.from(
      tableToIPC(
        new Table({ [field]: vectorFromArray(values, new Float64()) }),
      ),
    ).toString("base64"),
    fieldIds: [fieldId],
    fields: [
      {
        id: fieldId,
        name: field,
        tableId: table.id,
        columnName: field,
        type: "number",
      },
    ],
    rowCount: values.length,
  };
}

describe("Source Binding registry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("derives the persisted table and source, defaulting legacy GA4 to v1", async () => {
    await expect(
      resolveSourceBinding(context({ table, source }), table.id),
    ).resolves.toMatchObject({
      connectorKind: "googleAnalytics",
      sourceBindingVersion: "v1",
      dataSourceId: source.id,
      table: { id: table.id, table: "properties/123" },
    });
  });

  it("accepts registered GA4 versions and fail-closes malformed, unknown, wrong-kind, or missing rows", async () => {
    await expect(
      resolveSourceBinding(
        context({
          table,
          source: { ...source, config: { sourceBindingVersion: "v1" } },
        }),
        table.id,
      ),
    ).resolves.toBeTruthy();
    await expect(
      resolveSourceBinding(
        context({
          table,
          source: { ...source, config: { sourceBindingVersion: "v2" } },
        }),
        table.id,
      ),
    ).resolves.toMatchObject({ sourceBindingVersion: "v2" });
    for (const bad of [
      { ...source, config: { sourceBindingVersion: 1 } },
      { ...source, config: { sourceBindingVersion: "v3" } },
      { ...source, kind: "missing" },
    ]) {
      await expect(
        resolveSourceBinding(context({ table, source: bad }), table.id),
      ).rejects.toThrow("TARGET_NOT_READY");
    }
    await expect(
      resolveSourceBinding(context({ source }), table.id),
    ).rejects.toThrow("TARGET_NOT_READY");
    await expect(
      resolveSourceBinding(context({ table }), table.id),
    ).rejects.toThrow("TARGET_NOT_READY");
  });

  it("routes GA4 v2 through the acquisition connector profile", async () => {
    ga4ConnectorFor.mockResolvedValue({
      query: vi.fn().mockResolvedValue(page([1, 2])),
    });
    const v2Source = {
      ...source,
      config: { sourceBindingVersion: "v2" },
    };
    const binding = await resolveSourceBinding(
      context({ table, source: v2Source }),
      table.id,
    );

    await expect(
      fetchSourceBinding(context({ table, source: v2Source }), binding),
    ).resolves.toMatchObject({
      provenance: {
        connectorKind: "googleAnalytics",
        sourceBindingVersion: "v2",
      },
    });
    expect(ga4ConnectorFor).toHaveBeenCalledWith(
      expect.anything(),
      source.id,
      "v2",
    );
  });

  it("uses only the persisted table property and returns server provenance", async () => {
    ga4ConnectorFor.mockResolvedValue({
      query: vi.fn().mockResolvedValue(page([1, 2])),
    });
    const binding = await resolveSourceBinding(
      context({ table, source }),
      table.id,
    );
    const result = await fetchSourceBinding(
      context({ table, source }),
      binding,
    );
    expect(ga4ConnectorFor).toHaveBeenCalledWith(expect.anything(), source.id);
    expect(result).toMatchObject({
      rowCount: 2,
      provenance: {
        connectorKind: "googleAnalytics",
        sourceBindingVersion: "v1",
      },
    });
  });

  it.each([
    ["notion", notionConnectorFor],
    ["postgres", postgresConnectorFor],
  ])(
    "lets the %s connector exhaust its provider without synthetic offsets",
    async (kind, connectorFor) => {
      const query = vi
        .fn()
        .mockResolvedValue(
          page(Array.from({ length: 10_000 }, (_, index) => index)),
        );
      connectorFor.mockResolvedValue({
        query,
      });
      const binding = await resolveSourceBinding(
        context({ table, source: { ...source, kind } }),
        table.id,
      );

      await expect(
        fetchSourceBinding(context({ table }), binding),
      ).resolves.toMatchObject({
        rowCount: 10_000,
        provenance: { connectorKind: kind, sourceBindingVersion: "v1" },
      });
      expect(connectorFor).toHaveBeenCalledWith(expect.anything(), source.id);
      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(table.table, table.id, {
        signal: undefined,
      });
    },
  );

  it("bounds hosted Postgres rows and bytes before accepting connector output", async () => {
    const query = vi.fn().mockResolvedValue(page([1, 2]));
    postgresConnectorFor.mockResolvedValue({ query });
    const postgresSource = { ...source, kind: "postgres" };
    const binding = await resolveSourceBinding(
      context({ table, source: postgresSource }, "owner-a"),
      table.id,
    );

    await fetchSourceBinding(
      context({ table, source: postgresSource }, "owner-a"),
      binding,
    );

    expect(query).toHaveBeenCalledWith(table.table, table.id, {
      pagination: { offset: 0, limit: 10_001 },
      maxRows: 10_000,
      maxBytes: Math.floor(MAX_LOCAL_ARROW_BYTES / 4),
    });
  });

  it("reads a local table only from its current server-owned frame", async () => {
    const localTable = {
      ...table,
      dataFrameId: "frame-1",
      fields: page([]).fields,
    };
    const localSource = { ...source, kind: "local" };
    const bytes = Buffer.from(page([1, 2]).arrowBuffer, "base64");
    const frame = {
      id: "frame-1",
      sourceId: source.id,
      definitionId: table.id,
      storage: { type: "file", key: "frame-1" },
      fieldIds: ["f"],
      rowCount: 2,
    };
    const ctx = context({ table: localTable, source: localSource, frame });
    (ctx as { dataFrameStorage?: unknown }).dataFrameStorage = {
      load: vi.fn().mockResolvedValue(bytes),
    };
    const binding = await resolveSourceBinding(ctx, table.id);

    await expect(fetchLocalBinding(ctx, binding)).resolves.toMatchObject({
      rowCount: 2,
      provenance: { connectorKind: "local", sourceBindingVersion: "v1" },
    });
  });

  it("rejects an unprepared local table without reading storage", async () => {
    const storage = { load: vi.fn() };
    const localTable = { ...table, dataFrameId: null };
    const ctx = context({
      table: localTable,
      source: { ...source, kind: "local" },
    });
    (ctx as { dataFrameStorage?: unknown }).dataFrameStorage = storage;
    const binding = await resolveSourceBinding(ctx, table.id);

    await expect(fetchSourceBinding(ctx, binding)).rejects.toThrow(
      "TARGET_NOT_READY",
    );
    expect(storage.load).not.toHaveBeenCalled();
  });

  it("contains provider and credential failures", async () => {
    ga4ConnectorFor.mockRejectedValue(new Error("token=secret"));
    const binding = await resolveSourceBinding(
      context({ table, source }),
      table.id,
    );
    await expect(
      fetchGa4Binding(context({ table, source }), binding),
    ).rejects.toThrow("FETCH_EXECUTION_FAILED");
  });

  it("exhausts GA4 pages and publishes one lossless Arrow frame", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(page(Array.from({ length: 10_000 }, (_, i) => i)))
      .mockResolvedValueOnce(page([10_000, 10_001]));
    ga4ConnectorFor.mockResolvedValue({ query });
    const binding = await resolveSourceBinding(
      context({ table, source }),
      table.id,
    );

    const result = await fetchGa4Binding(context({ table, source }), binding);

    expect(query).toHaveBeenNthCalledWith(1, table.table, table.id, {
      pagination: { offset: 0, limit: 10_000 },
    });
    expect(query).toHaveBeenNthCalledWith(2, table.table, table.id, {
      pagination: { offset: 10_000, limit: 10_000 },
    });
    expect(result.rowCount).toBe(10_002);
    expect(
      tableFromIPC(Buffer.from(result.arrowBuffer, "base64")).numRows,
    ).toBe(10_002);
  });

  it.each([
    ["googleAnalytics", ga4ConnectorFor, fetchGa4Binding],
    ["notion", notionConnectorFor, fetchNotionBinding],
  ] as const)(
    "cancels a pending native %s provider request",
    async (kind, factory, fetchBinding) => {
      const abort = new AbortController();
      const ctx = context({ table, source: { ...source, kind } });
      Object.assign(ctx, { requestSignal: abort.signal });
      let started!: () => void;
      const pendingProvider = new Promise<void>((resolve) => {
        started = resolve;
      });
      const query = vi.fn(
        (_table: string, _id: string, options?: { signal?: AbortSignal }) => {
          started();
          return new Promise<ReturnType<typeof page>>((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(options.signal?.reason),
              { once: true },
            );
          });
        },
      );
      factory.mockResolvedValue({ query });
      const binding = await resolveSourceBinding(ctx, table.id);
      const pending = fetchBinding(ctx, binding);
      await pendingProvider;
      abort.abort(new Error("FETCH_DEADLINE_EXCEEDED"));
      await expect(pending).rejects.toThrow("FETCH_EXECUTION_FAILED");
      expect(query.mock.calls[0]?.[2]?.signal).toBe(abort.signal);
    },
  );

  it("bounds hosted GA4 to one sentinel window and rejects a prefix", async () => {
    const query = vi
      .fn()
      .mockResolvedValue(page(Array.from({ length: 10_001 }, (_, i) => i)));
    ga4ConnectorFor.mockResolvedValue({ query });
    const ctx = context({ table, source }, "owner");
    const binding = await resolveSourceBinding(ctx, table.id);

    await expect(fetchGa4Binding(ctx, binding)).rejects.toThrow(
      "FETCH_EXECUTION_FAILED",
    );
    expect(query).toHaveBeenCalledWith(table.table, table.id, {
      pagination: { offset: 0, limit: 10_001 },
    });
    expect(query).toHaveBeenCalledOnce();
  });

  it("bounds hosted Notion before its connector paginates the complete source", async () => {
    const query = vi.fn().mockResolvedValue(page([1, 2]));
    notionConnectorFor.mockResolvedValue({ query });
    const notionSource = { ...source, kind: "notion" };
    const ctx = context({ table, source: notionSource }, "owner");
    const binding = await resolveSourceBinding(ctx, table.id);

    await expect(fetchNotionBinding(ctx, binding)).resolves.toMatchObject({
      rowCount: 2,
    });
    expect(query).toHaveBeenCalledWith(table.table, table.id, {
      pagination: { offset: 0, limit: 10_001 },
      maxRows: 10_000,
      maxBytes: Math.floor(MAX_LOCAL_ARROW_BYTES / 4),
    });
  });

  it("canonicalizes first-page field identity while accepting fresh ids on later GA4 pages", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(
        page(
          Array.from({ length: 10_000 }, (_, i) => i),
          "value",
          "first-id",
        ),
      )
      .mockResolvedValueOnce(page([10_000], "value", "fresh-id"));
    ga4ConnectorFor.mockResolvedValue({ query });
    const binding = await resolveSourceBinding(
      context({ table, source }),
      table.id,
    );

    const result = await fetchGa4Binding(context({ table, source }), binding);

    expect(result.fieldIds).toEqual(["first-id"]);
    expect(result.fields[0]?.id).toBe("first-id");
    expect(result.rowCount).toBe(10_001);
  });

  it("proves completion with an empty page after an exact page boundary", async () => {
    const productionEmptyPage = () => {
      const arrow = new Table({ value: vectorFromArray([]) });
      return {
        arrowBuffer: Buffer.from(tableToIPC(arrow, "stream")).toString(
          "base64",
        ),
        rowCount: 0,
        fieldIds: ["f"],
        fields: page([]).fields,
      };
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce(page(Array.from({ length: 10_000 }, (_, i) => i)))
      .mockResolvedValueOnce(productionEmptyPage());
    ga4ConnectorFor.mockResolvedValue({ query });
    const binding = await resolveSourceBinding(
      context({ table, source }),
      table.id,
    );

    await expect(
      fetchGa4Binding(context({ table, source }), binding),
    ).resolves.toMatchObject({ rowCount: 10_000 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("fails closed if a later provider page fails", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(page(Array.from({ length: 10_000 }, (_, i) => i)))
      .mockRejectedValueOnce(new Error("provider failure"));
    ga4ConnectorFor.mockResolvedValue({ query });
    const binding = await resolveSourceBinding(
      context({ table, source }),
      table.id,
    );

    await expect(
      fetchGa4Binding(context({ table, source }), binding),
    ).rejects.toThrow("FETCH_EXECUTION_FAILED");
  });

  it("fails closed when a later page changes the Arrow schema", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(page(Array.from({ length: 10_000 }, (_, i) => i)))
      .mockResolvedValueOnce(page([1], "changed"));
    ga4ConnectorFor.mockResolvedValue({ query });
    const binding = await resolveSourceBinding(
      context({ table, source }),
      table.id,
    );

    await expect(
      fetchGa4Binding(context({ table, source }), binding),
    ).rejects.toThrow("SOURCE_SCHEMA_CHANGED");
  });

  it("fails closed on malformed Arrow or structural metadata", async () => {
    ga4ConnectorFor.mockResolvedValue({
      query: vi.fn().mockResolvedValue({ ...page([1]), rowCount: 2 }),
    });
    const binding = await resolveSourceBinding(
      context({ table, source }),
      table.id,
    );

    await expect(
      fetchGa4Binding(context({ table, source }), binding),
    ).rejects.toThrow("FETCH_EXECUTION_FAILED");
  });
});

describe("PostgreSQL streaming binding", () => {
  it("preserves the unsupported-value error from the connector", async () => {
    postgresConnectorFor.mockResolvedValue({
      queryBatches: async function* () {
        yield await Promise.reject(new Error("SOURCE_VALUE_UNSUPPORTED"));
      },
    });
    const binding = {
      connectorKind: "postgres",
      sourceBindingVersion: "v1",
      dataSourceId: "source-1",
      table,
    };
    await expect(
      streamPostgresBinding(context({ table }), binding as never).next(),
    ).rejects.toThrow("SOURCE_VALUE_UNSUPPORTED");
  });
  it("applies a custom batch byte ceiling before decoding", async () => {
    const batch = page([1, 2]);
    const bytes = Buffer.byteLength(batch.arrowBuffer, "base64");
    const queryBatches = vi.fn(async function* () {
      yield batch;
    });
    postgresConnectorFor.mockResolvedValue({ queryBatches });
    const binding = {
      connectorKind: "postgres",
      sourceBindingVersion: "v1",
      dataSourceId: "source-1",
      table: { ...table, fields: batch.fields },
    };
    const rejected = streamPostgresBinding(
      context({ table }),
      binding as never,
      undefined,
      bytes - 1,
    );
    const decode = vi.spyOn(Buffer, "from");
    await expect(rejected.next()).rejects.toThrow("FETCH_BATCH_BYTES_EXCEEDED");
    expect(
      decode.mock.calls.some((args) => args[0] === batch.arrowBuffer),
    ).toBe(false);
    decode.mockRestore();
    const accepted = streamPostgresBinding(
      context({ table }),
      binding as never,
      undefined,
      bytes,
    );
    expect(tableFromIPC((await accepted.next()).value!).numRows).toBe(2);
    await accepted.return(undefined);
  });

  it("pulls lazily and validates persisted schema on every batch", async () => {
    const batch = page([1, 2]);
    const query = vi.fn();
    let pulls = 0;
    const queryBatches = vi.fn(async function* () {
      pulls++;
      yield batch;
      pulls++;
      yield page([3], "changed");
    });
    postgresConnectorFor.mockResolvedValue({ query, queryBatches });
    const binding = {
      connectorKind: "postgres",
      sourceBindingVersion: "v1",
      dataSourceId: "source-1",
      table: { ...table, fields: batch.fields },
    };
    const iterator = streamPostgresBinding(
      context({ table }),
      binding as never,
    );
    expect(pulls).toBe(0);
    expect(tableFromIPC((await iterator.next()).value!).numRows).toBe(2);
    expect(pulls).toBe(1);
    await expect(iterator.next()).rejects.toThrow("SOURCE_SCHEMA_CHANGED");
    expect(query).not.toHaveBeenCalled();
  });

  it("forwards cancellation and closes a producer when its consumer stops", async () => {
    const batch = page([1]);
    const signal = new AbortController().signal;
    let closed = false;
    const queryBatches = vi.fn(async function* () {
      try {
        yield batch;
        yield batch;
      } finally {
        closed = true;
      }
    });
    postgresConnectorFor.mockResolvedValue({ queryBatches });
    const binding = {
      connectorKind: "postgres",
      sourceBindingVersion: "v1",
      dataSourceId: "source-1",
      table: { ...table, fields: batch.fields },
    };
    const iterator = streamPostgresBinding(
      context({ table }),
      binding as never,
      signal,
    );
    await iterator.next();
    await iterator.return(undefined);
    expect(closed).toBe(true);
    expect(queryBatches).toHaveBeenCalledWith(table.table, table.id, {
      signal,
      batchRows: 2048,
    });
  });
});
