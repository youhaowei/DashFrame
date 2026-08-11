import { schema } from "@dashframe/server-core";
import {
  Float64,
  Table,
  tableFromIPC,
  tableToIPC,
  vectorFromArray,
} from "apache-arrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ga4ConnectorFor, notionConnectorFor, postgresConnectorFor } =
  vi.hoisted(() => ({
    ga4ConnectorFor: vi.fn(),
    notionConnectorFor: vi.fn(),
    postgresConnectorFor: vi.fn(),
  }));
vi.mock("../app-artifacts", () => ({
  ga4ConnectorFor,
  notionConnectorFor,
  postgresConnectorFor,
}));

import {
  fetchGa4Binding,
  fetchLocalBinding,
  fetchSourceBinding,
  resolveSourceBinding,
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

function context(rows: { table?: unknown; source?: unknown; frame?: unknown }) {
  return {
    db: {
      from: (target: unknown) => ({
        where: () => ({
          first: async () => {
            if (target === schema.dataTables) return rows.table;
            if (target === schema.dataFrames) return rows.frame;
            return rows.source;
          },
        }),
      }),
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

  it("accepts explicit v1 and fail-closes malformed, unknown, wrong-kind, or missing rows", async () => {
    await expect(
      resolveSourceBinding(
        context({
          table,
          source: { ...source, config: { sourceBindingVersion: "v1" } },
        }),
        table.id,
      ),
    ).resolves.toBeTruthy();
    for (const bad of [
      { ...source, config: { sourceBindingVersion: 1 } },
      { ...source, config: { sourceBindingVersion: "v2" } },
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
      expect(query).toHaveBeenCalledWith(table.table, table.id);
    },
  );

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
