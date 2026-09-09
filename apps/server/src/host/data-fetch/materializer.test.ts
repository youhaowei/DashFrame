import type { DataFrameStorage } from "@dashframe/engine";
import type { DataTable, Field, UUID } from "@dashframe/types";
import { describe, expect, it, vi } from "vite-plus/test";

import type { HostContext, HostDataPlaneRuntime } from "../context";
import {
  createInsightMaterializer,
  fieldsFromInsightResult,
  registerStoredFrame,
  type InsightMaterializerDependencies,
  type PublishMaterialization,
  type SourceGeneration,
} from "./materializer";
import { stubQueryEngine } from "../query-engine.fixture";
import { trustedPublishedSourceGenerations } from "./published-source-error";
import { DEFAULT_TRANSFER_LIMITS } from "./transfer";
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
    ...stubQueryEngine(),
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
    completedReplayMs: 0,
    sharedOperationTimeoutMs: 120_000,
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
  it("rejects refreshes of persisted local sources as non-refreshable", async () => {
    const persisted = source("base");
    persisted.existingFrameId = "existing-frame";
    const h = harness({ resolveSource: vi.fn(async () => persisted) });

    await expect(
      createInsightMaterializer(h.dependencies).materialize({
        ctx: {} as never,
        target: { kind: "refresh" },
        insight: {
          baseTableId: "base",
          selectedFields: [],
          metrics: [],
        },
      }),
    ).rejects.toThrow("SOURCE_NOT_REFRESHABLE");
    expect(h.storage.save).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });

  it("refreshes one source without creating an unused result frame", async () => {
    const compile = vi.fn(() => "SELECT 1");
    const h = harness({ compile });
    const materializer = createInsightMaterializer(h.dependencies);

    const ready = await materializer.materialize({
      ctx: {} as never,
      target: { kind: "refresh" },
      insight: {
        baseTableId: "base",
        selectedFields: [],
        metrics: [],
      },
    });

    expect(compile).not.toHaveBeenCalled();
    expect(h.runtime.queryArrow).not.toHaveBeenCalled();
    expect(h.storage.save).toHaveBeenCalledTimes(1);
    expect(h.publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        target: { kind: "refresh" },
        sources: [
          expect.objectContaining({
            source: expect.objectContaining({
              table: expect.objectContaining({ id: "base" }),
            }),
          }),
        ],
        result: expect.objectContaining({ id: "frame-1" }),
      }),
    );
    expect(ready).toMatchObject({
      status: "ready",
      dataFrameId: "frame-1",
      sourceGenerations: [
        { tableId: "base", dataFrameId: "frame-1", lastFetchedAt: 123 },
      ],
    });
    expect(h.bytes.size).toBe(1);
    expect(h.registered.size).toBe(1);
  });

  it("does not start another connector after a source resolution failure", async () => {
    const h = harness();
    h.resolveSource.mockRejectedValueOnce(new Error("source unavailable"));
    await expect(
      createInsightMaterializer(h.dependencies).materialize({
        ctx: {} as never,
        target: { kind: "ephemeral" },
        insight,
      }),
    ).rejects.toThrow("source unavailable");
    expect(h.resolveSource).toHaveBeenCalledTimes(1);
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.bytes.size).toBe(0);
  });

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
        { tableId: "base", dataFrameId: "frame-1", lastFetchedAt: 123 },
        { tableId: "joined", dataFrameId: "frame-2", lastFetchedAt: 123 },
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

  it.each([false, true])(
    "reports every recursive source publication with overlapping outer join: %s",
    async (overlappingJoin) => {
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
        now: vi.fn().mockReturnValueOnce(123).mockReturnValueOnce(456),
        inspect: () => ({
          rowCount: 2,
          schema: [
            { id: "field_result_field", name: "result", type: "string" },
          ],
        }),
      });
      const ready = await createInsightMaterializer(h.dependencies).materialize(
        {
          ctx: {} as never,
          target: { kind: "saved", insightId: "derived" },
          insight: {
            baseTableId: "upstream",
            source: { sourceType: "insight", sourceId: "upstream" },
            selectedFields: ["result-field"],
            metrics: [],
            ...(overlappingJoin
              ? {
                  joins: [
                    {
                      type: "left" as const,
                      rightTableId: "base",
                      leftKey: "result",
                      rightKey: "value",
                    },
                  ],
                }
              : {}),
          },
        },
      );

      expect(ready.status).toBe("ready");
      expect(ready.fetchedAt).toBe(456);
      expect(ready.sourceGenerations).toEqual([
        { tableId: "base", dataFrameId: "frame-1", lastFetchedAt: 123 },
        ...(overlappingJoin
          ? [{ tableId: "base", dataFrameId: "frame-3", lastFetchedAt: 456 }]
          : []),
      ]);
      expect(h.resolveSource).toHaveBeenCalledTimes(overlappingJoin ? 2 : 1);
      expect(h.publish).toHaveBeenCalledTimes(2);
      expect(h.publish.mock.calls[0]![1].target).toEqual({ kind: "transient" });
      expect(h.bytes.size).toBe(overlappingJoin ? 3 : 2);
      expect(h.registered.size).toBe(overlappingJoin ? 3 : 2);
      expect(compile).toHaveBeenCalledTimes(2);
    },
  );

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
      { tableId: baseId, dataFrameId: sourceFrameId, lastFetchedAt: 123 },
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

  it("cleans a registration whose successful result is discarded", async () => {
    const h = harness();
    h.runtime.registerArrowTable = vi.fn(async (name, value) => {
      h.registered.set(name, value);
      throw new Error("request cancelled after registration");
    });

    await expect(
      createInsightMaterializer(h.dependencies).materialize({
        ctx: {} as never,
        target: { kind: "saved", insightId: "insight" },
        insight,
      }),
    ).rejects.toThrow("request cancelled after registration");
    expect(h.bytes.size).toBe(0);
    expect(h.registered.size).toBe(0);
    expect(h.runtime.unregisterTable).toHaveBeenCalledWith("df_frame-1");
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

  it("coalesces in-flight work and performs a new live run when replay is disabled", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
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

  it("briefly replays a completed result to sibling consumers", async () => {
    vi.useFakeTimers();
    try {
      let resolves = 0;
      const h = harness({
        completedReplayMs: 5_000,
        resolveSource: async (_ctx, tableId) => {
          resolves += 1;
          return source(tableId);
        },
      });
      const materializer = createInsightMaterializer(h.dependencies);
      const args = {
        ctx: {} as never,
        target: { kind: "saved", insightId: "insight" } as const,
        insight,
      };

      const first = await materializer.materialize(args);
      const sibling = await materializer.materialize(args);
      expect(sibling.dataFrameId).toBe(first.dataFrameId);
      expect(resolves).toBe(2);

      await vi.advanceTimersByTimeAsync(5_000);
      const later = await materializer.materialize(args);
      expect(later.dataFrameId).not.toBe(first.dataFrameId);
      expect(resolves).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("replays under the source generation published by the completed run", async () => {
    let generation = "old-source-frame";
    const h = harness({
      completedReplayMs: 5_000,
      coalescingScope: async () => generation,
      completedReplayScope: (_initialScope, result) =>
        result.sourceGenerations?.[0]?.dataFrameId,
      publish: vi.fn(async (_ctx, value) => {
        generation = value.sources[0]!.frame.id;
      }),
    });
    const materializer = createInsightMaterializer(h.dependencies);
    const args = {
      ctx: {} as never,
      target: { kind: "saved", insightId: "insight" } as const,
      insight,
    };

    const first = await materializer.materialize(args);
    const sibling = await materializer.materialize(args);

    expect(sibling.dataFrameId).toBe(first.dataFrameId);
    expect(first.sourceGenerations?.[0]?.dataFrameId).toBe("frame-1");
    expect(h.resolveSource).toHaveBeenCalledTimes(2);
  });

  it("does not alias a completed result under a concurrently newer source generation", async () => {
    let generation = "old-source-frame";
    const publish = vi.fn(async () => {
      generation = "concurrent-new-source-frame";
    });
    const h = harness({
      completedReplayMs: 5_000,
      coalescingScope: async () => generation,
      completedReplayScope: (_initialScope, result) =>
        result.sourceGenerations?.[0]?.dataFrameId,
      publish,
    });
    const materializer = createInsightMaterializer(h.dependencies);
    const args = {
      ctx: {} as never,
      target: { kind: "saved", insightId: "insight" } as const,
      insight,
    };

    await materializer.materialize(args);
    await materializer.materialize(args);

    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("does not let the first request cancel shared provider work", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const observedSignals: Array<AbortSignal | undefined> = [];
    const h = harness({
      resolveSource: async (ctx, tableId) => {
        observedSignals.push(ctx.requestSignal);
        await gate;
        return source(tableId);
      },
    });
    const materializer = createInsightMaterializer(h.dependencies);
    const leader = new AbortController();
    const sibling = new AbortController();
    const args = {
      target: { kind: "saved", insightId: "insight" } as const,
      insight,
    };

    const first = materializer.materialize({
      ...args,
      ctx: { requestSignal: leader.signal } as HostContext,
    });
    const second = materializer.materialize({
      ...args,
      ctx: { requestSignal: sibling.signal } as HostContext,
    });
    await vi.waitFor(() => expect(observedSignals).toHaveLength(1));
    leader.abort(new Error("leader disconnected"));
    release();

    const [firstResult, siblingResult] = await Promise.all([first, second]);
    expect(siblingResult.dataFrameId).toBe(firstResult.dataFrameId);
    expect(observedSignals[0]).toBeInstanceOf(AbortSignal);
    expect(observedSignals).toHaveLength(2);
    expect(observedSignals[1]).toBe(observedSignals[0]);
    expect(observedSignals[0]).not.toBe(leader.signal);
    expect(observedSignals[0]?.aborted).toBe(false);
    expect(h.publish).toHaveBeenCalledOnce();
  });

  it("bounds shared provider work with an independent deadline", async () => {
    vi.useFakeTimers();
    try {
      let observedSignal: AbortSignal | undefined;
      const h = harness({
        sharedOperationTimeoutMs: 50,
        resolveSource: async (ctx) => {
          observedSignal = ctx.requestSignal;
          return await new Promise<SourceGeneration>((_resolve, reject) => {
            ctx.requestSignal?.addEventListener(
              "abort",
              () => reject(ctx.requestSignal?.reason),
              { once: true },
            );
          });
        },
      });
      const pending = createInsightMaterializer(h.dependencies).materialize({
        ctx: { requestSignal: new AbortController().signal } as HostContext,
        target: { kind: "saved", insightId: "insight" },
        insight,
      });
      await vi.advanceTimersByTimeAsync(50);

      await expect(pending).rejects.toThrow(
        "Materialization deadline exceeded",
      );
      expect(observedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fail a completed publication when replay bookkeeping throws", async () => {
    const h = harness({
      completedReplayMs: 5_000,
      completedReplayScope: () => {
        throw new Error("bad replay key");
      },
    });

    await expect(
      createInsightMaterializer(h.dependencies).materialize({
        ctx: {} as never,
        target: { kind: "saved", insightId: "insight" },
        insight,
      }),
    ).resolves.toMatchObject({ status: "ready" });
    expect(h.publish).toHaveBeenCalledOnce();
  });

  it("does not reuse an in-flight operation after its source generation changes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
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

it("preserves the published table when refresh rejects an oversized source", async () => {
  const h = harness({
    resolveSource: vi.fn(async () => {
      throw new Error("FETCH_EXECUTION_FAILED", {
        cause: new Error(
          "[PostgresConnector] Result exceeds the hosted row ceiling",
        ),
      });
    }),
  });

  await expect(
    createInsightMaterializer(h.dependencies).materialize({
      ctx: {} as never,
      target: { kind: "refresh" },
      insight: {
        baseTableId: "base",
        selectedFields: [],
        metrics: [],
      },
    }),
  ).rejects.toThrow("FETCH_EXECUTION_FAILED");

  // No replacement publication means the previously published table and
  // every Report that refers to it remain the active generation.
  expect(h.storage.save).not.toHaveBeenCalled();
  expect(h.publish).not.toHaveBeenCalled();
});

it.each(["storageBytes", "runBytes"] as const)(
  "accounts for buffered native refresh sources against %s",
  async (limit) => {
    const h = harness({
      transferLimits: { ...DEFAULT_TRANSFER_LIMITS, [limit]: 0 },
    });
    // The native binding, not method presence, is what marks a runtime native.
    h.runtime.nativeTransfer = true;
    vi.mocked(h.storage.getUsage).mockResolvedValue({
      count: 1,
      totalBytes: 1,
    });
    await expect(
      createInsightMaterializer(h.dependencies).materialize({
        ctx: {} as HostContext,
        target: { kind: "refresh" },
        insight: { baseTableId: "source", selectedFields: [], metrics: [] },
      }),
    ).rejects.toThrow(/FETCH_.*BUDGET_EXCEEDED/);
    expect(h.storage.save).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  },
);

it("retains hosted buffered refresh ceilings independently of native transfer budgets", async () => {
  const h = harness({
    transferLimits: {
      ...DEFAULT_TRANSFER_LIMITS,
      storageBytes: 0,
      runBytes: 0,
    },
  });
  const result = await createInsightMaterializer(h.dependencies).materialize({
    ctx: {} as HostContext,
    target: { kind: "refresh" },
    insight: { baseTableId: "source", selectedFields: [], metrics: [] },
  });
  expect(result.status).toBe("ready");
  expect(h.storage.getUsage).not.toHaveBeenCalled();
});

it("gives the buffered result query the same deadline as the batched one", async () => {
  // The batched branch passes transfer.signal; the buffered branch runs the
  // whole insight query and must not outlive the materialization that asked
  // for it either.
  const h = harness();
  const seen: (AbortSignal | undefined)[] = [];
  Object.assign(h.runtime, {
    queryArrow: vi.fn(
      async (
        _sql: string,
        _params?: readonly unknown[],
        signal?: AbortSignal,
      ) => {
        seen.push(signal);
        return new Uint8Array([9]);
      },
    ),
  });
  await createInsightMaterializer(h.dependencies).materialize({
    ctx: {} as HostContext,
    target: { kind: "ephemeral" },
    insight,
  });
  expect(seen).not.toHaveLength(0);
  expect(seen.every((signal) => signal instanceof AbortSignal)).toBe(true);
});

it("carries a caller abort into a buffered registration, not only into the load", async () => {
  // The load is the slow half of registerStoredFrame's buffered branch. A
  // caller that gave up while it ran must not end up with a table registered
  // on its behalf, so the signal has to reach the registration too.
  const h = harness();
  const controller = new AbortController();
  const registerArrowTable = vi.fn(
    async (_name: string, _bytes: Uint8Array, signal?: AbortSignal) => {
      signal?.throwIfAborted();
    },
  );
  Object.assign(h.runtime, { registerArrowTable });
  Object.assign(h.storage, {
    load: async () => {
      controller.abort();
      return new Uint8Array([1]);
    },
  });
  await expect(
    registerStoredFrame(
      h.storage,
      h.runtime,
      "df_cancelled",
      "frame-1" as UUID,
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(registerArrowTable).toHaveBeenCalledWith(
    "df_cancelled",
    new Uint8Array([1]),
    controller.signal,
  );
});

it("refuses a batched source on a hosted runtime without consuming or saving it", async () => {
  // The hosted backing joins chunks at its worker seam, so accepting batches
  // there would consume and persist the source only to reload the whole frame
  // afterwards. Method presence can no longer say which backing this is —
  // every backing implements registerArrowStream — so the branch reads the
  // binding's own `nativeTransfer`, which the hosted facade never sets.
  const h = harness();
  let pulled = 0;
  const saveBatches = vi.fn(async () => {
    throw new Error("hosted runtime must not save batches");
  });
  Object.assign(h.storage, {
    saveBatches,
    stream: async function* () {
      yield new Uint8Array([1]);
    },
  });
  vi.mocked(h.storage.getUsage).mockResolvedValue({ count: 0, totalBytes: 0 });
  h.resolveSource.mockImplementation(async (_ctx, tableId: UUID) => ({
    ...source(tableId),
    arrow: undefined,
    batches: (async function* () {
      pulled += 1;
      yield new Uint8Array([1]);
    })(),
  }));
  await expect(
    createInsightMaterializer(h.dependencies).materialize({
      ctx: {} as HostContext,
      target: { kind: "refresh" },
      insight: { baseTableId: "source", selectedFields: [], metrics: [] },
    }),
  ).rejects.toThrow("TARGET_NOT_READY");
  expect(pulled).toBe(0);
  expect(saveBatches).not.toHaveBeenCalled();
  expect(h.storage.save).not.toHaveBeenCalled();
});

it("charges a buffered native source as a whole transfer rather than one streamed batch", async () => {
  const h = harness({
    transferLimits: { ...DEFAULT_TRANSFER_LIMITS, batchBytes: 0 },
  });
  h.runtime.nativeTransfer = true;
  vi.mocked(h.storage.getUsage).mockResolvedValue({ count: 0, totalBytes: 0 });
  const result = await createInsightMaterializer(h.dependencies).materialize({
    ctx: {} as HostContext,
    target: { kind: "refresh" },
    insight: { baseTableId: "source", selectedFields: [], metrics: [] },
  });
  expect(result.status).toBe("ready");
  expect(h.storage.save).toHaveBeenCalledOnce();
});
