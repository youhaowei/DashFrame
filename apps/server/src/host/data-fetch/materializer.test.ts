import type { DataFrameStorage } from "@dashframe/engine";
import type { DataTable, Field, UUID } from "@dashframe/types";
import { describe, expect, it, vi } from "vite-plus/test";

import type { HostContext, HostDataPlaneRuntime } from "../context";
import {
  createInsightMaterializer,
  fieldsFromInsightResult,
  type InsightMaterializerDependencies,
  type PublishMaterialization,
  type SourceGeneration,
} from "./materializer";
import { trustedPublishedSourceGenerations } from "./published-source-error";
import {
  publishMaterialization,
  PublicationOutcomeUnknownError,
} from "./publisher";

describe("fieldsFromInsightResult", () => {
  it("keeps physical result aliases while restoring source field identity", () => {
    expect(
      fieldsFromInsightResult(
        [
          {
            id: "field_10000000_0000_4000_8000_000000000001",
            name: "Country",
            type: "string",
          },
          {
            id: "metric_20000000_0000_4000_8000_000000000002",
            name: "Revenue",
            type: "number",
          },
        ],
        "upstream",
      ),
    ).toEqual([
      expect.objectContaining({
        id: "10000000-0000-4000-8000-000000000001",
        columnName: "field_10000000_0000_4000_8000_000000000001",
      }),
      expect.objectContaining({
        id: "20000000-0000-4000-8000-000000000002",
        columnName: "metric_20000000_0000_4000_8000_000000000002",
      }),
    ]);
  });
});

const field = (id: string, tableId: string, name: string): Field => ({
  id,
  tableId,
  name,
  columnName: name,
  type: "string",
});

function source(tableId: string, name = "value"): SourceGeneration {
  const fields = [field(`${tableId}-field`, tableId, name)];
  const table: DataTable = {
    id: tableId,
    dataSourceId: `${tableId}-source`,
    name: tableId,
    table: `${tableId}-remote`,
    fields,
    metrics: [],
    createdAt: 0,
  };
  return {
    table,
    arrow: new Uint8Array([tableId.length]),
    fields,
    rowCount: 1,
    provenance: { connectorKind: "googleAnalytics", bindingVersion: "v1" },
  };
}

function harness(overrides: Partial<InsightMaterializerDependencies> = {}) {
  const bytes = new Map<string, Uint8Array>();
  const registered = new Map<string, Uint8Array>();
  const storage: DataFrameStorage = {
    save: vi.fn(async (id, value) => {
      bytes.set(id, value);
    }),
    load: vi.fn(async (id) => bytes.get(id) ?? null),
    delete: vi.fn(async (id) => {
      bytes.delete(id);
    }),
    exists: vi.fn(async (id) => bytes.has(id)),
    list: vi.fn(async () => [...bytes.keys()] as UUID[]),
    getUsage: vi.fn(async () => ({ count: bytes.size })),
  };
  const runtime: HostDataPlaneRuntime = {
    queryArrow: vi.fn(async () => new Uint8Array([9])),
    registerArrowTable: vi.fn(async (name, value) => {
      registered.set(name, value);
    }),
    unregisterTable: vi.fn(async (name) => {
      registered.delete(name);
    }),
  };
  let id = 0;
  const publish = vi.fn(
    async (_ctx: HostContext, _materialization: PublishMaterialization) =>
      undefined,
  );
  const resolveSource = vi.fn(async (_ctx, tableId: UUID) => source(tableId));
  const dependencies: InsightMaterializerDependencies = {
    storage: () => storage,
    runtime: () => runtime,
    resolveSource,
    resolveInsight: vi.fn(async () => {
      throw new Error("TARGET_NOT_READY");
    }),
    compile: ({ tables }) => {
      if ([...tables.values()].some((table) => !table.dataFrameId)) {
        throw new Error("FETCH_COMPILE_FAILED");
      }
      return "select 1";
    },
    inspect: () => ({
      rowCount: 2,
      schema: [{ id: "result-field", name: "result", type: "string" }],
    }),
    publish,
    fingerprint: () => "fingerprint",
    coalescingScope: (_ctx, target, insight) =>
      JSON.stringify([target, insight]),
    uuid: () => `frame-${++id}`,
    now: () => 123,
    tableName: (frameId) => `df_${frameId}`,
    ...overrides,
  };
  return {
    bytes,
    registered,
    storage,
    runtime,
    publish,
    resolveSource,
    dependencies,
  };
}

