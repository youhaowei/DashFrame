/** Internal immutable DataFrame materialization lifecycle for Insight execution. */
import {
  extractColumnAliasComponents,
  type DataFrameStorage,
} from "@dashframe/engine";
import type {
  ColumnType,
  DataTable,
  Field,
  InsightFetchDefinition,
  InsightFetchReady,
  UUID,
} from "@dashframe/types";

import type {
  DashframeFunctionContext,
  DataPlaneRuntime,
} from "../../app-context";

export type EffectiveInsightDefinition = InsightFetchDefinition & {
  limit?: number;
  source?: { sourceType: "dataTable" | "insight"; sourceId: UUID };
};

export type MaterializationTarget =
  | { kind: "ephemeral" }
  | { kind: "saved"; insightId: UUID };

export type SourceGeneration = {
  table: DataTable;
  arrow: Uint8Array;
  fields: Field[];
  rowCount: number;
  provenance: { connectorKind: string; bindingVersion: string };
  existingFrameId?: UUID;
};

export type PendingFrame = {
  id: UUID;
  fieldIds: UUID[];
  rowCount: number;
  schema: InsightFetchReady["schema"];
};

export type PublishMaterialization = {
  target: MaterializationTarget;
  sources: Array<{ source: SourceGeneration; frame: PendingFrame }>;
  result: PendingFrame;
  definitionFingerprint: string;
  provenance: InsightFetchReady["provenance"];
  fetchedAt: number;
};

export function fieldsFromInsightResult(
  schema: InsightFetchReady["schema"],
  tableId: UUID,
): Field[] {
  return schema.map((field) => {
    const parsed = extractColumnAliasComponents(field.id);
    if (!parsed) throw new Error("SOURCE_SCHEMA_CHANGED");
    const id = `${parsed.uuid}${
      parsed.instanceIndex > 0 ? `_j${parsed.instanceIndex}` : ""
    }` as UUID;
    return {
      ...field,
      id,
      type: field.type as ColumnType,
      tableId,
      columnName: field.id,
    };
  });
}

export interface InsightMaterializerDependencies {
  storage(ctx: DashframeFunctionContext): DataFrameStorage;
  runtime(ctx: DashframeFunctionContext): DataPlaneRuntime;
  resolveSource(
    ctx: DashframeFunctionContext,
    tableId: UUID,
  ): Promise<SourceGeneration>;
  resolveInsight(
    ctx: DashframeFunctionContext,
    insightId: UUID,
  ): Promise<EffectiveInsightDefinition>;
  compile(args: {
    insight: EffectiveInsightDefinition;
    tables: Map<UUID, DataTable>;
  }): string;
  inspect(
    arrow: Uint8Array,
    context: {
      insight: EffectiveInsightDefinition;
      tables: Map<UUID, DataTable>;
    },
  ): {
    rowCount: number;
    schema: InsightFetchReady["schema"];
  };
  publish(
    ctx: DashframeFunctionContext,
    materialization: PublishMaterialization,
  ): Promise<void>;
  fingerprint(args: {
    insight: EffectiveInsightDefinition;
    sources: SourceGeneration[];
  }): string;
  coalescingScope(
    ctx: DashframeFunctionContext,
    target: MaterializationTarget,
    insight: EffectiveInsightDefinition,
  ): string;
  uuid(): UUID;
  now(): number;
  tableName(frameId: UUID): string;
}

export interface InsightMaterializer {
  materialize(args: {
    ctx: DashframeFunctionContext;
    target: MaterializationTarget;
    insight: EffectiveInsightDefinition;
  }): Promise<InsightFetchReady>;
}

/**
 * Creates the lifecycle owner. Completed results are never cached: the map only
 * coalesces identical work while it is in flight and is cleared on settlement.
 */
export function createInsightMaterializer(
  dependencies: InsightMaterializerDependencies,
): InsightMaterializer {
  const inFlight = new Map<string, Promise<InsightFetchReady>>();

  return {
    materialize(args) {
      const key = dependencies.coalescingScope(
        args.ctx,
        args.target,
        args.insight,
      );
      const existing = inFlight.get(key);
      if (existing) return existing;

      const operation = materializeOnce(dependencies, args);
      inFlight.set(key, operation);
      const clear = () => {
        if (inFlight.get(key) === operation) inFlight.delete(key);
      };
      operation.then(clear, clear);
      return operation;
    },
  };
}

