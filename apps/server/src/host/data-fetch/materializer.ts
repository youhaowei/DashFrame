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
import { tableFromIPC } from "apache-arrow";
import {
  acquireNativeTransfer,
  TransferBudget,
  type TransferLimits,
} from "./transfer";
import { PublishedSourceMaterializationError } from "./published-source-error";
import { CoalescedOperation, supportsStreaming } from "./streaming";

export type EffectiveInsightDefinition = InsightFetchDefinition & {
  limit?: number;
  source?: { sourceType: "dataTable" | "insight"; sourceId: UUID };
};

export type MaterializationTarget =
  | { kind: "ephemeral" }
  | { kind: "refresh" }
  | { kind: "transient" }
  | { kind: "saved"; insightId: UUID };

export type SourceGeneration = {
  table: DataTable;
  arrow?: Uint8Array;
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

function assertPersistedSourceRefreshable(target: MaterializationTarget): void {
  if (target.kind === "refresh") throw new Error("SOURCE_NOT_REFRESHABLE");
}

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
  resolveSource(
    ctx: HostContext,
    tableId: UUID,
    signal?: AbortSignal,
    batchBytes?: number,
  ): Promise<SourceGeneration>;
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
  completedReplayScope?(
    initialScope: string,
    result: InsightFetchReady,
  ): string | undefined;
  /** Caller-independent deadline for shared hosted provider work. */
  sharedOperationTimeoutMs: number;
  /** Briefly reuse a completed result for sibling consumers of one render. */
  completedReplayMs?: number;
  transferLimits?: TransferLimits;
  transferCompleted?(summary: {
    bytes: number;
    batches: number;
    rows: number;
    durationMs: number;
    outcome: "ready" | "failed";
  }): void;
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
 * Creates the lifecycle owner. A short completed-result replay lets sibling
 * widgets share one immutable frame without turning this into a durable cache.
 */
export function createInsightMaterializer(
  dependencies: InsightMaterializerDependencies,
): InsightMaterializer {
  const inFlight = new Map<string, CoalescedOperation<InsightFetchReady>>();
  const replayMs = dependencies.completedReplayMs ?? 5_000;
  const remember = (
    key: string,
    operation: CoalescedOperation<InsightFetchReady>,
  ) => {
    if (inFlight.size >= 128) inFlight.delete(inFlight.keys().next().value!);
    inFlight.set(key, operation);
  };
  const forgetLater = (
    key: string,
    operation: CoalescedOperation<InsightFetchReady>,
  ) =>
    setTimeout(() => {
      if (inFlight.get(key) === operation) inFlight.delete(key);
    }, replayMs);

  const start = (
    key: string,
    args: Parameters<InsightMaterializer["materialize"]>[0],
  ): Promise<InsightFetchReady> => {
    const streaming = supportsStreaming(args.ctx);
    if (streaming && args.ctx.requestSignal?.aborted)
      return Promise.reject(args.ctx.requestSignal.reason);
    const waiterSignal = streaming ? args.ctx.requestSignal : undefined;
    const existing = inFlight.get(key);
    if (existing) {
      if (existing.joinable) return existing.wait(waiterSignal);
      const restart = () => {
        if (inFlight.get(key) === existing) inFlight.delete(key);
        return start(key, args);
      };
      return existing.promise.then(
        () => restart(),
        () => restart(),
      );
    }

    const runtime = dependencies.runtime(args.ctx);
    const identity = runtime.coalescingIdentity ?? runtime;

    // No caller's disconnect may cancel work a sibling is waiting on. Every
    // caller retains its workspace lease until this promise settles; the
    // independent deadline bounds provider work. Other capabilities still
    // come from the first caller's admitted context.
    const sharedLifetime =
      !streaming && args.ctx.requestSignal ? new AbortController() : undefined;
    const sharedDeadline = sharedLifetime
      ? setTimeout(
          () =>
            sharedLifetime.abort(
              new Error("Materialization deadline exceeded"),
            ),
          dependencies.sharedOperationTimeoutMs,
        )
      : undefined;
    const sharedArgs = {
      ...args,
      ctx: {
        ...args.ctx,
        requestSignal: sharedLifetime?.signal,
      },
    };
    const replayKeys = new Set([key]);
    const operation: CoalescedOperation<InsightFetchReady> =
      new CoalescedOperation((signal) => {
        const transfer = new TransferBudget(
          dependencies.transferLimits,
          streaming ? signal : sharedArgs.ctx.requestSignal,
        );
        const operationArgs = {
          ...sharedArgs,
          ctx: { ...sharedArgs.ctx, requestSignal: transfer.signal },
        };
        let release: (() => void) | undefined;
        return (async () => {
          if (runtime.queryArrowBatches)
            release = await acquireNativeTransfer(identity, transfer.signal);
          transfer.check();
          return materializeOnce(
            dependencies,
            operationArgs,
            [],
            [],
            [],
            transfer,
          );
        })()
          .then(
            (result) => {
              if (replayMs > 0) {
                // Remote publication advances its own source generation. Install the
                // replay alias before resolving callers so an immediate sibling sees
                // the immutable result under the exact generation it published. Never
                // re-read mutable metadata here: a concurrent refresh may already have
                // advanced beyond the generation that produced this result.
                let settledKey: string | undefined;
                try {
                  settledKey = dependencies.completedReplayScope?.(key, result);
                } catch {
                  // Replay is best-effort and must not fail a completed publication.
                }
                if (
                  settledKey !== undefined &&
                  settledKey !== key &&
                  !inFlight.has(settledKey)
                ) {
                  replayKeys.add(settledKey);
                  remember(settledKey, operation);
                }
              }
              reportTransfer(dependencies, transfer, "ready");
              return result;
            },
            (error) => {
              reportTransfer(dependencies, transfer, "failed");
              throw error;
            },
          )
          .finally(() => {
            if (sharedDeadline !== undefined) clearTimeout(sharedDeadline);
            transfer.close();
            release?.();
          });
      });
    remember(key, operation);
    const clear = () => {
      for (const replayKey of replayKeys) {
        if (inFlight.get(replayKey) === operation) inFlight.delete(replayKey);
      }
    };
    operation.promise.then(() => {
      if (replayMs <= 0) clear();
      else
        for (const replayKey of replayKeys) forgetLater(replayKey, operation);
    }, clear);
    return operation.wait(waiterSignal);
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
  transfer: TransferBudget,
): Promise<InsightFetchReady> {
  const storage = dependencies.storage(args.ctx);
  const runtime = dependencies.runtime(args.ctx);
  if (!runtime.registerArrowTable) throw new Error("TARGET_NOT_READY");

  const created: Array<{ id: UUID; registered: boolean }> = [];
  let publicationAttempted = false;
  try {
    const tableIds = referencedTableIds(args.insight);
    const sources: SourceGeneration[] = [];
    // An upstream Insight can itself materialize data. Resolve sequentially
    // so a failed source never leaves a sibling materialization running.
    for (const tableId of tableIds)
      sources.push(
        await resolveMaterializationSource(
          dependencies,
          args,
          tableId,
          ancestry,
          transientResults,
          publishedSourceGenerations,
          transfer,
        ),
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
        assertPersistedSourceRefreshable(args.target);
        await registerStoredFrame(
          storage,
          runtime,
          dependencies.tableName(source.existingFrameId),
          source.existingFrameId,
          transfer.signal,
          source.arrow,
        );
        tables.set(source.table.id, source.table);
        continue;
      }
      const frameId = dependencies.uuid();
      // Track before save: storage implementations are required to save
      // atomically, but cleanup still attempts deletion if an implementation
      // reports failure after making the generation visible.
      created.push({ id: frameId, registered: false });
      await saveSource(storage, runtime, frameId, source, transfer, args.ctx);
      // Registration may succeed before its wrapper discards a cancelled
      // request's result, so cleanup must assume the catalog entry exists.
      created.at(-1)!.registered = true;
      await registerStoredFrame(
        storage,
        runtime,
        dependencies.tableName(frameId),
        frameId,
        transfer.signal,
        source.arrow,
      );
      const frame = pendingFrame(frameId, source.fields, source.rowCount);
      pendingSources.push({ source, frame });
      tables.set(source.table.id, { ...source.table, dataFrameId: frameId });
    }

    if (args.target.kind === "refresh") {
      const refreshed = pendingSources[0];
      if (!refreshed || pendingSources.length !== 1)
        throw new Error("TARGET_NOT_READY");
      const fetchedAt = dependencies.now();
      const definitionFingerprint = dependencies.fingerprint({
        insight: args.insight,
        sources,
      });
      transfer.check();
      publicationAttempted = true;
      await dependencies.publish(args.ctx, {
        target: args.target,
        sources: pendingSources,
        result: refreshed.frame,
        definitionFingerprint,
        provenance: refreshed.source.provenance,
        fetchedAt,
      });
      const sourceGeneration = {
        tableId: refreshed.source.table.id,
        dataFrameId: refreshed.frame.id,
        lastFetchedAt: fetchedAt,
      };
      publishedSourceGenerations.push(sourceGeneration);
      return {
        status: "ready",
        dataFrameId: refreshed.frame.id,
        schema: refreshed.frame.schema,
        rowCount: refreshed.frame.rowCount,
        definitionFingerprint,
        provenance: refreshed.source.provenance,
        fetchedAt,
        sourceGenerations: publishedSourceGenerations,
      };
    }

    const sql = dependencies.compile({ insight: args.insight, tables });
    if (!sql) throw new Error("FETCH_COMPILE_FAILED");
    const resultId = dependencies.uuid();
    created.push({ id: resultId, registered: false });
    const result = await saveResult({
      dependencies,
      storage,
      runtime,
      insight: args.insight,
      tables,
      sql,
      resultId,
      transfer,
    });
    // Keep upstream's conservative cleanup for wrappers that register then
    // discard a result when a request is cancelled.
    created.at(-1)!.registered = true;
    await registerStoredFrame(
      storage,
      runtime,
      dependencies.tableName(resultId),
      resultId,
      transfer.signal,
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
    transfer.check();
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
    await cleanupFailedMaterialization(
      storage,
      runtime,
      dependencies,
      args.target,
      created,
      transientResults,
      publicationAttempted,
    );
    throw withPublishedSourceGenerations(error, publishedSourceGenerations);
  }
}

async function cleanupFailedMaterialization(
  storage: DataFrameStorage,
  runtime: HostDataPlaneRuntime,
  dependencies: InsightMaterializerDependencies,
  target: MaterializationTarget,
  created: Array<{ id: UUID; registered: boolean }>,
  transientResults: Array<{ id: UUID; registered: boolean }>,
  publicationAttempted: boolean,
): Promise<void> {
  if (!publicationAttempted)
    await cleanupNewFrames(storage, runtime, dependencies, created);
  if (target.kind === "transient") return;
  await cleanupNewFrames(storage, runtime, dependencies, transientResults);
  transientResults.length = 0;
}

async function resolveMaterializationSource(
  dependencies: InsightMaterializerDependencies,
  args: {
    ctx: HostContext;
    target: MaterializationTarget;
    insight: EffectiveInsightDefinition;
  },
  tableId: UUID,
  ancestry: readonly UUID[],
  transientResults: Array<{ id: UUID; registered: boolean }>,
  publishedSourceGenerations: InsightSourceGeneration[],
  transfer: TransferBudget,
): Promise<SourceGeneration> {
  if (
    tableId !== args.insight.baseTableId ||
    args.insight.source?.sourceType !== "insight"
  )
    return dependencies.resolveSource(
      args.ctx,
      tableId,
      transfer.signal,
      transfer.limits.batchBytes,
    );
  if (ancestry.includes(tableId) || ancestry.length >= 16)
    throw new Error("TARGET_NOT_READY");
  const upstream = await dependencies.resolveInsight(args.ctx, tableId);
  const ready = await materializeOnce(
    dependencies,
    { ctx: args.ctx, target: { kind: "transient" }, insight: upstream },
    [...ancestry, tableId],
    transientResults,
    publishedSourceGenerations,
    transfer,
  );
  const arrow = await loadFallback(
    dependencies.storage(args.ctx),
    dependencies.runtime(args.ctx),
    ready.dataFrameId,
  );
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
  };
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

function reportTransfer(
  dependencies: InsightMaterializerDependencies,
  transfer: TransferBudget,
  outcome: "ready" | "failed",
) {
  if (transfer.batches === 0) return;
  try {
    dependencies.transferCompleted?.({
      bytes: transfer.bytes,
      batches: transfer.batches,
      rows: transfer.rows,
      durationMs: Date.now() - transfer.started,
      outcome,
    });
  } catch {
    /* Observability must never change a publication outcome. */
  }
}

async function* inspectSourceBatches(
  source: SourceGeneration,
  transfer: TransferBudget,
  ctx: HostContext,
) {
  for await (const bytes of source.batches!) {
    transfer.check();
    const table = tableFromIPC(bytes);
    transfer.consume(bytes, table.numRows);
    source.rowCount += table.numRows;
    try {
      ctx.onMaterializationProgress?.({
        phase: "source",
        rows: transfer.rows,
        bytes: transfer.bytes,
        elapsedMs: Date.now() - transfer.started,
      });
    } catch {
      // Observability must never change materialization behavior.
    }
    yield bytes;
  }
}

export async function registerStoredFrame(
  storage: DataFrameStorage,
  runtime: HostDataPlaneRuntime,
  name: string,
  id: UUID,
  signal?: AbortSignal,
  fallback?: Uint8Array,
): Promise<void> {
  signal?.throwIfAborted();
  if (storage.stream && runtime.registerArrowStream) {
    await runtime.registerArrowStream(name, storage.stream(id), signal);
  } else if (storage.loadBatches && runtime.registerArrowBatches) {
    await runtime.registerArrowBatches(name, storage.loadBatches(id), {
      signal,
    });
  } else {
    const bytes = fallback ?? (await storage.load(id));
    if (!bytes || !runtime.registerArrowTable)
      throw new Error("TARGET_NOT_READY");
    await runtime.registerArrowTable(name, bytes);
  }
}

async function saveResult(args: {
  dependencies: InsightMaterializerDependencies;
  storage: DataFrameStorage;
  runtime: HostDataPlaneRuntime;
  insight: EffectiveInsightDefinition;
  tables: Map<UUID, DataTable>;
  sql: string;
  resultId: UUID;
  transfer: TransferBudget;
}): Promise<PendingFrame> {
  const {
    dependencies,
    storage,
    runtime,
    insight,
    tables,
    sql,
    resultId,
    transfer,
  } = args;
  let schema: InsightFetchReady["schema"] | undefined;
  let rowCount = 0;
  if (
    storage.saveBatches &&
    runtime.queryArrowBatches &&
    storage.stream &&
    runtime.registerArrowStream
  ) {
    await transfer.admit(storage);
    async function* inspectedBatches() {
      for await (const bytes of runtime.queryArrowBatches!(sql, [], {
        signal: transfer.signal,
      })) {
        const inspected = dependencies.inspect(bytes, { insight, tables });
        if (
          schema &&
          JSON.stringify(schema) !== JSON.stringify(inspected.schema)
        )
          throw new Error("SOURCE_SCHEMA_CHANGED");
        schema = inspected.schema;
        rowCount += inspected.rowCount;
        transfer.consume(bytes, inspected.rowCount);
        yield bytes;
      }
    }
    await storage.saveBatches(resultId, inspectedBatches());
    if (!schema) throw new Error("SOURCE_SCHEMA_CHANGED");
  } else {
    const bytes = await runtime.queryArrow(sql, []);
    const inspected = dependencies.inspect(bytes, { insight, tables });
    schema = inspected.schema;
    rowCount = inspected.rowCount;
    await storage.save(resultId, bytes);
  }
  return {
    id: resultId,
    schema,
    rowCount,
    fieldIds: schema.map((field) => field.id),
  };
}

async function loadFallback(
  storage: DataFrameStorage,
  runtime: HostDataPlaneRuntime,
  id: UUID,
): Promise<Uint8Array | undefined> {
  if (
    (storage.loadBatches && runtime.registerArrowBatches) ||
    (storage.stream && runtime.registerArrowStream)
  )
    return undefined;
  const bytes = await storage.load(id);
  if (!bytes) throw new Error("TARGET_NOT_READY");
  return bytes;
}

async function saveSource(
  storage: DataFrameStorage,
  runtime: HostDataPlaneRuntime,
  id: UUID,
  source: SourceGeneration,
  transfer: TransferBudget,
  ctx: HostContext,
): Promise<void> {
  if (!source.batches) {
    if (!source.arrow) throw new Error("TARGET_NOT_READY");
    // Native compatibility adapters still allocate one buffered source. Count
    // that transfer before saving, including source-only refreshes; hosted
    // runtimes keep their existing independent ceilings.
    if (runtime.queryArrowBatches) {
      await transfer.admit(storage);
      transfer.consumeBuffered(source.arrow, source.rowCount);
    }
    await storage.save(id, source.arrow);
    return;
  }
  if (!storage.saveBatches || !storage.stream || !runtime.registerArrowStream)
    throw new Error("TARGET_NOT_READY");
  await transfer.admit(storage);
  source.rowCount = 0;
  await storage.saveBatches(id, inspectSourceBatches(source, transfer, ctx));
}
