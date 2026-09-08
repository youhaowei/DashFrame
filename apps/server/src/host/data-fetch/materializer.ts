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
  InsightSourceGeneration,
  UUID,
} from "@dashframe/types";

import type { HostContext, HostDataPlaneRuntime } from "../context";
import { PublishedSourceMaterializationError } from "./published-source-error";
import { inspectArrowIpc } from "@dashframe/engine-server/arrow-data-path";
import {
  CoalescedOperation,
  withStreamingBudget,
  type StreamingBudget,
} from "./streaming";

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
  arrow?: Uint8Array;
  /** Single-use bounded source stream; rowCount is filled as it is consumed. */
  batches?: AsyncIterable<Uint8Array>;
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

function withPublishedSourceGenerations(
  error: unknown,
  generations: readonly InsightSourceGeneration[],
): unknown {
  if (!generations.length) return error;
  return new PublishedSourceMaterializationError(error, generations);
}

/**
 * Creates the lifecycle owner. Completed results are never cached: the map only
 * coalesces identical work while it is in flight and is cleared on settlement.
 */
export function createInsightMaterializer(
  dependencies: InsightMaterializerDependencies,
): InsightMaterializer {
  const inFlight = new Map<string, CoalescedOperation<InsightFetchReady>>();

  const start = (
    key: string,
    args: Parameters<InsightMaterializer["materialize"]>[0],
  ) => {
    if (args.ctx.requestSignal?.aborted)
      return Promise.reject(args.ctx.requestSignal.reason);
    const existing = inFlight.get(key);
    if (existing) return existing.wait(args.ctx.requestSignal);
    const operation = new CoalescedOperation((requestSignal) =>
      withStreamingBudget({ ...args.ctx, requestSignal }, (ctx, budget) =>
        materializeOnce(dependencies, { ...args, ctx }, [], [], [], budget),
      ),
    );
    inFlight.set(key, operation);
    const clear = () => {
      if (inFlight.get(key) === operation) inFlight.delete(key);
    };
    operation.promise.then(clear, clear);
    return operation.wait(args.ctx.requestSignal);
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
  publishedSourceGenerations: InsightSourceGeneration[] = [],
  budget?: StreamingBudget,
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
            budget,
          );
          const arrow = budget
            ? undefined
            : await storage.load(ready.dataFrameId);
          if (!budget && !arrow) throw new Error("TARGET_NOT_READY");
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
            ...(arrow ? { arrow } : {}),
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

    const { pendingSources, tables } = await stageSources(
      dependencies,
      args.ctx,
      sources,
      created,
      budget,
    );

    const sql = dependencies.compile({ insight: args.insight, tables });
    if (!sql) throw new Error("FETCH_COMPILE_FAILED");
    const result = await stageResult(
      dependencies,
      args.ctx,
      args.insight,
      tables,
      sql,
      created,
      budget,
    );

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
    budget?.check();
    budget?.report("publication");
    budget?.check();
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
        lastFetchedAt: fetchedAt,
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
      sourceGenerations: publishedSourceGenerations,
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

/** Save and register complete source generations before compiling the result. */
async function stageSources(
  dependencies: InsightMaterializerDependencies,
  ctx: HostContext,
  sources: SourceGeneration[],
  created: Array<{ id: UUID; registered: boolean }>,
  budget?: StreamingBudget,
) {
  const storage = dependencies.storage(ctx);
  const pendingSources: PublishMaterialization["sources"] = [];
  const tables = new Map<UUID, DataTable>();
  for (const source of sources) {
    if (source.existingFrameId) {
      await registerGeneration(
        dependencies,
        ctx,
        source.existingFrameId,
        source.arrow,
        budget,
      );
      tables.set(source.table.id, source.table);
      continue;
    }
    const frameId = dependencies.uuid();
    // Track before the atomic save, including failures after a successful rename.
    const tracked = { id: frameId, registered: false };
    created.push(tracked);
    await saveSource(storage, source, frameId, budget);
    // A wrapper may reject after native registration has completed.
    tracked.registered = true;
    await registerGeneration(dependencies, ctx, frameId, source.arrow, budget);
    const frame = pendingFrame(frameId, source.fields, source.rowCount);
    pendingSources.push({ source, frame });
    tables.set(source.table.id, { ...source.table, dataFrameId: frameId });
  }
  return { pendingSources, tables };
}

async function saveSource(
  storage: DataFrameStorage,
  source: SourceGeneration,
  frameId: UUID,
  budget?: StreamingBudget,
): Promise<void> {
  if (source.batches) {
    if (!budget) throw new Error("TARGET_NOT_READY");
    source.rowCount = 0;
    await storage.saveBatches!(
      frameId,
      budget.batches(source.batches, "source", (arrow) => {
        source.rowCount += inspectArrowIpc(arrow).rowCount;
      }),
    );
    return;
  }
  const arrow = source.arrow;
  if (!arrow) throw new Error("TARGET_NOT_READY");
  if (budget) {
    await storage.saveBatches!(
      frameId,
      budget.batches(
        (async function* () {
          yield arrow;
        })(),
        "source",
      ),
    );
  } else await storage.save(frameId, arrow);
}

async function registerGeneration(
  dependencies: InsightMaterializerDependencies,
  ctx: HostContext,
  id: UUID,
  arrow: Uint8Array | undefined,
  budget?: StreamingBudget,
): Promise<void> {
  const runtime = dependencies.runtime(ctx);
  if (budget) {
    budget.check();
    await runtime.registerArrowBatches!(
      dependencies.tableName(id),
      dependencies.storage(ctx).loadBatches!(id),
      { signal: ctx.requestSignal },
    );
  } else {
    if (!arrow) throw new Error("TARGET_NOT_READY");
    await runtime.registerArrowTable!(dependencies.tableName(id), arrow);
  }
}

/** Stream query output into its immutable frame and inspect one chunk at a time. */
async function stageResult(
  dependencies: InsightMaterializerDependencies,
  ctx: HostContext,
  insight: EffectiveInsightDefinition,
  tables: Map<UUID, DataTable>,
  sql: string,
  created: Array<{ id: UUID; registered: boolean }>,
  budget?: StreamingBudget,
): Promise<PendingFrame> {
  const storage = dependencies.storage(ctx);
  const runtime = dependencies.runtime(ctx);
  const resultId = dependencies.uuid();
  created.push({ id: resultId, registered: false });
  let inspected:
    | ReturnType<InsightMaterializerDependencies["inspect"]>
    | undefined;
  if (budget) {
    let expectedSchema: string | undefined;
    await storage.saveBatches!(
      resultId,
      budget.batches(
        runtime.queryArrowBatches!(sql, [], {
          signal: ctx.requestSignal,
        }),
        "result",
        (arrow) => {
          const batch = dependencies.inspect(arrow, {
            insight,
            tables,
          });
          const signature = JSON.stringify(batch.schema);
          if (expectedSchema !== undefined && signature !== expectedSchema)
            throw new Error("SOURCE_SCHEMA_CHANGED");
          expectedSchema = signature;
          inspected = {
            schema: batch.schema,
            rowCount: (inspected?.rowCount ?? 0) + batch.rowCount,
          };
        },
      ),
    );
    budget.check();
    created.at(-1)!.registered = true;
    await runtime.registerArrowBatches!(
      dependencies.tableName(resultId),
      storage.loadBatches!(resultId),
      { signal: ctx.requestSignal },
    );
  } else {
    const resultArrow = await runtime.queryArrow(sql, []);
    inspected = dependencies.inspect(resultArrow, {
      insight,
      tables,
    });
    await storage.save(resultId, resultArrow);
    created.at(-1)!.registered = true;
    await runtime.registerArrowTable!(
      dependencies.tableName(resultId),
      resultArrow,
    );
  }
  if (!inspected) throw new Error("FETCH_EXECUTION_FAILED");
  const result: PendingFrame = {
    id: resultId,
    fieldIds: inspected.schema.map((field) => field.id),
    rowCount: inspected.rowCount,
    schema: inspected.schema,
  };
  created.at(-1)!.registered = true;

  return result;
}