async function materializeOnce(
  dependencies: InsightMaterializerDependencies,
  args: {
    ctx: DashframeFunctionContext;
    target: MaterializationTarget;
    insight: EffectiveInsightDefinition;
  },
  ancestry: readonly UUID[] = [],
): Promise<InsightFetchReady> {
  const storage = dependencies.storage(args.ctx);
  const runtime = dependencies.runtime(args.ctx);
  if (!runtime.registerArrowTable) throw new Error("TARGET_NOT_READY");

  const created: Array<{ id: UUID; registered: boolean }> = [];
  try {
    const tableIds = referencedTableIds(args.insight);
    const sources = await Promise.all(
      tableIds.map(async (tableId) => {
        if (
          tableId === args.insight.baseTableId &&
          args.insight.source?.sourceType === "insight"
        ) {
          if (ancestry.includes(tableId) || ancestry.length >= 16)
            throw new Error("TARGET_NOT_READY");
          const upstream = await dependencies.resolveInsight(args.ctx, tableId);
          const ready = await materializeOnce(
            dependencies,
            { ctx: args.ctx, target: { kind: "ephemeral" }, insight: upstream },
            [...ancestry, tableId],
          );
          const arrow = await storage.load(ready.dataFrameId);
          if (!arrow) throw new Error("TARGET_NOT_READY");
          const fields = fieldsFromInsightResult(ready.schema, tableId);
          return {
            table: {
              id: tableId,
              dataSourceId: tableId,
              name: `Insight ${tableId}`,
              table: dependencies.tableName(ready.dataFrameId),
              fields,
              metrics: [],
              dataFrameId: ready.dataFrameId,
              createdAt: ready.fetchedAt,
            },
            arrow,
            fields,
            rowCount: ready.rowCount,
            provenance: ready.provenance,
            existingFrameId: ready.dataFrameId,
          } satisfies SourceGeneration;
        }
        return dependencies.resolveSource(args.ctx, tableId);
      }),
    );
    for (const source of sources) assertSourceSchema(source);

    const pendingSources: PublishMaterialization["sources"] = [];
    const tables = new Map<UUID, DataTable>();
    for (const source of sources) {
      if (source.existingFrameId) {
        tables.set(source.table.id, source.table);
        continue;
      }
      const frameId = dependencies.uuid();
      const frame = pendingFrame(frameId, source.fields, source.rowCount);
      // Track before save: storage implementations are required to save
      // atomically, but cleanup still attempts deletion if an implementation
      // reports failure after making the generation visible.
      created.push({ id: frameId, registered: false });
      await storage.save(frameId, source.arrow);
      await runtime.registerArrowTable(
        dependencies.tableName(frameId),
        source.arrow,
      );
      created.at(-1)!.registered = true;
      pendingSources.push({ source, frame });
      tables.set(source.table.id, { ...source.table, dataFrameId: frameId });
    }

    const sql = dependencies.compile({ insight: args.insight, tables });
    if (!sql) throw new Error("FETCH_COMPILE_FAILED");
    const resultArrow = await runtime.queryArrow(sql, []);
    const inspected = dependencies.inspect(resultArrow, {
      insight: args.insight,
      tables,
    });
    const resultId = dependencies.uuid();
    const result: PendingFrame = {
      id: resultId,
      fieldIds: inspected.schema.map((field) => field.id),
      rowCount: inspected.rowCount,
      schema: inspected.schema,
    };
    created.push({ id: resultId, registered: false });
    await storage.save(resultId, resultArrow);
    await runtime.registerArrowTable(
      dependencies.tableName(resultId),
      resultArrow,
    );
    created.at(-1)!.registered = true;

    const fetchedAt = dependencies.now();
    const definitionFingerprint = dependencies.fingerprint({
      insight: args.insight,
      sources,
    });
    const provenance = sources[0]?.provenance;
    if (!provenance) throw new Error("TARGET_NOT_READY");
    await dependencies.publish(args.ctx, {
      target: args.target,
      sources: pendingSources,
      result,
      definitionFingerprint,
      provenance,
      fetchedAt,
    });
    return {
      status: "ready",
      dataFrameId: result.id,
      schema: result.schema,
      rowCount: result.rowCount,
      definitionFingerprint,
      provenance,
      fetchedAt,
    };
  } catch (error) {
    await cleanupNewFrames(storage, runtime, dependencies, created);
    throw error;
  }
}

function referencedTableIds(insight: EffectiveInsightDefinition): UUID[] {
  const ids = [
    insight.baseTableId,
    ...(insight.joins ?? []).map((join) => join.rightTableId),
  ];
  return [...new Set(ids)];
}

function pendingFrame(
  id: UUID,
  fields: Field[],
  rowCount: number,
): PendingFrame {
  return {
    id,
    fieldIds: fields.map((field) => field.id),
    rowCount,
    schema: fields.map((field) => ({
      id: field.id,
      name: field.columnName ?? field.name,
      type: field.type,
    })),
  };
}

function assertSourceSchema(source: SourceGeneration): void {
  const persisted = source.table.fields.map((field) => ({
    name: field.columnName ?? field.name,
    type: field.type,
  }));
  const actual = source.fields.map((field) => ({
    name: field.columnName ?? field.name,
    type: field.type,
  }));
  if (
    persisted.length === 0 ||
    persisted.length !== actual.length ||
    persisted.some(
      (field, index) =>
        field.name !== actual[index]?.name ||
        field.type !== actual[index]?.type,
    )
  ) {
    throw new Error("SOURCE_SCHEMA_CHANGED");
  }
}

async function cleanupNewFrames(
  storage: DataFrameStorage,
  runtime: DataPlaneRuntime,
  dependencies: InsightMaterializerDependencies,
  created: Array<{ id: UUID; registered: boolean }>,
): Promise<void> {
  await Promise.allSettled(
    [...created]
      .reverse()
      .flatMap((frame) => [
        ...(frame.registered && runtime.unregisterTable
          ? [runtime.unregisterTable(dependencies.tableName(frame.id))]
          : []),
        storage.delete(frame.id),
      ]),
  );
}