const insight = {
  baseTableId: "base",
  selectedFields: ["base-field"],
  metrics: [],
  joins: [
    {
      type: "left" as const,
      rightTableId: "joined",
      leftKey: "value",
      rightKey: "value",
    },
  ],
};

describe("immutable Insight materializer", () => {
  it("fetches every source and publishes only metadata after the result is saved", async () => {
    const h = harness();
    const materializer = createInsightMaterializer(h.dependencies);

    const ready = await materializer.materialize({
      ctx: {} as never,
      target: { kind: "ephemeral" },
      insight,
    });

    expect(h.resolveSource).toHaveBeenCalledTimes(2);
    expect(h.publish).toHaveBeenCalledOnce();
    expect(h.publish.mock.calls[0]![1]).toMatchObject({
      target: { kind: "ephemeral" },
      sources: [
        { source: { table: { id: "base" } } },
        { source: { table: { id: "joined" } } },
      ],
      result: { id: "frame-3", rowCount: 2 },
    });
    expect(ready).toEqual({
      status: "ready",
      dataFrameId: "frame-3",
      schema: [{ id: "result-field", name: "result", type: "string" }],
      rowCount: 2,
      definitionFingerprint: "fingerprint",
      provenance: { connectorKind: "googleAnalytics", bindingVersion: "v1" },
      fetchedAt: 123,
      sourceGenerations: [
        { tableId: "base", dataFrameId: "frame-1" },
        { tableId: "joined", dataFrameId: "frame-2" },
      ],
    });
    expect(h.bytes.size).toBe(3);
    expect(h.registered.size).toBe(3);
  });

  it("rejects source schema drift before saving or publishing", async () => {
    const h = harness({
      resolveSource: async (_ctx, tableId) => {
        const value = source(tableId);
        return { ...value, fields: [field("changed", tableId, "changed")] };
      },
    });
    const materializer = createInsightMaterializer(h.dependencies);

    await expect(
      materializer.materialize({
        ctx: {} as never,
        target: { kind: "ephemeral" },
        insight,
      }),
    ).rejects.toThrow("SOURCE_SCHEMA_CHANGED");
    expect(h.storage.save).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });

  it("publishes persisted field identities after structurally equal discovery", async () => {
    const h = harness({
      resolveSource: async (_ctx, tableId) => {
        const value = source(tableId);
        return {
          ...value,
          fields: value.fields.map((candidate) => ({
            ...candidate,
            id: `regenerated-${candidate.id}`,
          })),
        };
      },
    });

    await createInsightMaterializer(h.dependencies).materialize({
      ctx: {} as never,
      target: { kind: "ephemeral" },
      insight,
    });

    expect(h.publish).toHaveBeenCalledOnce();
    const published = h.publish.mock.calls[0]![1];
    expect(published.sources.map(({ frame }) => frame.fieldIds)).toEqual([
      ["base-field"],
      ["joined-field"],
    ]);
    expect(published.sources.map(({ frame }) => frame.schema[0]?.id)).toEqual([
      "base-field",
      "joined-field",
    ]);
  });

  it("materializes an Insight source recursively and reuses its immutable result", async () => {
    const compile = vi.fn(({ tables }) => {
      const upstream = tables.get("upstream");
      if (upstream) {
        expect(upstream.fields).toEqual([
          expect.objectContaining({
            id: "result-field",
            columnName: "field_result_field",
          }),
        ]);
      }
      return "select 1";
    });
    const h = harness({
      resolveInsight: vi.fn(async () => ({
        baseTableId: "base",
        source: { sourceType: "dataTable" as const, sourceId: "base" },
        selectedFields: ["base-field"],
        metrics: [],
      })),
      compile,
      inspect: () => ({
        rowCount: 2,
        schema: [{ id: "field_result_field", name: "result", type: "string" }],
      }),
    });
    const ready = await createInsightMaterializer(h.dependencies).materialize({
      ctx: {} as never,
      target: { kind: "saved", insightId: "derived" },
      insight: {
        baseTableId: "upstream",
        source: { sourceType: "insight", sourceId: "upstream" },
        selectedFields: ["result-field"],
        metrics: [],
      },
    });

    expect(ready.status).toBe("ready");
    expect(ready.sourceGenerations).toEqual([
      { tableId: "base", dataFrameId: "frame-1" },
    ]);
    expect(h.resolveSource).toHaveBeenCalledOnce();
    expect(h.publish).toHaveBeenCalledTimes(2);
    expect(h.publish.mock.calls[0]![1].target).toEqual({ kind: "transient" });
    expect(h.bytes.size).toBe(2);
    expect(h.registered.size).toBe(2);
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it("removes a recursive transient result when the outer query fails", async () => {
    const baseId = "10000000-0000-4000-8000-000000000001" as UUID;
    const upstreamId = "10000000-0000-4000-8000-000000000002" as UUID;
    const derivedId = "10000000-0000-4000-8000-000000000003" as UUID;
    const sourceFrameId = "10000000-0000-4000-8000-000000000004" as UUID;
    const transientFrameId = "10000000-0000-4000-8000-000000000005" as UUID;
    let compileCount = 0;
    const h = harness({
      resolveInsight: vi.fn(async () => ({
        baseTableId: baseId,
        source: { sourceType: "dataTable" as const, sourceId: baseId },
        selectedFields: ["base-field"],
        metrics: [],
      })),
      compile: () => {
        compileCount += 1;
        if (compileCount === 2) throw new Error("outer compile");
        return "select 1";
      },
      inspect: () => ({
        rowCount: 2,
        schema: [{ id: "field_result_field", name: "result", type: "string" }],
      }),
    });
    const frameIds = [sourceFrameId, transientFrameId];
    h.dependencies.uuid = () => frameIds.shift()!;

    const failure = await createInsightMaterializer(h.dependencies)
      .materialize({
        ctx: {} as never,
        target: { kind: "saved", insightId: derivedId },
        insight: {
          baseTableId: upstreamId,
          source: { sourceType: "insight", sourceId: upstreamId },
          selectedFields: ["result-field"],
          metrics: [],
        },
      })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: "outer compile" });
    expect(trustedPublishedSourceGenerations(failure)).toEqual([
      { tableId: baseId, dataFrameId: sourceFrameId },
    ]);

    expect(h.publish).toHaveBeenCalledOnce();
    expect(h.publish.mock.calls[0]![1].target).toEqual({ kind: "transient" });
    expect([...h.bytes.keys()]).toEqual([sourceFrameId]);
    expect([...h.registered.keys()]).toEqual([`df_${sourceFrameId}`]);
  });

  it("fails before outer publication when transient cleanup fails", async () => {
    const h = harness({
      resolveInsight: vi.fn(async () => ({
        baseTableId: "base",
        source: { sourceType: "dataTable" as const, sourceId: "base" },
        selectedFields: ["base-field"],
        metrics: [],
      })),
      inspect: () => ({
        rowCount: 2,
        schema: [{ id: "field_result_field", name: "result", type: "string" }],
      }),
    });
    (h.storage.delete as ReturnType<typeof vi.fn>).mockImplementation(
      async (id) => {
        if (id === "frame-2") throw new Error("transient cleanup");
        h.bytes.delete(id);
      },
    );

    await expect(
      createInsightMaterializer(h.dependencies).materialize({
        ctx: {} as never,
        target: { kind: "saved", insightId: "derived" },
        insight: {
          baseTableId: "upstream",
          source: { sourceType: "insight", sourceId: "upstream" },
          selectedFields: ["result-field"],
          metrics: [],
        },
      }),
    ).rejects.toThrow("transient cleanup");

    expect(h.publish).toHaveBeenCalledOnce();
    expect(h.publish.mock.calls[0]![1].target).toEqual({ kind: "transient" });
    expect(h.bytes.has("frame-1")).toBe(true);
    expect(h.bytes.has("frame-3")).toBe(false);
    expect(h.registered.has("df_frame-3")).toBe(false);
  });

  it("fails closed on a recursively corrupted Insight cycle", async () => {
    const h = harness({
      resolveInsight: vi.fn(async (_ctx, insightId) => ({
        baseTableId: insightId,
        source: { sourceType: "insight" as const, sourceId: insightId },
        selectedFields: [],
        metrics: [],
      })),
    });
    await expect(
      createInsightMaterializer(h.dependencies).materialize({
        ctx: {} as never,
        target: { kind: "saved", insightId: "derived" },
        insight: {
          baseTableId: "upstream",
          source: { sourceType: "insight", sourceId: "upstream" },
          selectedFields: [],
          metrics: [],
        },
      }),
    ).rejects.toThrow("TARGET_NOT_READY");
    expect(h.publish).not.toHaveBeenCalled();
  });

  it("fails closed when an Insight source chain exceeds the recursion bound", async () => {
    const h = harness({
      resolveInsight: vi.fn(async (_ctx, insightId) => {
        const next = `${insightId}-next`;
        return {
          baseTableId: next,
          source: { sourceType: "insight" as const, sourceId: next },
          selectedFields: [],
          metrics: [],
        };
      }),
    });
    await expect(
      createInsightMaterializer(h.dependencies).materialize({
        ctx: {} as never,
        target: { kind: "saved", insightId: "derived" },
        insight: {
          baseTableId: "upstream",
          source: { sourceType: "insight", sourceId: "upstream" },
          selectedFields: [],
          metrics: [],
        },
      }),
    ).rejects.toThrow("TARGET_NOT_READY");
    expect(h.publish).not.toHaveBeenCalled();
  });

  it.each([
    [
      "compile",
      {
        compile: () => {
          throw new Error("compile");
        },
      },
    ],
    [
      "query",
      {
        runtime: () => ({
          ...harness().runtime,
          queryArrow: async () => {
            throw new Error("query");
          },
        }),
      },
    ],
    [
      "inspect",
      {
        inspect: () => {
          throw new Error("malformed");
        },
      },
    ],
  ])("cleans every new frame when %s fails", async (_name, override) => {
    const h = harness(override as Partial<InsightMaterializerDependencies>);
    const materializer = createInsightMaterializer(h.dependencies);
    await expect(
      materializer.materialize({
        ctx: {} as never,
        target: { kind: "saved", insightId: "insight" },
        insight,
      }),
    ).rejects.toThrow();
    expect(h.bytes.size).toBe(0);
    expect(h.registered.size).toBe(0);
  });

  it("retains every pending frame when publication commits then loses its response", async () => {
    let committed: PublishMaterialization | undefined;
    const h = harness({
      publish: async (_ctx, value) => {
        committed = value;
        throw new Error("response lost");
      },
    });
    await expect(
      createInsightMaterializer(h.dependencies).materialize({
        ctx: {} as never,
        target: { kind: "saved", insightId: "insight" },
        insight,
      }),
    ).rejects.toThrow("response lost");
    expect(committed?.result.id).toBe("frame-3");
    expect([...h.bytes.keys()]).toEqual(["frame-1", "frame-2", "frame-3"]);
    expect(h.registered.size).toBe(3);
    expect(h.storage.delete).not.toHaveBeenCalled();
    expect(h.runtime.unregisterTable).not.toHaveBeenCalled();
  });

  it("retains unknown publications even when confirmation reads no operation yet", async () => {
    const h = harness({ publish: publishMaterialization });
    const metadata = {
      publishMaterialization: vi.fn(async () => {
        throw new Error("connection lost");
      }),
      getOperation: vi.fn(async () => null),
    };
    const failure = await createInsightMaterializer(h.dependencies)
      .materialize({
        ctx: { metadata } as unknown as HostContext,
        target: { kind: "saved", insightId: "insight" },
        insight,
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PublicationOutcomeUnknownError);
    expect(metadata.getOperation).toHaveBeenCalledWith("materialize:frame-3");
    expect([...h.bytes.keys()]).toEqual(["frame-1", "frame-2", "frame-3"]);
    expect(h.registered.size).toBe(3);
    expect(h.storage.delete).not.toHaveBeenCalled();
    expect(h.runtime.unregisterTable).not.toHaveBeenCalled();
  });

  it("recovers a committed materialization from its durable operation record", async () => {
    const h = harness({ publish: publishMaterialization });
    let committed: unknown;
    const metadata = {
      publishMaterialization: vi.fn(async (value: PublishMaterialization) => {
        committed = JSON.parse(JSON.stringify(value));
        throw new Error("response lost");
      }),
      getOperation: vi.fn(async () => ({ request: committed, result: null })),
    };
    const ready = await createInsightMaterializer(h.dependencies).materialize({
      ctx: { metadata } as unknown as HostContext,
      target: { kind: "saved", insightId: "insight" },
      insight,
    });
    expect(ready).toMatchObject({ status: "ready", dataFrameId: "frame-3" });
    expect(metadata.publishMaterialization).toHaveBeenCalledOnce();
    expect(metadata.getOperation).toHaveBeenCalledWith("materialize:frame-3");
    expect(h.bytes.size).toBe(3);
    expect(h.registered.size).toBe(3);
  });

  it("retains old handles while atomically publishing the new saved association", async () => {
    let current = "old-frame";
    const h = harness({
      publish: async (_ctx, value) => {
        expect(value.target).toEqual({ kind: "saved", insightId: "insight" });
        current = value.result.id;
      },
    });
    h.bytes.set("old-frame", new Uint8Array([1]));
    const materializer = createInsightMaterializer(h.dependencies);
    await materializer.materialize({
      ctx: {} as never,
      target: { kind: "saved", insightId: "insight" },
      insight,
    });

    expect(current).toBe("frame-3");
    expect(h.bytes.has("old-frame")).toBe(true);
  });

  it("attempts cleanup when storage reports failure after a generation is tracked", async () => {
    const h = harness();
    h.dependencies.storage = () => ({
      ...h.storage,
      save: async () => {
        throw new Error("save");
      },
    });
    await expect(
      createInsightMaterializer(h.dependencies).materialize({
        ctx: {} as never,
        target: { kind: "ephemeral" },
        insight,
      }),
    ).rejects.toThrow("save");
    expect(h.storage.delete).toHaveBeenCalledWith("frame-1");
    expect(h.publish).not.toHaveBeenCalled();
  });

  it("removes saved bytes when native registration fails", async () => {
    const h = harness();
    h.dependencies.runtime = () => ({
      ...h.runtime,
      registerArrowTable: async () => {
        throw new Error("register");
      },
    });
    await expect(
      createInsightMaterializer(h.dependencies).materialize({
        ctx: {} as never,
        target: { kind: "ephemeral" },
        insight,
      }),
    ).rejects.toThrow("register");
    expect(h.bytes.size).toBe(0);
    expect(h.publish).not.toHaveBeenCalled();
  });

  it("coalesces only in-flight work and performs a new live run after settlement", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let resolves = 0;
    const h = harness({
      resolveSource: async (_ctx, tableId) => {
        resolves += 1;
        await gate;
        return source(tableId);
      },
    });
    const materializer = createInsightMaterializer(h.dependencies);
    const args = {
      ctx: {} as never,
      target: { kind: "ephemeral" } as const,
      insight,
    };
    const first = materializer.materialize(args);
    const second = materializer.materialize(args);
    expect(second).toBe(first);
    release();
    await Promise.all([first, second]);
    expect(resolves).toBe(2);

    await materializer.materialize(args);
    expect(resolves).toBe(4);
  });

  it("does not reuse an in-flight operation after its source generation changes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let generation = "source-frame-1";
    const h = harness({
      resolveSource: async (_ctx, tableId) => {
        await gate;
        return source(tableId);
      },
    });
    h.dependencies.coalescingScope = async () => generation;
    const materializer = createInsightMaterializer(h.dependencies);
    const args = {
      ctx: {} as never,
      target: { kind: "ephemeral" } as const,
      insight,
    };
    const first = materializer.materialize(args);
    await Promise.resolve();
    generation = "source-frame-2";
    const replacement = materializer.materialize(args);
    release();

    await Promise.all([first, replacement]);
    expect(h.publish).toHaveBeenCalledTimes(2);
  });
});
