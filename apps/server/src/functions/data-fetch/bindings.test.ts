import { schema } from "@dashframe/server-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ga4ConnectorFor } = vi.hoisted(() => ({ ga4ConnectorFor: vi.fn() }));
vi.mock("../app-artifacts", () => ({ ga4ConnectorFor }));

import {
  fetchGa4Binding,
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

function context(rows: { table?: unknown; source?: unknown }) {
  return {
    db: {
      from: (target: unknown) => ({
        where: () => ({
          first: async () =>
            target === schema.dataTables ? rows.table : rows.source,
        }),
      }),
    },
  } as never;
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
      { ...source, kind: "notion" },
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
      query: vi.fn().mockResolvedValue({
        arrowBuffer: "arrow",
        fieldIds: ["f"],
        fields: [],
        rowCount: 2,
      }),
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
});
