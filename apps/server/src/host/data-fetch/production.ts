/** Production adapters that join C1 to persisted bindings/native execution. */
import {
  buildInsightAvailableFields,
  buildInsightSQL,
  fieldIdToColumnAlias,
  metricIdToColumnAlias,
} from "@dashframe/engine";
import { inspectArrowIpc } from "@dashframe/engine-server/arrow-data-path";
import type { InsightSourceGeneration, UUID } from "@dashframe/types";

import { randomUUID } from "node:crypto";
import type { HostContext } from "../context";
import {
  fingerprintEffectiveInsight,
  type LiveFetchExecutor,
} from "../data-fetch";
import { decodeInsight, type InsightRow } from "../insights";
import {
  fetchSourceBinding,
  resolveSourceBinding,
  streamGa4Binding,
  streamPostgresBinding,
} from "./bindings";
import { supportsStreaming } from "./streaming";
import type {
  EffectiveInsightDefinition,
  InsightMaterializerDependencies,
  MaterializationTarget,
  SourceGeneration,
} from "./materializer";
import { createInsightMaterializer } from "./materializer";
import { publishMaterialization } from "./publisher";

const MATERIALIZATION_TIMEOUT_MS = 120_000;

/** Real C1 lifecycle executor with bounded sibling replay, never a durable result cache. */
export function createProductionFetchExecutor(): LiveFetchExecutor {
  const runtimeScopes = new WeakMap<object, string>();
  let nextRuntimeScope = 0;
  const runtimeScope = (ctx: HostContext): string => {
    const runtime = ctx.dataPlaneRuntime;
    if (!runtime) return "missing-runtime";
    const identity = runtime.coalescingIdentity ?? runtime;
    let scope = runtimeScopes.get(identity);
    if (!scope) {
      scope = `runtime-${++nextRuntimeScope}`;
      runtimeScopes.set(identity, scope);
    }
    return scope;
  };
  const materializer = createInsightMaterializer({
    ...productionMaterializerDependencies(),
    fingerprint: ({ insight }) => fingerprintEffectiveInsight(insight),
    coalescingScope: (ctx, target, insight) =>
      productionMaterializationScope(runtimeScope(ctx), ctx, target, insight),
    completedReplayScope: completedProductionReplayScope,
    sharedOperationTimeoutMs: MATERIALIZATION_TIMEOUT_MS,
    uuid: () => randomUUID(),
    now: () => Date.now(),
    transferCompleted: (summary) =>
      console.info("[dashframe] snapshot transfer", summary),
    tableName: (id) => `df_${id.replaceAll("-", "_")}`,
  });
  return async ({ context, insight, target }) =>
    materializer.materialize({ ctx: context, insight, target });
}

export async function productionMaterializationScope(
  runtimeScope: string,
  ctx: HostContext,
  target: MaterializationTarget,
  insight: EffectiveInsightDefinition,
): Promise<string> {
  return JSON.stringify([
    runtimeScope,
    ctx.principal,
    target,
    insight,
    await persistedSourceRevision(ctx, insight),
  ]);
}

export function completedProductionReplayScope(
  initialScope: string,
  result: { sourceGenerations?: readonly InsightSourceGeneration[] },
): string | undefined {
  if (!result.sourceGenerations?.length) return initialScope;
  const generations = new Map(
    result.sourceGenerations.map((generation) => [
      generation.tableId,
      generation,
    ]),
  );
  let scope: unknown;
  try {
    scope = JSON.parse(initialScope);
  } catch {
    return undefined;
  }
  if (!Array.isArray(scope) || scope.length !== 5) return undefined;
  if (
    typeof scope[2] === "object" &&
    scope[2] !== null &&
    (scope[2] as { kind?: unknown }).kind === "refresh"
  )
    return undefined;
  const replaceGenerations = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value;
    if (value[0] === "table" && typeof value[1] === "string") {
      const generation = generations.get(value[1] as UUID);
      return generation
        ? [
            "table",
            generation.tableId,
            generation.dataFrameId,
            generation.lastFetchedAt,
          ]
        : value;
    }
    return value.map(replaceGenerations);
  };
  return JSON.stringify([
    scope[0],
    scope[1],
    scope[2],
    scope[3],
    replaceGenerations(scope[4]),
  ]);
}

async function persistedSourceRevision(
  ctx: HostContext,
  insight: Parameters<LiveFetchExecutor>[0]["insight"],
  ancestry: readonly UUID[] = [],
): Promise<unknown[]> {
  if (ancestry.length >= 16) throw new Error("TARGET_NOT_READY");
  const revision: unknown[] = [];
  const tableIds = new Set<UUID>([
    insight.baseTableId as UUID,
    ...((insight.joins ?? []).map((join) => join.rightTableId) as UUID[]),
  ]);
  if (insight.source?.sourceType === "insight") {
    const upstreamId = insight.source.sourceId;
    if (ancestry.includes(upstreamId)) throw new Error("TARGET_NOT_READY");
    const row = (await ctx.metadata.getInsight(upstreamId)) as
      | InsightRow
      | undefined;
    if (!row) throw new Error("TARGET_NOT_READY");
    const decoded = decodeInsight(row);
    const upstream = {
      ...decoded,
      baseTableId: decoded.source.sourceId,
    };
    revision.push([
      "insight",
      upstreamId,
      upstream,
      await persistedSourceRevision(ctx, upstream, [...ancestry, upstreamId]),
    ]);
    tableIds.delete(insight.baseTableId as UUID);
  }
  for (const tableId of [...tableIds].sort()) {
    const table = await ctx.metadata.getDataTable(tableId);
    if (!table) throw new Error("TARGET_NOT_READY");
    revision.push([
      "table",
      table.id,
      table.dataFrameId ?? null,
      table.lastFetchedAt ?? null,
    ]);
  }
  return revision;
}

