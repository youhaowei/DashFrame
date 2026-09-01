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

import type { HostContext, HostDataPlaneRuntime } from "../context";
import { PublishedSourceMaterializationError } from "./published-source-error";

export type EffectiveInsightDefinition = InsightFetchDefinition & {
  limit?: number;
  source?: { sourceType: "dataTable" | "insight"; sourceId: UUID };
};

export type MaterializationTarget =
  | { kind: "ephemeral" }
  | { kind: "transient" }
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
  storage(ctx: HostContext): DataFrameStorage;
  runtime(ctx: HostContext): HostDataPlaneRuntime;
  resolveSource(ctx: HostContext, tableId: UUID): Promise<SourceGeneration>;
  resolveInsight(
    ctx: HostContext,
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
    ctx: HostContext,
    materialization: PublishMaterialization,
  ): Promise<void>;
  fingerprint(args: {
    insight: EffectiveInsightDefinition;
    sources: SourceGeneration[];
  }): string;
  coalescingScope(
    ctx: HostContext,
    target: MaterializationTarget,
    insight: EffectiveInsightDefinition,
  ): string | Promise<string>;
  uuid(): UUID;
  now(): number;
  tableName(frameId: UUID): string;
}

export interface InsightMaterializer {
  materialize(args: {
    ctx: HostContext;
    target: MaterializationTarget;
    insight: EffectiveInsightDefinition;
  }): Promise<InsightFetchReady>;
}

function dedupeSourceGenerations(
  generations: readonly { tableId: UUID; dataFrameId: UUID }[],
) {
  return [
    ...new Map(
      generations.map((generation) => [generation.tableId, generation]),
    ).values(),
  ];
}

function withPublishedSourceGenerations(
  error: unknown,
  generations: readonly { tableId: UUID; dataFrameId: UUID }[],
): unknown {
  if (!generations.length) return error;
  return new PublishedSourceMaterializationError(
    error,
    dedupeSourceGenerations(generations),
  );
}

/**
 * Creates the lifecycle owner. Completed results are never cached: the map only
 * coalesces identical work while it is in flight and is cleared on settlement.
 */
export function createInsightMaterializer(
  dependencies: InsightMaterializerDependencies,
): InsightMaterializer {
  const inFlight = new Map<string, Promise<InsightFetchReady>>();

  const start = (
    key: string,
    args: Parameters<InsightMaterializer["materialize"]>[0],
  ) => {
    const existing = inFlight.get(key);
    if (existing) return existing;

    const operation = materializeOnce(dependencies, args, [], [], []);
    inFlight.set(key, operation);
    const clear = () => {
      if (inFlight.get(key) === operation) inFlight.delete(key);
    };
    operation.then(clear, clear);
    return operation;
  };

  return {
    materialize(args) {
      const scope = dependencies.coalescingScope(
        args.ctx,
        args.target,
        args.insight,
      );
      return typeof scope === "string"
        ? start(scope, args)
        : scope.then((key) => start(key, args));
    },
  };
}

async function materializeOnce(
  dependencies: InsightMaterializerDependencies,
  args: {
    ctx: HostContext;
    target: MaterializationTarget;
    insight: EffectiveInsightDefinition;
  },
  ancestry: readonly UUID[] = [],
  transientResults: Array<{ id: UUID; registered: boolean }> = [],
  publishedSourceGenerations: Array<{ tableId: UUID; dataFrameId: UUID }> = [],
): Promise<InsightFetchReady> {
  const storage = dependencies.storage(args.ctx);
  const runtime = dependencies.runtime(args.ctx);
  if (!runtime.registerArrowTable) throw new Error("TARGET_NOT_READY");

  const created: Array<{ id: UUID; registered: boolean }> = [];
  let publicationAttempted = false;
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
            { ctx: args.ctx, target: { kind: "transient" }, insight: upstream },
            [...ancestry, tableId],
            transientResults,
            publishedSourceGenerations,
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
    for (const source of sources) {
      assertSourceSchema(source);
      // Connector discovery may regenerate Field ids on every request. The
      // persisted DataTable schema owns stable identity; once structure is
      // proven equal, every published generation must carry those canonical
      // fields rather than the connector's throwaway ids.
      source.fields = source.table.fields.map((field) => ({ ...field }));
    }

    const pendingSources: PublishMaterialization["sources"] = [];
    const tables = new Map<UUID, DataTable>();
    for (const source of sources) {
      if (source.existingFrameId) {
        await runtime.registerArrowTable(
          dependencies.tableName(source.existingFrameId),
          source.arrow,
        );
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
    if (args.target.kind !== "transient") {
      // Intermediate results are no longer needed once the outer query has
      // produced its bytes. Retire them before publishing the outer pointer so
      // a cleanup failure cannot leave committed rows pointing at rolled-back
      // files.
      await cleanupTransientFrames(
        storage,
        runtime,
        dependencies,
        transientResults,
      );
    }
    publicationAttempted = true;
    await dependencies.publish(args.ctx, {
      target: args.target,
      sources: pendingSources,
      result,
      definitionFingerprint,
      provenance,
      fetchedAt,
    });
    publishedSourceGenerations.push(
      ...pendingSources.map(({ source, frame }) => ({
        tableId: source.table.id,
        dataFrameId: frame.id,
      })),
    );
    if (args.target.kind === "transient") {
      transientResults.push({ id: result.id, registered: true });
    }
    return {
      status: "ready",
      dataFrameId: result.id,
      schema: result.schema,
      rowCount: result.rowCount,
      definitionFingerprint,
      provenance,
      fetchedAt,
      sourceGenerations: dedupeSourceGenerations(publishedSourceGenerations),
    };
  } catch (error) {
    // A failed response cannot prove the native mutation failed. Its commit
    // may already reference any pending generation, or still be in flight.
    // Retain bytes and registrations after publication starts; unresolved
    // attempts may leave orphans until a future reconciliation pass.
    if (!publicationAttempted) {
      await cleanupNewFrames(storage, runtime, dependencies, created);
    }
    if (args.target.kind !== "transient") {
      await cleanupNewFrames(storage, runtime, dependencies, transientResults);
      transientResults.length = 0;
    }
    throw withPublishedSourceGenerations(error, publishedSourceGenerations);
  }
}

async function cleanupTransientFrames(
  storage: DataFrameStorage,
  runtime: HostDataPlaneRuntime,
  dependencies: InsightMaterializerDependencies,
  frames: Array<{ id: UUID; registered: boolean }>,
): Promise<void> {
  for (const frame of [...frames].reverse()) {
    if (frame.registered && runtime.unregisterTable) {
      await runtime.unregisterTable(dependencies.tableName(frame.id));
    }
    await storage.delete(frame.id);
  }
  frames.length = 0;
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
  runtime: HostDataPlaneRuntime,
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
