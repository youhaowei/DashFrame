/** Production adapters that join C1 to persisted bindings/native execution. */
import {
  buildInsightAvailableFields,
  buildInsightSQL,
  fieldIdToColumnAlias,
  metricIdToColumnAlias,
} from "@dashframe/engine";
import { inspectArrowIpc } from "@dashframe/engine-server/arrow-data-path";

import { createHash, randomUUID } from "node:crypto";
import type { DashframeFunctionContext } from "../../app-context";
import type { LiveFetchExecutor } from "../data-fetch";
import { fetchSourceBinding, resolveSourceBinding } from "./bindings";
import type {
  InsightMaterializerDependencies,
  SourceGeneration,
} from "./materializer";
import { createInsightMaterializer } from "./materializer";
import { publishMaterialization } from "./publisher";

/** Real C1 lifecycle executor; no completed-result cache exists. */
export function createProductionFetchExecutor(): LiveFetchExecutor {
  const runtimeScopes = new WeakMap<object, string>();
  let nextRuntimeScope = 0;
  const runtimeScope = (ctx: DashframeFunctionContext): string => {
    const runtime = ctx.dataPlaneRuntime;
    if (!runtime) return "missing-runtime";
    let scope = runtimeScopes.get(runtime);
    if (!scope) {
      scope = `runtime-${++nextRuntimeScope}`;
      runtimeScopes.set(runtime, scope);
    }
    return scope;
  };
  const materializer = createInsightMaterializer({
    ...productionMaterializerDependencies(),
    fingerprint: ({ insight, sources }) =>
      createHash("sha256")
        .update(
          JSON.stringify({
            insight,
            sources: sources.map((source) => source.table.id),
          }),
        )
        .digest("hex"),
    coalescingScope: (ctx, target, insight) =>
      JSON.stringify([runtimeScope(ctx), ctx.principal, target, insight]),
    uuid: () => randomUUID(),
    now: () => Date.now(),
    tableName: (id) => `df_${id.replaceAll("-", "_")}`,
  });
  return async ({ context, insight, target }) =>
    materializer.materialize({ ctx: context, insight, target });
}

/** Fails closed if the host did not inject its native data-plane capability. */
export function productionMaterializerDependencies(): Pick<
  InsightMaterializerDependencies,
  "storage" | "runtime" | "resolveSource" | "compile" | "inspect" | "publish"
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
        ...insight.metrics.map(
          (metric) =>
            [
              metricIdToColumnAlias(metric.id),
              {
                id: metricIdToColumnAlias(metric.id),
                name: metric.name,
                type: "number",
              },
            ] as const,
        ),
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
  ctx: DashframeFunctionContext,
  tableId: string,
): Promise<SourceGeneration> {
  const binding = await resolveSourceBinding(ctx, tableId);
  const result = await fetchSourceBinding(ctx, binding);
  return {
    table: binding.table as never,
    arrow: new Uint8Array(Buffer.from(result.arrowBuffer, "base64")),
    fields: result.fields,
    rowCount: result.rowCount,
    provenance: {
      connectorKind: result.provenance.connectorKind,
      bindingVersion: result.provenance.sourceBindingVersion,
    },
  };
}