/** Fails closed if the host did not inject its native data-plane capability. */
export function productionMaterializerDependencies(): Pick<
  InsightMaterializerDependencies,
  | "storage"
  | "runtime"
  | "resolveSource"
  | "resolveInsight"
  | "compile"
  | "inspect"
  | "publish"
> {
  return {
    storage: (ctx) => {
      if (!ctx.dataFrameStorage) throw new Error("TARGET_NOT_READY");
      return ctx.dataFrameStorage;
    },
    runtime: (ctx) => {
      if (!ctx.dataPlaneRuntime) throw new Error("TARGET_NOT_READY");
      return ctx.dataPlaneRuntime;
    },
    resolveSource: resolveProductionSource,
    resolveInsight: async (ctx, insightId) => {
      const row = (await ctx.metadata.getInsight(insightId)) as
        | InsightRow
        | undefined;
      if (!row) throw new Error("TARGET_NOT_READY");
      const decoded = decodeInsight(row);
      return { ...decoded, baseTableId: decoded.source.sourceId };
    },
    compile: ({ insight, tables }) => {
      const base = tables.get(insight.baseTableId);
      if (!base) throw new Error("TARGET_NOT_READY");
      const joined = new Map([...tables].filter(([id]) => id !== base.id));
      const sql = buildInsightSQL(base, joined, insight as never, {
        mode: "query",
        effectiveLimit: insight.limit,
        effectiveSorts: insight.sorts,
      });
      if (!sql) throw new Error("FETCH_COMPILE_FAILED");
      return sql;
    },
    inspect: (arrow, { insight, tables }) => {
      const table = inspectArrowIpc(arrow);
      const base = tables.get(insight.baseTableId);
      if (!base) throw new Error("TARGET_NOT_READY");
      const joined = new Map([...tables].filter(([id]) => id !== base.id));
      const available = buildInsightAvailableFields(
        base,
        joined,
        insight as never,
      );
      if (!available) throw new Error("TARGET_NOT_READY");
      let selected = available;
      if (insight.selectedFields.length) {
        selected = available.filter((field) =>
          insight.selectedFields.includes(field.id),
        );
      } else if (insight.metrics.length) {
        selected = [];
      }
      const expected = new Map([
        ...selected.map(
          (field) =>
            [
              fieldIdToColumnAlias(field.id),
              {
                id: fieldIdToColumnAlias(field.id),
                name: field.name,
                type: field.type,
              },
            ] as const,
        ),
        ...insight.metrics.map((metric) => {
          const sourceType =
            metric.aggregation === "min" || metric.aggregation === "max"
              ? [...tables.values()]
                  .find((candidate) => candidate.id === metric.sourceTable)
                  ?.fields.find(
                    (field) =>
                      (field.columnName ?? field.name) === metric.columnName,
                  )?.type
              : undefined;
          return [
            metricIdToColumnAlias(metric.id),
            {
              id: metricIdToColumnAlias(metric.id),
              name: metric.name,
              type: sourceType ?? "number",
            },
          ] as const;
        }),
      ]);
      if (
        table.fieldNames.length !== expected.size ||
        table.fieldNames.some((name) => !expected.has(name))
      ) {
        throw new Error("SOURCE_SCHEMA_CHANGED");
      }
      return {
        rowCount: table.rowCount,
        schema: table.fieldNames.map((name) => expected.get(name)!),
      };
    },
    publish: publishMaterialization,
  };
}

async function resolveProductionSource(
  ctx: HostContext,
  tableId: string,
  signal?: AbortSignal,
  batchBytes?: number,
): Promise<SourceGeneration> {
  const binding = await resolveSourceBinding(ctx, tableId);
  if (binding.connectorKind === "googleAnalytics" && supportsStreaming(ctx)) {
    return {
      table: binding.table as never,
      fields: binding.table.fields as SourceGeneration["fields"],
      rowCount: 0,
      batches: streamGa4Binding(ctx, binding),
      provenance: {
        connectorKind: binding.connectorKind,
        bindingVersion: binding.sourceBindingVersion,
      },
    };
  }
  if (
    binding.connectorKind === "postgres" &&
    ctx.workspaceOwnerId === undefined
  ) {
    // The hosted sandbox still uses its bounded compatibility adapter.
    // Native streaming capabilities are mandatory here: do not silently buffer a large source.
    if (
      !ctx.dataFrameStorage?.saveBatches ||
      !ctx.dataFrameStorage.stream ||
      !ctx.dataPlaneRuntime?.registerArrowStream ||
      !ctx.dataPlaneRuntime.queryArrowBatches
    )
      throw new Error("TARGET_NOT_READY");
    return {
      table: binding.table as never,
      fields: binding.table.fields as SourceGeneration["fields"],
      rowCount: 0,
      batches: streamPostgresBinding(ctx, binding, signal, batchBytes),
      provenance: {
        connectorKind: "postgres",
        bindingVersion: binding.sourceBindingVersion,
      },
    };
  }
  const result = await fetchSourceBinding(ctx, binding);
  return {
    table: binding.table as never,
    arrow: new Uint8Array(Buffer.from(result.arrowBuffer, "base64")),
    fields: result.fields,
    rowCount: result.rowCount,
    ...(binding.connectorKind === "local" && binding.table.dataFrameId
      ? { existingFrameId: binding.table.dataFrameId }
      : {}),
    provenance: {
      connectorKind: result.provenance.connectorKind,
      bindingVersion: result.provenance.sourceBindingVersion,
    },
  };
}
