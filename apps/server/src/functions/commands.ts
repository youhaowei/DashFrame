/**
 * Command VOCABULARY — Layer B over @wystack/server's `applyCommands` MECHANISM.
 *
 * `applyCommands` knows nothing about DashFrame. It dispatches a batch of
 * `{ path, args }` against the app's function registry inside one tracked
 * transaction. THIS module supplies the typed, intent-carrying commands that
 * batch travels as — the narrow waist both the human UI and the agent emit
 * through (capability-parity).
 *
 * Representation (chosen of the two viable seams): each command is backed by a
 * registered WyStack `mutation()` — path-addressable, validated by the same
 * cached Zod schema a plain RPC uses. A typed builder/registry
 * (`commandBuilders` below) maps a command NAME to the `{ path, args }` envelope
 * `applyCommands` dispatches. Rationale: the spec's traceability rule ("every
 * write op maps to a command, no escape hatch") wants the existing handlers to
 * BACK the commands so there is no duplicate logic — a command handler IS a
 * mutation handler. The builder layer is pure data-shaping (no DB access), so
 * the vocabulary stays a thin typed face over the mechanism.
 *
 * Decomposition:
 *
 *   DataSource/DataTable/Fields/Metrics commands:
 *   getOrCreateDataSourceByType → GetOrCreateDataSource   (the reference atomic command)
 *   addDataSource              → CreateDataSource
 *   updateDataSource           → SetDataSourceConfig + RenameNode
 *   addDataTable               → CreateDataTable
 *   updateDataTable            → RenameNode + SetDataTableSchema + RefreshDataTable
 *   refreshDataTable           → RefreshDataTable
 *   patchDataTableArray        → AddField / UpdateField / RemoveField
 *                                + AddMetric / UpdateMetric / RemoveMetric
 *
 *   Insight/Visualization/Dashboard commands:
 *   createInsight              → CreateInsight
 *   updateInsight (baseTableId/source slice) → SetInsightSource
 *   updateInsight (selectedFields slice)     → SelectFields
 *   updateInsight (filters slice)            → SetInsightFilter
 *   updateInsight (sorts slice)              → SetInsightSort
 *   updateInsight (joins array)              → AddJoin / UpdateJoin / RemoveJoin
 *   patchInsight (fields/metrics)            → AddField / UpdateField / RemoveField
 *                                              AddMetric / UpdateMetric / RemoveMetric
 *                                              (same commands, now routed to Insight node)
 *   createVisualization        → CreateVisualization
 *   updateVisualization        → RenameNode + SetChartType + SetChartEncoding
 *   removeVisualization        → DeleteNode
 *   DashboardMutations.create  → CreateDashboard
 *   DashboardMutations.addItem → AddDashboardItem
 *   DashboardMutations.updateItem → UpdateDashboardItem
 *   DashboardMutations.update (layout) → SetDashboardLayout
 *   DashboardMutations.removeItem → RemoveDashboardItem
 *   removeInsight/removeVisualization/removeDashboard → DeleteNode
 *
 * Cross-cutting `RenameNode` is the one polymorphic rename — the `name` slice
 * carved out of every coarse update(blob). Now covers Insight + Visualization +
 * Dashboard nodes in addition to DataSource/DataTable.
 *
 * Fields & Metrics target the DataFrame-PRODUCING node polymorphically via
 * `{ nodeId }`. Field/metric edits on a derived Insight work with the same
 * command shape as the DataTable case — `resolveNode` dispatches on kind.
 *
 * Operand encoding: value-bearing operands in SetInsightFilter are a TAGGED union:
 *   { kind: 'value'; v: unknown }      (v: null is valid — means IS NULL)
 *   | { kind: 'lateBound'; ref: ... }  (column | category | placeholder)
 * NOT property-presence. This is the mechanism that reconciles capability-parity
 * with the privacy floor: the agent emits the same command verb, leaving only
 * the *value* unbound when the egress gate withheld it.
 *
 * Insight-on-Insight composition (SetInsightSource):
 * `source` is polymorphic — `{ sourceType: 'dataTable', sourceId }` OR
 * `{ sourceType: 'insight', sourceId }`. The handler detects cycles by
 * walking the source chain; it rejects a source that would make the Insight
 * transitively depend on itself.
 *
 * Storage contract: `InsightDefinition.baseTableId` is the structural source id
 * carried on every Insight. `rowToInsight` in `app-artifacts.ts` reads it, and
 * it is a field on the `Insight` domain type the renderer consumes. `source`
 * carries the polymorphic source description; `baseTableId` is written to
 * `source.sourceId` on every write so both stay in lockstep — for a DataTable
 * source the two are interchangeable, for an Insight source `baseTableId` holds
 * the upstream insight id.
 */
import { type ArtifactProvenance, schema } from "@dashframe/server-core";
import type {
  ArtifactKind,
  Field,
  InsightJoinConfig,
  InsightMetric,
  InsightSort,
  Metric,
  RenamedTarget,
  SourceSchema,
  UUID,
  VegaLiteSpec,
  VisualizationEncoding,
  VisualizationType,
} from "@dashframe/types";
import { eq, jsonb, text, uuid } from "@wystack/db";
import { isSecretRef, type SecretRef } from "@wystack/secret-vault";
import type { Command } from "@wystack/server";
import { mutation } from "@wystack/server";
import { z } from "zod";

import {
  applyCredentialField,
  coerceProvenance,
  type DataSourceConfig,
  isRecord,
  modeFromCtx,
  releaseCredentialRefs,
  requireRecordWithId,
  shouldDeferRelease,
  vaultFromCtx,
} from "./utils";

const {
  dataSources,
  dataTables,
  dataFrames,
  insights,
  visualizations,
  dashboards,
} = schema;

type DataSourceRow = typeof dataSources.$inferSelect;
type DataTableRow = typeof dataTables.$inferSelect;
type InsightRow = typeof insights.$inferSelect;
type VisualizationRow = typeof visualizations.$inferSelect;
type DashboardRow = typeof dashboards.$inferSelect;

// ---------------------------------------------------------------------------
// Insight definition shape (stored in insights.definition jsonb)
// ---------------------------------------------------------------------------

/**
 * The polymorphic source description stored in `insights.definition`.
 * Insight-on-Insight composition rides on `sourceType`.
 */
interface InsightSource {
  sourceType: "dataTable" | "insight";
  sourceId: UUID;
}

interface StoredInsightDefinition {
  /** Structural source id — also surfaced on the `Insight` domain type via `rowToInsight`. */
  baseTableId: UUID;
  /** Polymorphic source description; `baseTableId` mirrors `source.sourceId`. */
  source?: InsightSource;
  selectedFields: UUID[];
  metrics: unknown[];
  filters?: unknown[];
  sorts?: unknown[];
  joins?: unknown[];
}

// ---------------------------------------------------------------------------
// JSONB validation schemas (defined once, applied at every read/cast site)
// ---------------------------------------------------------------------------

/**
 * Zod schema for the polymorphic InsightSource stored in
 * `insights.definition`. Validates the discriminant and the required id before
 * any property access so a corrupt/unexpected blob fails with a clear
 * ZodError rather than throwing on `undefined.someField`.
 */
const insightSourceSchema = z.object({
  sourceType: z.enum(["dataTable", "insight"]),
  sourceId: z.string(),
});

/**
 * Zod schema for the full StoredInsightDefinition JSONB blob. Applied in
 * `requireInsightDefinition` so every handler that reads the definition from
 * the DB gets a validated, typed value — not a blindly-cast unknown.
 *
 * IMPORTANT — write-back allowlist: `requireInsightDefinition` returns
 * `parsed.data` (the Zod output). Handlers spread this into the next
 * definition before writing it back (`{ ...definition, <field> }`). Any key
 * present in the stored blob but absent from this schema is silently dropped
 * on the next write. Adding a new field to `StoredInsightDefinition` requires
 * a matching entry here.
 *
 * `selectedFields` and `metrics` default to `[]` (rather than being required)
 * to match the read-path's defensive coalescing (`?? []`) — older or
 * externally written rows that omit them remain readable instead of being
 * rejected as corrupt.
 *
 * Exported so tests can assert parse-call counts (e.g. the orphan scan parses
 * each insight once, not once per owned table).
 */
export const storedInsightDefinitionSchema = z.object({
  baseTableId: z.string(),
  source: insightSourceSchema.optional(),
  // `.nullish().default([])` — a null value (SQL JSONB can store null for an
  // absent key) and an absent key are both "nothing set" states, not corrupt.
  // Present-but-malformed (a non-array) is still rejected as corrupt.
  selectedFields: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  metrics: z
    .array(z.unknown())
    .nullish()
    .transform((v) => v ?? []),
  filters: z
    .array(z.unknown())
    .nullish()
    .transform((v) => v ?? undefined),
  sorts: z
    .array(z.unknown())
    .nullish()
    .transform((v) => v ?? undefined),
  joins: z
    .array(z.unknown())
    .nullish()
    .transform((v) => v ?? undefined),
});

/**
 * Load an Insight's stored definition. Throws if the row does not exist — the
 * same guard `requireDataTable` provides for DataTable commands. Parses the
 * definition JSONB with `storedInsightDefinitionSchema` so a corrupt blob
 * produces a clear validation error instead of throwing on property access.
 */
async function requireInsightDefinition(
  ctx: { db: import("@wystack/db").DrizzleTracker },
  insightId: string,
): Promise<{ row: InsightRow; definition: StoredInsightDefinition }> {
  const row = (await ctx.db
    .from(insights)
    .where(eq("id", insightId))
    .first()) as InsightRow | undefined;
  if (!row) throw new Error(`Insight ${insightId} not found`);
  const parsed = storedInsightDefinitionSchema.safeParse(row.definition);
  if (!parsed.success) {
    throw new Error(
      `Insight ${insightId} has a corrupt definition: ${parsed.error.message}`,
    );
  }
  return { row, definition: parsed.data as StoredInsightDefinition };
}

/**
 * Assert a `{ sourceType, sourceId }` resolves to an existing row before it is
 * persisted into an Insight's `definition.source`. The source is stored as JSON,
 * not an FK, so nothing else stops a dangling reference: a `sourceId` that names
 * no row would be written and the command would report success, leaving an
 * Insight whose source can never be resolved. Worse, the cycle walk in
 * `wouldCreateCycle` treats a missing insight row as a leaf (returns false), so
 * an unvalidated dangling insight source slips past cycle detection too. Both
 * CreateInsight and SetInsightSource route source writes through here.
 */
async function requireSourceExists(
  ctx: { db: import("@wystack/db").DrizzleTracker },
  source: InsightSource,
): Promise<void> {
  const table = source.sourceType === "insight" ? insights : dataTables;
  const row = await ctx.db.from(table).where(eq("id", source.sourceId)).first();
  if (!row) {
    throw new Error(`Source ${source.sourceType} ${source.sourceId} not found`);
  }
}

/**
 * Walk the source chain starting from `startId` to detect whether `targetId`
 * is already reachable — i.e. whether setting `startId`'s source to `targetId`
 * would create a cycle. Stops as soon as it finds `targetId` or reaches a
 * DataTable (leaf).
 *
 * This is a simple linear walk (O(depth)); cycle detection could be done with
 * a visited set for diamond DAGs, but the typical chain depth is small and
 * diamonds are architecturally uncommon at authoring time.
 *
 * A corrupt `definition` blob on any encountered row throws immediately
 * (aborting the walk) rather than treating the node as a leaf; callers must
 * handle or propagate that error.
 */
async function wouldCreateCycle(
  ctx: { db: import("@wystack/db").DrizzleTracker },
  startId: string,
  targetId: string,
): Promise<boolean> {
  // If the target IS the start, setting self as source is already a 1-cycle.
  if (startId === targetId) return true;
  // Walk the existing source chain from targetId upward — if we reach startId
  // then adding the edge targetId → startId would close a cycle.
  let currentId: string = targetId;
  const visited = new Set<string>();
  for (;;) {
    if (visited.has(currentId)) break; // already explored (shared prefix)
    visited.add(currentId);
    const row = (await ctx.db
      .from(insights)
      .where(eq("id", currentId))
      .first()) as InsightRow | undefined;
    if (!row) break; // reached a leaf (DataTable or unknown)
    const parsed = storedInsightDefinitionSchema.safeParse(row.definition);
    if (!parsed.success) {
      throw new Error(
        `Insight ${currentId} has a corrupt definition: ${parsed.error.message}`,
      );
    }
    const def = parsed.data as StoredInsightDefinition;
    const src = def.source;
    if (!src || src.sourceType !== "insight") break; // leaf
    if (src.sourceId === startId) return true; // cycle found
    currentId = src.sourceId;
  }
  return false;
}

// ---------------------------------------------------------------------------
// DataSource commands
// ---------------------------------------------------------------------------

/**
 * GetOrCreateDataSource — THE reference atomic command. Replaces the racy
 * check-then-insert `getOrCreateDataSourceByType` (PR #46 Greptile P1:
 * concurrent CSV ingests double-insert).
 *
 * The fix is the client-minted id. The old command keyed idempotency on `kind`
 * (no DB unique constraint → two transactions both pass the existence check and
 * both insert). This keys idempotency on the PRIMARY KEY: the caller mints a
 * stable id once and reuses it, so a concurrent second ingest finds the row by
 * id (PK is unique) and returns it. Run inside `applyCommands`' transaction the
 * lookup→insert is atomic within a batch; across concurrent batches the PK
 * constraint is the backstop (the loser's insert conflicts and its batch rolls
 * back — one source, never two).
 */
const getOrCreateDataSource = mutation({
  args: { id: uuid, type: text, name: text },
  handler: async (ctx, { id, type, name }): Promise<{ id: string }> => {
    const existing = (await ctx.db
      .from(dataSources)
      .where(eq("id", id))
      .first()) as DataSourceRow | undefined;
    // On the get path `type` and `name` are IGNORED — the existing row wins,
    // even if the caller passed a different type for the same id. The canonical
    // caller derives the id FROM the type so a mismatch can't happen there; the
    // spec leaves conflict semantics open for other callers (Spec Open Q).
    if (existing) return { id: existing.id };

    const [row] = (await ctx.db.into(dataSources).insert({
      id,
      name,
      kind: type,
      storage: "live",
      config: {},
      createdBy: { kind: "user" },
    })) as DataSourceRow[];
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  },
});

/** CreateDataSource — mints a DataSource with a client-supplied id + config. */
const createDataSource = mutation({
  args: {
    id: uuid,
    type: text,
    name: text,
    apiKey: text.optional(),
    connectionString: text.optional(),
    /** Artifact provenance carried by the emitter (agent vs user). */
    createdBy: jsonb.optional(),
  },
  handler: async (
    ctx,
    { id, type, name, apiKey, connectionString, createdBy },
  ): Promise<{ id: string }> => {
    const vault = vaultFromCtx(ctx);
    const preview = modeFromCtx(ctx) === "preview";
    // On the draft / publish-replay path, a captured credential arrives here AS a
    // ref (pass-through, no re-store) and the prior-ref release is deferred to the
    // lifecycle transition; on a direct canonical call, release is synchronous.
    // (A fresh create has no prior ref, so deferral only matters for symmetry.)
    const deferRelease = shouldDeferRelease(ctx);
    const config: DataSourceConfig = {};
    // store non-empty / skip-on-empty (applyCredentialField). On a fresh config an
    // empty string is a no-op. A real store fails closed when no vault is injected.
    // In preview mode the vault write is skipped — the DB transaction rolls back
    // anyway, but vault.store() is a keychain side-effect outside the transaction
    // that would survive the rollback and permanently orphan a secret.
    await applyCredentialField(
      config,
      "apiKey",
      apiKey,
      vault,
      `apiKey-${id}`,
      preview,
      deferRelease,
    );
    await applyCredentialField(
      config,
      "connectionString",
      connectionString,
      vault,
      `connectionString-${id}`,
      preview,
      deferRelease,
    );
    const [row] = (await ctx.db.into(dataSources).insert({
      id,
      name,
      kind: type,
      storage: "live",
      // Agent-emitted creates carry agent provenance (in the command, so it
      // survives the publish log replay) so agent-authored sources are auditably
      // distinct; an absent/malformed value defaults to user.
      createdBy: coerceProvenance(createdBy),
      config,
    })) as DataSourceRow[];
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  },
});

/**
 * SetDataSourceConfig — replaces the config slice of a DataSource (the connector
 * secrets). The `name` slice is NOT here — renaming is `RenameNode`. This is the
 * config half decomposed out of the coarse `updateDataSource`.
 *
 * `extra` carries optional non-credential connector settings (e.g. database name,
 * schema). Sink guard: any key in `extra` that matches "apiKey" or
 * "connectionString" is rejected — callers must use the typed credential fields.
 */
const setDataSourceConfig = mutation({
  args: {
    id: uuid,
    apiKey: text.optional(),
    connectionString: text.optional(),
    extra: jsonb.optional(),
  },
  handler: async (
    ctx,
    { id, apiKey, connectionString, extra },
  ): Promise<{ ok: true }> => {
    const vault = vaultFromCtx(ctx);
    const preview = modeFromCtx(ctx) === "preview";
    // Defer prior-ref release to the publish/discard transition on the draft path;
    // release synchronously on a direct canonical call (see createDataSource).
    const deferRelease = shouldDeferRelease(ctx);
    const current = (await ctx.db
      .from(dataSources)
      .where(eq("id", id))
      .first()) as DataSourceRow | undefined;
    if (!current) throw new Error(`Data source ${id} not found`);
    const config = { ...((current.config ?? {}) as DataSourceConfig) };
    // Sink guard FIRST: callers may not sneak credential keys in via `extra`.
    // This validation must run BEFORE applyCredentialField, because a rotate stores
    // a NEW vault ref (an irreversible keychain side-effect). If the guard threw
    // after the store, a rejected request would have already minted an orphan
    // secret. Validation before side-effects keeps a rejected write fully consistent.
    // (Prior-ref release is deferred to the publish transition, not run here.)
    if (isRecord(extra) && ("apiKey" in extra || "connectionString" in extra)) {
      throw new Error(
        "SetDataSourceConfig: 'apiKey' and 'connectionString' must use the typed credential fields, not extra",
      );
    }
    // store non-empty (replaces any existing ref with a fresh one) / clear-on-empty
    // (releases the prior vault ref + deletes the config key so hasApiKey reads false)
    // / leave-on-undefined.
    // applyCredentialField is the single choke point; a real store fails closed when
    // no vault is injected. A captured/replayed ref passes through verbatim (no
    // re-store, no plaintext in the log). On the draft path the prior canonical ref
    // is NOT released here (deferRelease): release is the publish transition's job
    // (it releases the replaced canonical ref post-commit, with a cross-draft-
    // reference check) so a rolled-back publish never deletes a still-live secret.
    // On a direct canonical call, the prior ref is collected here and released AFTER
    // the canonical write is committed AND a snapshot is flushed to disk, so the
    // snapshot capturing the new config is durable before the old ref is removed.
    // In preview mode vault writes are skipped (keychain is not transactional).
    //
    // PRE-RELEASE FLUSH GATE (direct canonical path, !deferRelease, !preview):
    //   store-new → canonical-write → flush-snapshot → release-old
    // The superseded collector captures the old ref inside applyCredentialField
    // instead of releasing it immediately, so the canonical write and snapshot
    // flush can happen first.
    const supersededRefs: SecretRef[] = [];
    await applyCredentialField(
      config,
      "apiKey",
      apiKey,
      vault,
      `apiKey-${id}`,
      preview,
      deferRelease,
      supersededRefs,
    );
    await applyCredentialField(
      config,
      "connectionString",
      connectionString,
      vault,
      `connectionString-${id}`,
      preview,
      deferRelease,
      supersededRefs,
    );
    // Merge non-credential keys from `extra` into the config (guarded above).
    if (isRecord(extra)) {
      Object.assign(config, extra);
    }
    // PHASE 2: canonical write — new config (with new ref) is now committed.
    await ctx.db.from(dataSources).where(eq("id", id)).update({ config });

    // PHASE 3: flush snapshot then release old refs (direct canonical path only).
    // Only relevant when the direct call actually superseded credential refs
    // (!deferRelease is implied — deferRelease callers pass an empty superseded
    // because applyCredentialField skips the collector on those paths).
    if (supersededRefs.length > 0 && !preview) {
      const flushSnapshot = (ctx as Record<string, unknown>).flushSnapshot as
        | (() => Promise<void>)
        | undefined;
      let snapshotPersisted = true;
      if (flushSnapshot != null) {
        try {
          await flushSnapshot();
        } catch (err) {
          // Flush failed: skip release so the old ref remains valid until a
          // future write produces a snapshot that confirms its absence.
          snapshotPersisted = false;
          console.error(
            "[dashframe] setDataSourceConfig: flushSnapshot failed, skipping credential release:",
            err,
          );
        }
      }
      if (snapshotPersisted) {
        // Best-effort: a release failure leaves an inert orphan; it must never
        // fail the committed write. Parallel deletes, then swallow errors.
        await Promise.allSettled(
          supersededRefs.map((ref) => vault?.delete(ref)),
        );
      }
    }

    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// DataTable commands
// ---------------------------------------------------------------------------

/**
 * CreateDataTable — mints a DataTable with a client-supplied id, referencing a
 * DataSource (which an earlier command in the same batch may have created — the
 * shared tx handle makes that insert visible here).
 */
const createDataTable = mutation({
  args: {
    id: uuid,
    dataSourceId: uuid,
    name: text,
    table: text,
    sourceSchema: jsonb.optional(),
    fields: jsonb.optional(),
    metrics: jsonb.optional(),
    dataFrameId: uuid.optional(),
  },
  handler: async (ctx, args): Promise<{ id: string }> => {
    const [row] = (await ctx.db.into(dataTables).insert({
      id: args.id,
      dataSourceId: args.dataSourceId,
      name: args.name,
      table: args.table,
      sourceSchema: (args.sourceSchema as SourceSchema | undefined) ?? null,
      fields: (args.fields as Field[] | undefined) ?? [],
      metrics: (args.metrics as Metric[] | undefined) ?? [],
      dataFrameId: args.dataFrameId ?? null,
    })) as DataTableRow[];
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  },
});

/**
 * Throw if no DataTable with `id` exists. An UPDATE on a missing id touches 0
 * rows and would otherwise return `{ ok: true }` — a silent no-op the caller
 * reads as success. This matches the by-id invariant every other handler here
 * enforces (`setDataSourceConfig`, `renameNode`, `patchDataTableCollection`).
 */
async function requireDataTable(
  ctx: { db: import("@wystack/db").DrizzleTracker },
  id: string,
): Promise<void> {
  const row = await ctx.db.from(dataTables).where(eq("id", id)).first();
  if (!row) throw new Error(`Data table ${id} not found`);
}

/** SetDataTableSchema — replaces the discovered source schema slice. */
const setDataTableSchema = mutation({
  args: { id: uuid, sourceSchema: jsonb },
  handler: async (ctx, { id, sourceSchema }): Promise<{ ok: true }> => {
    await requireDataTable(ctx, id);
    await ctx.db
      .from(dataTables)
      .where(eq("id", id))
      .update({ sourceSchema: sourceSchema as SourceSchema });
    return { ok: true };
  },
});

/** RefreshDataTable — points the table at a new DataFrame and stamps the fetch. */
const refreshDataTable = mutation({
  args: { id: uuid, dataFrameId: uuid },
  handler: async (ctx, { id, dataFrameId }): Promise<{ ok: true }> => {
    await requireDataTable(ctx, id);
    await ctx.db
      .from(dataTables)
      .where(eq("id", id))
      .update({ dataFrameId, lastFetchedAt: new Date() });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Insight commands
// ---------------------------------------------------------------------------

/**
 * CreateInsight — mints a new transform node over a DataFrame-producing input
 * (DataTable or another Insight). `source.sourceId` is written into both the
 * polymorphic `source` field and `baseTableId` (which `rowToInsight` surfaces
 * on the `Insight` domain type). When `sourceType === 'insight'` `baseTableId`
 * carries the upstream insight id; consumers resolving the structural source
 * read `source.sourceType` to disambiguate.
 */
const createInsight = mutation({
  args: {
    id: uuid,
    name: text,
    source: jsonb,
    selectedFields: jsonb.optional(),
    metrics: jsonb.optional(),
  },
  handler: async (ctx, args): Promise<{ id: string }> => {
    const parsedSource = insightSourceSchema.safeParse(args.source);
    if (!parsedSource.success) {
      throw new Error(
        `CreateInsight: source is invalid: ${parsedSource.error.message}`,
      );
    }
    const source = parsedSource.data as InsightSource;
    // Reject a self-referential insight source up front. With a client-supplied
    // id a caller can pass `source: { sourceType: 'insight', sourceId: <this id> }`,
    // which would write a 1-cycle into definition.source that SetInsightSource's
    // cycle guard is built to forbid — CreateInsight must hold the same invariant.
    if (source.sourceType === "insight" && source.sourceId === args.id) {
      throw new Error(
        `CreateInsight: source ${source.sourceId} would create a cycle (self-reference)`,
      );
    }
    // The source must resolve to an existing row — JSON source has no FK, so an
    // unvalidated sourceId would persist as a dangling reference.
    await requireSourceExists(ctx, source);
    const definition: StoredInsightDefinition = {
      baseTableId: source.sourceId,
      source,
      selectedFields: (args.selectedFields as UUID[] | undefined) ?? [],
      // Stored as InsightMetric (sourceTable), the shape the read path expects.
      metrics: (args.metrics as InsightMetric[] | undefined) ?? [],
    };
    const [row] = (await ctx.db.into(insights).insert({
      id: args.id,
      name: args.name,
      definition,
      createdBy: { kind: "user" },
    })) as InsightRow[];
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  },
});

/**
 * SetInsightSource — re-points an Insight's input to a DataTable or another
 * Insight's DataFrame (Insight-on-Insight composition). Rejects a source that
 * would create a cycle — i.e. if the proposed source already depends on this
 * Insight transitively.
 */
const setInsightSource = mutation({
  args: { id: uuid, source: jsonb },
  handler: async (ctx, { id, source: rawSource }): Promise<{ ok: true }> => {
    const parsedSource = insightSourceSchema.safeParse(rawSource);
    if (!parsedSource.success) {
      throw new Error(
        `SetInsightSource: source is invalid: ${parsedSource.error.message}`,
      );
    }
    const source = parsedSource.data as InsightSource;
    const { definition } = await requireInsightDefinition(ctx, id);

    // The source must resolve to an existing row before we persist it (JSON
    // source has no FK). Run this BEFORE the cycle walk: wouldCreateCycle treats
    // a missing insight row as a leaf and returns false, so a dangling insight
    // source would otherwise slip past cycle detection and persist.
    await requireSourceExists(ctx, source);

    // Cycle detection: only needed when the new source is another Insight.
    if (source.sourceType === "insight") {
      if (await wouldCreateCycle(ctx, id, source.sourceId)) {
        throw new Error(
          `SetInsightSource: source ${source.sourceId} would create a cycle`,
        );
      }
    }

    const next: StoredInsightDefinition = {
      ...definition,
      baseTableId: source.sourceId,
      source,
    };
    await ctx.db
      .from(insights)
      .where(eq("id", id))
      .update({ definition: next });
    return { ok: true };
  },
});

/**
 * SelectFields — replace-all set of selected dimension field ids on an Insight.
 * Replace-all semantics: the caller supplies the desired final set; incremental
 * add/remove is done client-side before calling this command.
 */
const selectFields = mutation({
  args: { id: uuid, fieldIds: jsonb },
  handler: async (ctx, { id, fieldIds }): Promise<{ ok: true }> => {
    const { definition } = await requireInsightDefinition(ctx, id);
    const next: StoredInsightDefinition = {
      ...definition,
      selectedFields: fieldIds as UUID[],
    };
    await ctx.db
      .from(insights)
      .where(eq("id", id))
      .update({ definition: next });
    return { ok: true };
  },
});

/**
 * SetInsightFilter — replace-all filter predicates. Each filter value operand
 * is a tagged union `{ kind: 'value', v } | { kind: 'lateBound', ref }` per
 * the tagged-union discriminant requirement (no property-presence).
 * The command stores operands opaquely — validation of the union discriminant
 * is shape-only here; unknown handles fail at publish binding (Draft spec).
 */
const setInsightFilter = mutation({
  args: { id: uuid, filters: jsonb },
  handler: async (ctx, { id, filters }): Promise<{ ok: true }> => {
    const { definition } = await requireInsightDefinition(ctx, id);
    const next: StoredInsightDefinition = {
      ...definition,
      filters: filters as unknown[],
    };
    await ctx.db
      .from(insights)
      .where(eq("id", id))
      .update({ definition: next });
    return { ok: true };
  },
});

/**
 * SetInsightSort — replace-all sort order. Replace-all semantics mirror
 * SetInsightFilter: the complete desired sort list replaces the existing one.
 */
const setInsightSort = mutation({
  args: { id: uuid, sorts: jsonb },
  handler: async (ctx, { id, sorts }): Promise<{ ok: true }> => {
    const { definition } = await requireInsightDefinition(ctx, id);
    const next: StoredInsightDefinition = {
      ...definition,
      sorts: sorts as unknown[],
    };
    await ctx.db
      .from(insights)
      .where(eq("id", id))
      .update({ definition: next });
    return { ok: true };
  },
});

/**
 * Apply one incremental edit to the `joins` collection in an Insight definition.
 * Mirrors `patchDataTableCollection`'s guard symmetry:
 * - Add: rejects a duplicate joinIndex (we use array-position indexing, so the
 *   guard is that the array is not already longer than `joinIndex` would imply
 *   — AddJoin appends so there is no index collision; the spec uses array
 *   indices for Update/Remove because joins are ordered and anonymous).
 * - Update: rejects a missing index. Pins the structure so updates cannot
 *   rewrite the whole join object in ways that clobber unrelated keys.
 * - Remove: rejects a missing index.
 */
function patchJoinsCollection(
  joins: unknown[],
  op:
    | { mode: "add"; join: InsightJoinConfig }
    | { mode: "update"; joinIndex: number; updates: Record<string, unknown> }
    | { mode: "remove"; joinIndex: number },
): unknown[] {
  if (op.mode === "add") {
    return [...joins, op.join];
  } else if (op.mode === "update") {
    if (op.joinIndex < 0 || op.joinIndex >= joins.length) {
      throw new Error(`Join at index ${op.joinIndex} not found`);
    }
    // Pin the join by spreading updates then overwriting the whole element —
    // the same id-pin semantics that patchDataTableCollection provides.
    return joins.map((j, i) =>
      i === op.joinIndex ? { ...(j as object), ...op.updates } : j,
    );
  } else {
    if (op.joinIndex < 0 || op.joinIndex >= joins.length) {
      throw new Error(`Join at index ${op.joinIndex} not found`);
    }
    return joins.filter((_, i) => i !== op.joinIndex);
  }
}

/**
 * Validate that `value` is a well-formed InsightJoinConfig (shape only): a known
 * join `type`, a string `rightTableId`, and string `leftKey`/`rightKey`. The
 * `rightTableId` FK is checked separately against the DataTable table (see AddJoin)
 * — downstream SQL assembly silently skips an unresolved join table, so a malformed
 * or dangling join must be rejected at the write boundary, not produce wrong results.
 */
function requireJoinShape(value: unknown): InsightJoinConfig {
  if (!isRecord(value)) {
    throw new Error("AddJoin: join must be an object");
  }
  if (
    value.type !== "inner" &&
    value.type !== "left" &&
    value.type !== "right" &&
    value.type !== "full"
  ) {
    throw new Error(
      `AddJoin: join.type must be one of inner|left|right|full, got ${JSON.stringify(value.type)}`,
    );
  }
  if (typeof value.rightTableId !== "string") {
    throw new Error("AddJoin: join.rightTableId must be a string");
  }
  if (typeof value.leftKey !== "string" || typeof value.rightKey !== "string") {
    throw new Error("AddJoin: join.leftKey and join.rightKey must be strings");
  }
  return value as unknown as InsightJoinConfig;
}

/** AddJoin — append an inline join to an Insight. */
const addJoin = mutation({
  args: { id: uuid, join: jsonb },
  handler: async (ctx, { id, join }): Promise<{ ok: true }> => {
    const validated = requireJoinShape(join);
    // The rightTableId has no stored FK (joins live in jsonb), so verify it
    // resolves to an existing DataTable — an unresolved join table is silently
    // skipped by SQL assembly, producing wrong results instead of a clear reject.
    const rightTable = await ctx.db
      .from(dataTables)
      .where(eq("id", validated.rightTableId))
      .first();
    if (!rightTable) {
      throw new Error(
        `AddJoin: rightTableId ${validated.rightTableId} does not resolve to a DataTable`,
      );
    }
    const { definition } = await requireInsightDefinition(ctx, id);
    const next: StoredInsightDefinition = {
      ...definition,
      joins: patchJoinsCollection(definition.joins ?? [], {
        mode: "add",
        join: validated,
      }),
    };
    await ctx.db
      .from(insights)
      .where(eq("id", id))
      .update({ definition: next });
    return { ok: true };
  },
});

/** UpdateJoin — edit a join's keys/type at the given array index. */
const updateJoin = mutation({
  args: { id: uuid, joinIndex: jsonb, updates: jsonb },
  handler: async (ctx, { id, joinIndex, updates }): Promise<{ ok: true }> => {
    if (!isRecord(updates) || Object.keys(updates).length === 0) {
      throw new Error("updates are required for UpdateJoin");
    }
    if (
      typeof joinIndex !== "number" ||
      !Number.isInteger(joinIndex) ||
      joinIndex < 0
    ) {
      throw new Error(
        `UpdateJoin: joinIndex must be a non-negative integer, got ${JSON.stringify(joinIndex)}`,
      );
    }
    const { definition } = await requireInsightDefinition(ctx, id);
    const next: StoredInsightDefinition = {
      ...definition,
      joins: patchJoinsCollection(definition.joins ?? [], {
        mode: "update",
        joinIndex,
        updates,
      }),
    };
    await ctx.db
      .from(insights)
      .where(eq("id", id))
      .update({ definition: next });
    return { ok: true };
  },
});

/** RemoveJoin — drop the join at the given array index. */
const removeJoin = mutation({
  args: { id: uuid, joinIndex: jsonb },
  handler: async (ctx, { id, joinIndex }): Promise<{ ok: true }> => {
    if (
      typeof joinIndex !== "number" ||
      !Number.isInteger(joinIndex) ||
      joinIndex < 0
    ) {
      throw new Error(
        `RemoveJoin: joinIndex must be a non-negative integer, got ${JSON.stringify(joinIndex)}`,
      );
    }
    const { definition } = await requireInsightDefinition(ctx, id);
    const next: StoredInsightDefinition = {
      ...definition,
      joins: patchJoinsCollection(definition.joins ?? [], {
        mode: "remove",
        joinIndex,
      }),
    };
    await ctx.db
      .from(insights)
      .where(eq("id", id))
      .update({ definition: next });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Fields & Metrics commands — target a DataFrame-producing node via {nodeId}
// ---------------------------------------------------------------------------

type ResolvedNode =
  | { kind: "dataTable"; row: DataTableRow }
  | { kind: "insight"; row: InsightRow };

/**
 * The result of a polymorphic field/metric command. `target.kind` reports which
 * artifact `nodeId` resolved to (DataTable or Insight) — the same table the edit
 * actually ran against. The preview builder READS this instead of re-deriving the
 * kind (it hard-coded `dataTable`, mislabeling Insight nodes and seeding the
 * downstream walk from the wrong kind). Mirrors the RenameNodeResult precedent.
 */
export interface FieldMetricResult {
  ok: true;
  target: { kind: "dataTable" | "insight"; id: UUID };
}

/**
 * One incremental edit to a node's fields/metrics collection. Shared across the
 * DataTable path, the Insight metrics path, and the Insight selectedFields path so
 * all three enforce the same add/update/remove guard symmetry.
 */
type CollectionOp =
  | { mode: "add"; item: Field | Metric | InsightMetric }
  | { mode: "update"; itemId: string; updates: Record<string, unknown> }
  | { mode: "remove"; itemId: string };

/**
 * Resolve which kind of node `nodeId` is, returning the row it already fetched
 * so callers don't pay a second lookup. A leaf node is a DataTable (fields and
 * metrics live in its jsonb columns); a derived node is an Insight (fields and
 * metrics live in its `definition` jsonb). One lookup decides the dispatch so
 * the command shape (`{ nodeId, ... }`) never needs to know the kind up front.
 */
async function resolveNode(
  ctx: { db: import("@wystack/db").DrizzleTracker },
  nodeId: string,
): Promise<ResolvedNode> {
  const table = (await ctx.db
    .from(dataTables)
    .where(eq("id", nodeId))
    .first()) as DataTableRow | undefined;
  if (table) return { kind: "dataTable", row: table };
  const insight = (await ctx.db
    .from(insights)
    .where(eq("id", nodeId))
    .first()) as InsightRow | undefined;
  if (insight) return { kind: "insight", row: insight };
  throw new Error(`Node ${nodeId} not found`);
}

/**
 * Validate that `value` is an InsightMetric (sourceTable shape) and return it.
 * Mirrors requireInsightMetric in app-artifacts.ts — the same shape the read
 * path enforces — so AddMetric on an Insight node always stores a metric the
 * read path accepts. Inlined here to avoid a cross-module circular dependency.
 */
function requireInsightMetricShape(value: unknown): InsightMetric {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.sourceTable !== "string" ||
    typeof value.aggregation !== "string"
  ) {
    throw new Error(
      "InsightMetric must include id, name, sourceTable, and aggregation",
    );
  }
  return value as unknown as InsightMetric;
}

/**
 * Apply a field edit to an Insight via `definition.selectedFields` — the array the
 * read path (rowToInsight) actually surfaces. An Insight does not own Field objects;
 * it SELECTS field ids from its source, so a field command resolves to a membership
 * edit of the id set, mirroring patchInsightDefinition's addField/removeField in
 * app-artifacts.ts:
 *   - Add: append the field's id (reject duplicate — matches the collection guard).
 *   - Remove: drop the id (reject missing).
 *   - Update: rejected — a referenced field has no editable definition on the
 *     Insight (its shape lives on the source); writing one would silently no-op
 *     against the read path. Fail loudly instead.
 */
async function patchInsightSelectedFields(
  ctx: { db: import("@wystack/db").DrizzleTracker },
  nodeId: string,
  _row: InsightRow,
  op: CollectionOp,
): Promise<void> {
  if (op.mode === "update") {
    throw new Error(
      "UpdateField is not supported on an Insight: fields are selected by reference (edit the source field, or re-select via SelectFields)",
    );
  }
  // Validate the stored definition at the point of use — a corrupt blob must
  // produce a clean "corrupt definition" error, not crash on `.selectedFields`.
  const { definition } = await requireInsightDefinition(ctx, nodeId);
  const selected = definition.selectedFields.slice();
  if (op.mode === "add") {
    const fieldId = op.item.id;
    if (selected.includes(fieldId)) {
      throw new Error(`fields item ${fieldId} already exists`);
    }
    selected.push(fieldId);
  } else {
    if (!selected.includes(op.itemId)) {
      throw new Error(`fields item ${op.itemId} not found`);
    }
    const idx = selected.indexOf(op.itemId);
    selected.splice(idx, 1);
  }
  const nextDefinition: StoredInsightDefinition = {
    ...definition,
    selectedFields: selected,
  };
  await ctx.db
    .from(insights)
    .where(eq("id", nodeId))
    .update({ definition: nextDefinition });
}

/**
 * Apply one incremental collection edit to a node's fields or metrics array.
 * For DataTable nodes the array lives in the row's `fields`/`metrics` columns.
 * For Insight nodes the array lives inside `definition.fields`/`definition.metrics`
 * (not the top-level jsonb `definition` structure — the Insight's own-definitions
 * section, distinct from the inherited ones from its source).
 *
 * Guard symmetry:
 * - Add: rejects duplicate id (no illegal two-items-one-id state)
 * - Update: rejects missing id; pins `id` last so updates cannot rebind the key
 * - Remove: rejects missing id
 *
 * Concurrency: read-modify-write is safe on PGLite (single-connection —
 * batches serialize at the event loop). A future multi-connection Postgres
 * backend needs SELECT FOR UPDATE or jsonb-native append.
 */
async function patchDataTableCollection(
  ctx: { db: import("@wystack/db").DrizzleTracker },
  nodeId: string,
  kind: "fields" | "metrics",
  op: CollectionOp,
): Promise<"dataTable" | "insight"> {
  const node = await resolveNode(ctx, nodeId);

  if (node.kind === "insight") {
    if (kind === "fields") {
      await patchInsightSelectedFields(ctx, nodeId, node.row, op);
      return "insight";
    }
    // Insight metrics live inside the definition jsonb under `metrics`, the same
    // key the read path (rowToInsight) surfaces. Validate the stored definition
    // at the point of use — a corrupt blob must produce a clean "corrupt
    // definition" error, not crash on `.metrics`.
    const { definition } = await requireInsightDefinition(ctx, nodeId);
    const items = (definition.metrics as { id: string }[]).slice();
    // AddMetric on an Insight must store InsightMetric (sourceTable), the shape
    // requireInsightMetric in app-artifacts.ts enforces on the read path.
    // Validate at the write boundary so stored metrics always round-trip through
    // the read path — same class of fix as CreateInsight.metrics (commit 72365b0).
    const normalizedOp =
      op.mode === "add"
        ? { ...op, item: requireInsightMetricShape(op.item) }
        : op;
    const next = applyCollectionOp(items, kind, normalizedOp);
    // Re-validate the merged metric after an update so corrupting fields like
    // `sourceTable` or `aggregation` to null are caught here — same as AddMetric.
    if (op.mode === "update") {
      const merged = next.find((item) => item.id === op.itemId);
      requireInsightMetricShape(merged);
    }
    const nextDefinition = { ...definition, metrics: next };
    await ctx.db
      .from(insights)
      .where(eq("id", nodeId))
      .update({ definition: nextDefinition });
    return "insight";
  }

  // DataTable path: items live in the top-level row columns.
  const items = ((node.row[kind] ?? []) as { id: string }[]).slice();
  const next = applyCollectionOp(items, kind, op);

  await ctx.db
    .from(dataTables)
    .where(eq("id", nodeId))
    .update({ [kind]: next });
  return "dataTable";
}

/**
 * Pure helper: apply one add/update/remove op to a `{ id: string }[]` array,
 * enforcing the guard symmetry. Extracted so both the DataTable and Insight
 * paths share identical mutation logic.
 */
function applyCollectionOp(
  items: { id: string }[],
  kind: string,
  op: CollectionOp,
): { id: string }[] {
  if (op.mode === "add") {
    // Guard id uniqueness symmetrically with Update/Remove. Without it a second
    // Add of the same id would make an illegal state representable (two items,
    // one id) that Update/Remove then mutate/drop together — silently
    // un-addressable individually.
    if (items.some((item) => item.id === op.item.id)) {
      throw new Error(`${kind} item ${op.item.id} already exists`);
    }
    return [...items, op.item];
  } else if (op.mode === "update") {
    if (!items.some((item) => item.id === op.itemId)) {
      throw new Error(`${kind} item ${op.itemId} not found`);
    }
    // Pin `id` last so a stray `updates.id` cannot rebind the item — that would
    // recreate the un-addressable two-items-one-id state the Add-guard prevents.
    return items.map((item) =>
      item.id === op.itemId ? { ...item, ...op.updates, id: item.id } : item,
    );
  } else {
    if (!items.some((item) => item.id === op.itemId)) {
      throw new Error(`${kind} item ${op.itemId} not found`);
    }
    return items.filter((item) => item.id !== op.itemId);
  }
}

const addField = mutation({
  args: { nodeId: uuid, field: jsonb },
  handler: async (ctx, { nodeId, field }): Promise<FieldMetricResult> => {
    const kind = await patchDataTableCollection(ctx, nodeId, "fields", {
      mode: "add",
      item: requireRecordWithId(field, "field") as unknown as Field,
    });
    return { ok: true, target: { kind, id: nodeId } };
  },
});

const updateField = mutation({
  args: { nodeId: uuid, fieldId: uuid, updates: jsonb },
  handler: async (
    ctx,
    { nodeId, fieldId, updates },
  ): Promise<FieldMetricResult> => {
    if (!isRecord(updates) || Object.keys(updates).length === 0) {
      throw new Error("updates are required for UpdateField");
    }
    const kind = await patchDataTableCollection(ctx, nodeId, "fields", {
      mode: "update",
      itemId: fieldId,
      updates,
    });
    return { ok: true, target: { kind, id: nodeId } };
  },
});

const removeField = mutation({
  args: { nodeId: uuid, fieldId: uuid },
  handler: async (ctx, { nodeId, fieldId }): Promise<FieldMetricResult> => {
    const kind = await patchDataTableCollection(ctx, nodeId, "fields", {
      mode: "remove",
      itemId: fieldId,
    });
    return { ok: true, target: { kind, id: nodeId } };
  },
});

const addMetric = mutation({
  args: { nodeId: uuid, metric: jsonb },
  handler: async (ctx, { nodeId, metric }): Promise<FieldMetricResult> => {
    const kind = await patchDataTableCollection(ctx, nodeId, "metrics", {
      mode: "add",
      // Cast as Metric | InsightMetric — the insight branch validates sourceTable
      // via requireInsightMetricShape before storing; the DataTable branch stores
      // the Metric shape as-is (tableId).
      item: requireRecordWithId(metric, "metric") as unknown as
        | Metric
        | InsightMetric,
    });
    return { ok: true, target: { kind, id: nodeId } };
  },
});

const updateMetric = mutation({
  args: { nodeId: uuid, metricId: uuid, updates: jsonb },
  handler: async (
    ctx,
    { nodeId, metricId, updates },
  ): Promise<FieldMetricResult> => {
    if (!isRecord(updates) || Object.keys(updates).length === 0) {
      throw new Error("updates are required for UpdateMetric");
    }
    const kind = await patchDataTableCollection(ctx, nodeId, "metrics", {
      mode: "update",
      itemId: metricId,
      updates,
    });
    return { ok: true, target: { kind, id: nodeId } };
  },
});

const removeMetric = mutation({
  args: { nodeId: uuid, metricId: uuid },
  handler: async (ctx, { nodeId, metricId }): Promise<FieldMetricResult> => {
    const kind = await patchDataTableCollection(ctx, nodeId, "metrics", {
      mode: "remove",
      itemId: metricId,
    });
    return { ok: true, target: { kind, id: nodeId } };
  },
});

// ---------------------------------------------------------------------------
// Visualization commands
// ---------------------------------------------------------------------------

/**
 * Remove the `data` key from a Vega-Lite spec before persisting.
 * Keeps storage/privacy behaviour consistent with the legacy
 * createVisualization/updateVisualization handlers in app-artifacts.ts.
 */
function stripDataFromSpec(spec: VegaLiteSpec): VegaLiteSpec {
  const next = { ...spec };
  delete next.data;
  return next;
}

/**
 * CreateVisualization — mints a chart over an Insight's DataFrame with a
 * client-supplied id. Insight and Visualization stay 1:many (spec decision):
 * the UI creates a 1:1 feel by batching CreateInsight + CreateVisualization in
 * one envelope, but the model keeps one-query-many-charts open.
 */
const createVisualization = mutation({
  args: {
    id: uuid,
    name: text,
    insightId: uuid,
    visualizationType: text,
    spec: jsonb,
    encoding: jsonb.optional(),
  },
  handler: async (ctx, args): Promise<{ id: string }> => {
    const [row] = (await ctx.db.into(visualizations).insert({
      id: args.id,
      name: args.name,
      insightId: args.insightId,
      chartType: args.visualizationType,
      encoding: (args.encoding ?? {}) as VisualizationEncoding,
      options: { spec: stripDataFromSpec(args.spec as VegaLiteSpec) },
      createdBy: { kind: "user" },
    })) as VisualizationRow[];
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  },
});

async function requireVisualization(
  ctx: { db: import("@wystack/db").DrizzleTracker },
  id: string,
): Promise<void> {
  const row = await ctx.db.from(visualizations).where(eq("id", id)).first();
  if (!row) throw new Error(`Visualization ${id} not found`);
}

/**
 * SetChartType — change the chart type for an existing Visualization.
 * Decomposed out of the coarse `updateVisualization` blob handler.
 */
const setChartType = mutation({
  args: { id: uuid, visualizationType: text },
  handler: async (ctx, { id, visualizationType }): Promise<{ ok: true }> => {
    await requireVisualization(ctx, id);
    await ctx.db
      .from(visualizations)
      .where(eq("id", id))
      .update({ chartType: visualizationType });
    return { ok: true };
  },
});

/**
 * SetChartEncoding — set the field→channel encoding (and resulting Vega-Lite
 * spec) for a Visualization. `spec` is optional — omitting it leaves the
 * existing spec untouched.
 */
const setChartEncoding = mutation({
  args: { id: uuid, encoding: jsonb, spec: jsonb.optional() },
  handler: async (ctx, { id, encoding, spec }): Promise<{ ok: true }> => {
    await requireVisualization(ctx, id);
    const patch: Partial<VisualizationRow> = {
      encoding: encoding as VisualizationEncoding,
    };
    if (spec !== undefined) {
      patch.options = { spec: stripDataFromSpec(spec as VegaLiteSpec) };
    }
    await ctx.db.from(visualizations).where(eq("id", id)).update(patch);
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Dashboard commands
// ---------------------------------------------------------------------------

// Re-use the DashboardItem interface from dashboards.ts inline (no re-export).
interface DashboardItem {
  id: string;
  type: "visualization" | "markdown";
  visualizationId?: string;
  content?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  overrides?: DashboardItemOverrides;
}

/**
 * Override bag written into `DashboardItem.overrides` by the fan-out primitive.
 * Mirrors `DashboardItemOverrides` from @dashframe/types — kept inline to avoid
 * a circular package dependency from the server layer.
 */
interface DashboardItemOverrides {
  filters?: {
    field: string;
    operator:
      | "eq"
      | "ne"
      | "gt"
      | "gte"
      | "lt"
      | "lte"
      | "contains"
      | "in"
      | "between";
    value: unknown;
    cleared?: boolean;
  }[];
  sorts?: { field: string; direction: "asc" | "desc" }[];
  limit?: number;
}

/** Load a dashboard's layout array, throwing if the dashboard does not exist. */
async function requireDashboardItems(
  ctx: { db: import("@wystack/db").DrizzleTracker },
  dashboardId: string,
): Promise<DashboardItem[]> {
  const row = (await ctx.db
    .from(dashboards)
    .where(eq("id", dashboardId))
    .first()) as DashboardRow | undefined;
  if (!row) throw new Error(`Dashboard ${dashboardId} not found`);
  return ((row.layout as DashboardItem[]) ?? []).slice();
}

/**
 * Validate a full DashboardItem before it enters `dashboards.layout`. Mirrors the
 * runtime checks in dashboards.ts (parseDashboardType + parsePosition): readers and
 * layout rendering assume `type` is a known value and `x/y/width/height` are numbers.
 * The raw command path persists args verbatim, so the same boundary that the typed
 * dashboard mutation enforces is applied here.
 */
function requireDashboardItem(value: unknown): DashboardItem {
  if (!isRecord(value)) {
    throw new Error("AddDashboardItem: item must be an object");
  }
  if (typeof value.id !== "string") {
    throw new Error("AddDashboardItem: item.id must be a string");
  }
  if (value.type !== "visualization" && value.type !== "markdown") {
    throw new Error(
      `AddDashboardItem: item.type must be 'visualization' or 'markdown', got ${JSON.stringify(value.type)}`,
    );
  }
  for (const key of ["x", "y", "width", "height"] as const) {
    if (typeof value[key] !== "number") {
      throw new Error(`AddDashboardItem: item.${key} must be a number`);
    }
  }
  // `overrides` is passed through as-is — it is written by the fan-out primitive
  // which controls the shape; the per-field filter pin is validated there.
  return value as unknown as DashboardItem;
}

/**
 * Filter raw `updates` to the recognized DashboardItem fields with the correct
 * primitive types, dropping anything malformed. Mirrors sanitizeDashboardUpdates in
 * dashboards.ts so the raw command path cannot write `{ x: "left", width: null }`
 * into layout coordinates that consumers assume are numeric.
 */
function sanitizeDashboardItemUpdates(
  updates: Record<string, unknown>,
): Partial<Omit<DashboardItem, "id" | "type">> {
  const next: Partial<Omit<DashboardItem, "id" | "type">> = {};
  if (typeof updates.visualizationId === "string") {
    next.visualizationId = updates.visualizationId;
  }
  if (typeof updates.content === "string") next.content = updates.content;
  if (typeof updates.x === "number") next.x = updates.x;
  if (typeof updates.y === "number") next.y = updates.y;
  if (typeof updates.width === "number") next.width = updates.width;
  if (typeof updates.height === "number") next.height = updates.height;
  // `overrides` is passed through as-is — callers use this to update or clear
  // a panel's filter/sort/limit bag. The shape is opaque jsonb; downstream
  // rendering validates filters at query time, not at the write boundary.
  // An explicit `undefined` means "not updating overrides" (the key was absent
  // in the updates object); `null` is not in the type so omit check mirrors
  // the other field guards.
  if ("overrides" in updates) {
    next.overrides = updates.overrides as DashboardItemOverrides | undefined;
  }
  return next;
}

/**
 * CreateDashboard — mints an empty dashboard with a client-supplied id.
 */
const createDashboard = mutation({
  args: { id: uuid, name: text, description: text.optional() },
  handler: async (ctx, { id, name, description }): Promise<{ id: string }> => {
    const [row] = (await ctx.db.into(dashboards).insert({
      id,
      name,
      description: description ?? null,
      layout: [],
      createdBy: { kind: "user" },
    })) as DashboardRow[];
    if (!row) throw new Error("insert returned no row");
    return { id: row.id };
  },
});

/**
 * AddDashboardItem — place a viz panel or markdown block on a dashboard.
 *
 * Guard symmetry: the item's `id` is caller-supplied (client-generated, same
 * client-id invariant as every Create command). Duplicate ids are rejected so
 * UpdateDashboardItem and RemoveDashboardItem always address exactly one item.
 */
const addDashboardItem = mutation({
  args: { dashboardId: uuid, item: jsonb },
  handler: async (
    ctx,
    { dashboardId, item: rawItem },
  ): Promise<{ ok: true }> => {
    const item = requireDashboardItem(rawItem);
    const items = await requireDashboardItems(ctx, dashboardId);
    if (items.some((it) => it.id === item.id)) {
      throw new Error(`Dashboard item ${item.id} already exists`);
    }
    items.push(item);
    await ctx.db
      .from(dashboards)
      .where(eq("id", dashboardId))
      .update({ layout: items });
    return { ok: true };
  },
});

/**
 * UpdateDashboardItem — move/resize/edit one item.
 *
 * Guard: rejects a missing itemId. Pins `id` and `type` so updates cannot
 * change structural container keys (mirrors UpdateField's id-pin contract).
 */
const updateDashboardItem = mutation({
  args: { dashboardId: uuid, itemId: uuid, updates: jsonb },
  handler: async (
    ctx,
    { dashboardId, itemId, updates },
  ): Promise<{ ok: true }> => {
    if (!isRecord(updates) || Object.keys(updates).length === 0) {
      throw new Error("updates are required for UpdateDashboardItem");
    }
    const items = await requireDashboardItems(ctx, dashboardId);
    if (!items.some((it) => it.id === itemId)) {
      throw new Error(`Dashboard item ${itemId} not found`);
    }
    // Filter `updates` to recognized fields with correct primitive types before
    // merging — the raw command path would otherwise write `{ x: "left" }` into
    // layout coordinates consumers assume are numeric. Pin `id` and `type` last —
    // type is a structural key (determines which optional fields are valid), so
    // callers cannot rebind it via updates.
    const sanitized = sanitizeDashboardItemUpdates(updates);
    const next = items.map((it) =>
      it.id === itemId
        ? {
            ...it,
            ...sanitized,
            id: it.id,
            type: it.type,
          }
        : it,
    );
    await ctx.db
      .from(dashboards)
      .where(eq("id", dashboardId))
      .update({ layout: next });
    return { ok: true };
  },
});

/**
 * SetDashboardLayout — replace the whole layout at once (bulk drag-rearrange).
 * Replace-all counterpart to per-item UpdateDashboardItem. Unlike the
 * replace-all SetInsightFilter/SetInsightSort, dashboard items are id-keyed:
 * UpdateDashboardItem and RemoveDashboardItem both rely on id uniqueness, so a
 * duplicate in the incoming list would corrupt those operations. Guard it.
 */
const setDashboardLayout = mutation({
  args: { dashboardId: uuid, items: jsonb },
  handler: async (ctx, { dashboardId, items }): Promise<{ ok: true }> => {
    // Guard existence first — a missing dashboard would silently do nothing.
    await requireDashboardItems(ctx, dashboardId);
    const parsed = items as DashboardItem[];
    const ids = parsed.map((it) => it.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("SetDashboardLayout: items contains duplicate ids");
    }
    await ctx.db
      .from(dashboards)
      .where(eq("id", dashboardId))
      .update({ layout: parsed });
    return { ok: true };
  },
});

/**
 * RemoveDashboardItem — remove one panel by id.
 * Guard: rejects a missing itemId (no silent no-op).
 */
const removeDashboardItem = mutation({
  args: { dashboardId: uuid, itemId: uuid },
  handler: async (ctx, { dashboardId, itemId }): Promise<{ ok: true }> => {
    const items = await requireDashboardItems(ctx, dashboardId);
    if (!items.some((it) => it.id === itemId)) {
      throw new Error(`Dashboard item ${itemId} not found`);
    }
    await ctx.db
      .from(dashboards)
      .where(eq("id", dashboardId))
      .update({ layout: items.filter((it) => it.id !== itemId) });
    return { ok: true };
  },
});

/**
 * FanOutDashboardItems — batch-clone a source viz item N times, each pinning
 * one value of a field in its `overrides`.
 *
 * The agent supplies all inputs deterministically:
 *   - `sourceItemId`  — the existing viz panel to clone
 *   - `field`         — the field name to pin in each clone's overrides
 *   - `placements`    — one entry per value: `{ id, value, x, y, width?, height? }`
 *     `width`/`height` default to the source item's dimensions if omitted.
 *
 * Contracts:
 *   - Source item must be a `visualization` (has `visualizationId`); markdown
 *     items have no insight to override.
 *   - `placements` must be non-empty (no silent no-op).
 *   - All clone ids must be unique against each other AND the existing layout.
 *   - Source item's existing `overrides.filters` are cloned; the pin for `field`
 *     replaces an existing filter on the same field (in-place) or appends.
 *   - The source item itself and the insight definition are never mutated.
 */
const fanOutDashboardItems = mutation({
  args: {
    dashboardId: uuid,
    sourceItemId: uuid,
    field: text,
    placements: jsonb,
  },
  handler: async (
    ctx,
    { dashboardId, sourceItemId, field, placements: rawPlacements },
  ): Promise<{ ok: true; created: string[] }> => {
    // Validate placements shape.
    if (!Array.isArray(rawPlacements) || rawPlacements.length === 0) {
      throw new Error(
        "FanOutDashboardItems: placements must be a non-empty array",
      );
    }
    type Placement = {
      id: string;
      value: unknown;
      x: number;
      y: number;
      width?: number;
      height?: number;
    };
    const placements = rawPlacements as Placement[];
    for (const p of placements) {
      if (typeof p.id !== "string") {
        throw new Error(
          "FanOutDashboardItems: each placement must have a string id",
        );
      }
      if (typeof p.x !== "number" || typeof p.y !== "number") {
        throw new Error(
          "FanOutDashboardItems: each placement must have numeric x and y",
        );
      }
      // Reject missing `value` key explicitly (use `in` not truthiness so that
      // null and false are valid pin values — only absent-key is an error).
      if (!("value" in p)) {
        throw new Error(
          "FanOutDashboardItems: each placement must include a value key",
        );
      }
    }

    const items = await requireDashboardItems(ctx, dashboardId);

    // Locate the source item.
    const source = items.find((it) => it.id === sourceItemId);
    if (!source) {
      throw new Error(
        `FanOutDashboardItems: source item ${sourceItemId} not found`,
      );
    }
    if (source.type !== "visualization" || !source.visualizationId) {
      throw new Error(
        "FanOutDashboardItems: source item must be a visualization with a visualizationId",
      );
    }

    // Guard: all clone ids must be unique against each other AND the existing
    // layout (the client-id invariant).
    const existingIds = new Set(items.map((it) => it.id));
    const newIds = placements.map((p) => p.id);
    if (new Set(newIds).size !== newIds.length) {
      throw new Error(
        "FanOutDashboardItems: placements contains duplicate ids",
      );
    }
    for (const newId of newIds) {
      if (existingIds.has(newId)) {
        throw new Error(
          `FanOutDashboardItems: clone id ${newId} already exists in the dashboard`,
        );
      }
    }

    // Build N clones. Each clone inherits the source's overrides.filters (and
    // sorts/limit) then replaces/appends the pin for `field`.
    const sourceFilters: DashboardItemOverrides["filters"] =
      source.overrides?.filters ?? [];
    // Spread to avoid sharing the same array reference across all N clones —
    // the serialization collapses the alias today, but explicit isolation makes
    // any future per-clone mutation safe.
    const sourceSorts = source.overrides?.sorts
      ? [...source.overrides.sorts]
      : undefined;
    const sourceLimit = source.overrides?.limit;

    const clones: DashboardItem[] = placements.map((p) => {
      // Clone the source filters array; replace the filter for `field` in-place
      // if one exists, otherwise append. Stable ordering for reproducibility.
      const baseFilters = sourceFilters.filter((f) => f.field !== field);
      const pin = { field, operator: "eq" as const, value: p.value };
      const filters = [...baseFilters, pin];

      const overrides: DashboardItemOverrides = { filters };
      if (sourceSorts) overrides.sorts = sourceSorts;
      if (sourceLimit !== undefined) overrides.limit = sourceLimit;

      return {
        id: p.id,
        type: "visualization",
        visualizationId: source.visualizationId,
        x: p.x,
        y: p.y,
        width: typeof p.width === "number" ? p.width : source.width,
        height: typeof p.height === "number" ? p.height : source.height,
        overrides,
      };
    });

    // Write all clones into the layout in one read-modify-write.
    const next = [...items, ...clones];
    await ctx.db
      .from(dashboards)
      .where(eq("id", dashboardId))
      .update({ layout: next });

    return { ok: true, created: newIds };
  },
});

// ---------------------------------------------------------------------------
// Cross-cutting: RenameNode (one polymorphic rename)
// ---------------------------------------------------------------------------

/**
 * The `renameNode` handler's result. `renamed` reports the artifact the rename
 * actually resolved to — which table the SET ran against. The preview builder
 * reads this instead of re-deriving the resolution (public issue #64). `value`
 * on the matching `CommandResult` carries this through `applyCommands` verbatim.
 */
export interface RenameNodeResult {
  ok: true;
  renamed: RenamedTarget;
}

/**
 * RenameNode — the single `name` mutation, carved out of every coarse
 * update(blob). Polymorphic over the three artifact NODE kinds
 * (DataSource / DataTable / Insight); presentation artifacts (e.g. views)
 * rename through their own surfaces. One lookup decides the table; the SET
 * is identical across them. The result reports the resolved target so the
 * preview reads the decision rather than re-deriving it.
 */
const renameNode = mutation({
  args: { id: uuid, name: text },
  handler: async (ctx, { id, name }): Promise<RenameNodeResult> => {
    // Probe order (dataTables → dataSources → insights) is load-bearing: the
    // preview builder reads `renamed` to learn which artifact this rename hit
    // rather than re-deriving the resolution (public issue #64). The reported
    // `kind` is the table the SET actually ran against — the single source of
    // truth the preview consumes.
    const table = await ctx.db.from(dataTables).where(eq("id", id)).first();
    if (table) {
      await ctx.db.from(dataTables).where(eq("id", id)).update({ name });
      return { ok: true, renamed: { kind: "dataTable", id } };
    }
    const source = await ctx.db.from(dataSources).where(eq("id", id)).first();
    if (source) {
      await ctx.db.from(dataSources).where(eq("id", id)).update({ name });
      return { ok: true, renamed: { kind: "dataSource", id } };
    }
    const insight = await ctx.db.from(insights).where(eq("id", id)).first();
    if (insight) {
      await ctx.db.from(insights).where(eq("id", id)).update({ name });
      return { ok: true, renamed: { kind: "insight", id } };
    }
    const viz = await ctx.db.from(visualizations).where(eq("id", id)).first();
    if (viz) {
      await ctx.db.from(visualizations).where(eq("id", id)).update({ name });
      return { ok: true, renamed: { kind: "visualization", id } };
    }
    const dash = await ctx.db.from(dashboards).where(eq("id", id)).first();
    if (dash) {
      await ctx.db.from(dashboards).where(eq("id", id)).update({ name });
      return { ok: true, renamed: { kind: "dashboard", id } };
    }
    throw new Error(`Node ${id} not found`);
  },
});

// ---------------------------------------------------------------------------
// Cross-cutting: DeleteNode (one polymorphic delete — typed-edge cascade rule)
// ---------------------------------------------------------------------------

/**
 * An orphaned node description returned by DeleteNode when a delete stops at a
 * reference edge. The caller (UI or agent) routes these into the Data-Drift
 * Repair flow — from a reference child's perspective, a deleted parent is
 * indistinguishable from drift.
 */
export interface OrphanedNode {
  /** The id of the now-orphaned artifact. */
  id: string;
  /** The kind of artifact: 'insight' | 'visualization' | 'dashboard'. */
  kind: "insight" | "visualization" | "dashboard";
}

/**
 * The `deleteNode` handler's result. `deleted.kind` reports which artifact `id`
 * resolved to — the table the delete actually ran against. The preview builder
 * READS this to group the direct node and seed the downstream walk from the right
 * kind, instead of hard-coding `dataTable` (which mislabeled a deleted Visualization
 * / Dashboard / Insight / DataSource and read the wrong before-slice). Mirrors the
 * RenameNodeResult precedent. `orphanedNodes` is the reference-boundary warning
 * surface routed into Data-Drift Repair (orphan-and-warn is by design).
 */
export interface DeleteNodeResult {
  ok: true;
  deleted: { kind: ArtifactKind; id: UUID };
  orphanedNodes: OrphanedNode[];
}

/**
 * Walk all Insights whose primary source OR any join dependency equals
 * `sourceId`. These are the reference-boundary nodes that must be routed to
 * drift-repair when `sourceId` is deleted.
 *
 * The check covers:
 *   • The new `source.sourceId` field (CreateInsight / SetInsightSource).
 *   • The legacy `baseTableId` field for pre-composition rows (written before
 *     `source` was introduced; both fields are kept in lockstep on writes).
 *   • Any `joins[*].rightTableId` — an Insight that JOINs against the deleted
 *     node is just as broken as one that sources it directly.
 *
 * Because insights.definition is a jsonb column with no stored FK, this is a
 * full-table scan filtered in application code (PGLite single-connection, the
 * table is small in practice). A future index on a promoted column would speed
 * this up; the read is intentionally bounded to the delete path.
 *
 * Parsing is split from comparison: `parseRowDefinition` validates the JSONB
 * blob ONCE per insight (fail-closed throw on corrupt), and `definitionRefers`
 * is a pure check against the already-parsed definition. This keeps the
 * DataSource-delete scan at O(insights) parses instead of O(insights × tables)
 * — `deleteDataSourceDependents` compares one parsed definition against every
 * owned table without re-validating per table.
 *
 * A corrupt `definition` blob throws immediately (fail-closed), aborting the
 * entire scan. One bad row blocks a delete until the row is repaired — the
 * deliberate trade-off vs. silently mis-classifying orphans or skipping the row.
 */
function parseRowDefinition(row: InsightRow): StoredInsightDefinition {
  const parsed = storedInsightDefinitionSchema.safeParse(row.definition);
  if (!parsed.success) {
    throw new Error(
      `Insight ${row.id} has a corrupt definition: ${parsed.error.message}`,
    );
  }
  return parsed.data as StoredInsightDefinition;
}

/**
 * Pure orphan check against an already-parsed definition — no validation, no
 * DB access. An Insight is orphaned by `sourceId` if its primary source (or
 * legacy `baseTableId`) equals it, or any join's `rightTableId` equals it.
 */
function definitionRefers(
  def: StoredInsightDefinition,
  sourceId: string,
): boolean {
  // Primary source check.
  const primaryMatch = def.source
    ? def.source.sourceId === sourceId
    : def.baseTableId === sourceId;
  if (primaryMatch) return true;
  // Join-dependency check — an Insight JOINing against the deleted node
  // is also orphaned (its rightTableId no longer resolves).
  const joins = (def.joins ?? []) as { rightTableId?: string }[];
  return joins.some((j) => j.rightTableId === sourceId);
}

async function findOrphanedInsights(
  ctx: { db: import("@wystack/db").DrizzleTracker },
  sourceId: string,
): Promise<{ id: string }[]> {
  const allInsights = (await ctx.db.from(insights).all()) as InsightRow[];
  // Parse each definition once (fail-closed), then check the single sourceId.
  return allInsights.filter((row) =>
    definitionRefers(parseRowDefinition(row), sourceId),
  );
}

/**
 * Delete all DataFrame metadata rows linked to the given node id (by
 * `insightId` column) and return their storage locations so the caller can
 * signal Arrow/IndexedDB cleanup. DataTable rows link via `dataFrameId` (a
 * nullable FK on the DataTable row itself), not a column on the DataFrame —
 * so DataTable cleanup is handled by the caller passing the DataTable's
 * `dataFrameId` directly.
 *
 * The `dataFrames` table stores metadata only; the actual Arrow bytes live in
 * the renderer's IndexedDB. Deleting the metadata row here is the signal the
 * client-side `removeDataFrame` hook needs to clean up the Arrow bytes via
 * `deleteArrowData(storage.key)` (see `packages/app-data/src/data-frames.ts`).
 */
async function deleteInsightDataFrames(
  ctx: { db: import("@wystack/db").DrizzleTracker },
  insightId: string,
): Promise<void> {
  // Delete all DataFrame rows whose insightId matches — there should be at
  // most one per Insight in practice, but the schema allows N.
  await ctx.db.from(dataFrames).where(eq("insightId", insightId)).delete();
}

/**
 * Collect all orphaned Insights and clean up DataFrame metadata for a
 * DataSource delete. Extracted to keep `deleteNode`'s handler within the
 * cognitive-complexity budget.
 *
 * Returns the deduplicated set of Insights that SOURCE or JOIN any of
 * `ownedTables` (these are the reference-boundary orphans). As a side-effect,
 * deletes the DataFrame metadata rows for each DataTable's Arrow result so the
 * client-side `removeDataFrame` hook can clean up Arrow bytes.
 *
 * The full insights table is fetched once (not once-per-table) so that N owned
 * tables do not produce N round-trips.
 */
async function deleteDataSourceDependents(
  ctx: { db: import("@wystack/db").DrizzleTracker },
  ownedTables: (typeof dataTables.$inferSelect)[],
): Promise<OrphanedNode[]> {
  // Fetch all insights once — avoids O(N) full-table scans inside the loop.
  const allInsights = (await ctx.db.from(insights).all()) as InsightRow[];
  const ownedTableIds = new Set(ownedTables.map((t) => t.id));

  // Detect reference-boundary Insights across ALL owned tables (deduplicated).
  const seen = new Set<string>();
  const orphanedNodes: OrphanedNode[] = [];
  for (const row of allInsights) {
    if (seen.has(row.id)) continue;
    // Parse each insight's definition ONCE (fail-closed), then compare the
    // parsed result against every owned table — not re-parsing per table.
    const def = parseRowDefinition(row);
    // Check primary source and all join dependencies against every owned table.
    const orphaned = [...ownedTableIds].some((tableId) =>
      definitionRefers(def, tableId),
    );
    if (orphaned) {
      seen.add(row.id);
      orphanedNodes.push({ id: row.id, kind: "insight" });
    }
  }

  // Clean up DataFrame metadata for each owned DataTable's Arrow result.
  for (const t of ownedTables) {
    if (t.dataFrameId) {
      await ctx.db.from(dataFrames).where(eq("id", t.dataFrameId)).delete();
    }
  }

  return orphanedNodes;
}

/**
 * After a DataSource row has been deleted, flush a durable snapshot and then
 * release any credential vault refs that were held in its config. Extracted to
 * reduce `deleteNode`'s handler cognitive complexity.
 *
 * Ordering invariant: delete-row → this function → refs released.
 * This ensures the snapshot that lands on disk already reflects the absent row,
 * so a crash-and-restart cannot produce a snapshot that references a deleted ref.
 *
 * Skips if: (a) preview mode (vault is not transactional — releasing here would
 * orphan the surviving row's refs after the rolled-back transaction), or (b) the
 * config holds no credential refs (nothing to release).
 * Fail-safe: if `flushSnapshot` throws, the release is skipped — inert orphan,
 * never a dangling live reference.
 */
async function releaseDataSourceCredentials(
  ctx: import("@wystack/server").FunctionContext,
  sourceConfig: DataSourceConfig,
): Promise<void> {
  const vault = vaultFromCtx(ctx);
  const preview = modeFromCtx(ctx) === "preview";
  const hasCredentialRefs =
    isSecretRef(sourceConfig.apiKey) ||
    isSecretRef(sourceConfig.connectionString);
  if (preview || !hasCredentialRefs) return;

  const flushSnapshot = (ctx as Record<string, unknown>).flushSnapshot as
    | (() => Promise<void>)
    | undefined;
  if (flushSnapshot != null) {
    try {
      await flushSnapshot();
    } catch (err) {
      console.error(
        "[dashframe] deleteNode/dataSource: flushSnapshot failed, skipping credential release:",
        err,
      );
      return; // skip release — inert orphan is safer than a dangling live ref
    }
  }
  try {
    await releaseCredentialRefs(sourceConfig, vault);
  } catch (err) {
    console.error(
      "[dashframe] deleteNode/dataSource: credential ref release failed (inert orphan):",
      err,
    );
  }
}

/**
 * DeleteNode — one polymorphic delete that implements the Artifact Model's
 * typed-edge cascade rule (Spec — DashFrame Artifact Model, "Edge types and
 * the delete cascade"):
 *
 *   Ownership edges (cascade through): DataSource → DataTable.
 *   Reference edges (stop at): DataTable → Insight, Insight → Insight,
 *     Insight → Visualization (owned by schema FK — kept because Viz has no
 *     independent value without its Insight).
 *
 * **Cascade path:**
 *   - Deleting a Visualization:
 *       • The Visualization is removed.
 *       • Dashboards that contain this visualization via a layout item's
 *         `visualizationId` are returned as `orphanedNodes` (reference edge).
 *   - Deleting a Dashboard: only the Dashboard is removed.
 *   - Deleting an Insight:
 *       • Owned Visualizations cascade-delete via the DB schema FK.
 *       • The Insight's DataFrame metadata row is deleted (triggers Arrow
 *         cleanup on the client via `removeDataFrame`).
 *       • Insights that SOURCE this Insight are returned as `orphanedNodes`.
 *       • Dashboards with layout items referencing the owned Visualizations are
 *         also returned as `orphanedNodes` (cascade removed their viz tiles).
 *   - Deleting a DataTable:
 *       • The DataTable's DataFrame metadata row is deleted.
 *       • Insights that SOURCE this DataTable are returned as `orphanedNodes`.
 *   - Deleting a DataSource:
 *       • Owned DataTables cascade-delete via the DB schema FK.
 *       • DataFrame metadata rows for each owned DataTable are deleted.
 *       • Insights that SOURCE any of those DataTables are returned as
 *         `orphanedNodes`.
 *
 * The returned `orphanedNodes` list is the "warning surface" the ticket
 * describes — the UI/agent routes these into the Data-Drift Repair flow.
 * Nothing is silently orphaned and no authored artifact is silently destroyed.
 */
const deleteNode = mutation({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<DeleteNodeResult> => {
    // --- Visualization -------------------------------------------------------
    // No owned children. Reference boundary: Dashboards that contain this
    // visualization via a layout item's `visualizationId` are orphaned when the
    // visualization is deleted — surface them in orphanedNodes for drift-repair.
    const viz = await ctx.db.from(visualizations).where(eq("id", id)).first();
    if (viz) {
      const allDashboards = (await ctx.db
        .from(dashboards)
        .all()) as DashboardRow[];
      const affectedDashboards = allDashboards.filter((d) => {
        const items = ((d.layout as DashboardItem[]) ?? []) as DashboardItem[];
        return items.some((it) => it.visualizationId === id);
      });
      await ctx.db.from(visualizations).where(eq("id", id)).delete();
      return {
        ok: true,
        deleted: { kind: "visualization", id },
        orphanedNodes: affectedDashboards.map((d) => ({
          id: d.id,
          kind: "dashboard" as const,
        })),
      };
    }

    // --- Dashboard (leaf — no owned children, no reference children) --------
    const dash = await ctx.db.from(dashboards).where(eq("id", id)).first();
    if (dash) {
      await ctx.db.from(dashboards).where(eq("id", id)).delete();
      return {
        ok: true,
        deleted: { kind: "dashboard", id },
        orphanedNodes: [],
      };
    }

    // --- Insight ------------------------------------------------------------
    // Owned visualizations cascade-delete via the DB schema FK
    // (visualizations.insight_id references insights.id ON DELETE CASCADE).
    // Reference-boundary: Insights that SOURCE this Insight enter drift-repair.
    // Dashboard items that reference any of the owned Visualizations also enter
    // drift-repair (the FK cascade removes the viz, the layout item becomes stale).
    const insight = (await ctx.db
      .from(insights)
      .where(eq("id", id))
      .first()) as InsightRow | undefined;
    if (insight) {
      // Detect reference-boundary orphans BEFORE the delete (so the rows exist).
      const derivedInsights = await findOrphanedInsights(ctx, id);
      // Collect owned visualizations BEFORE the cascade so we can check dashboards.
      const ownedVizIds = new Set(
        (
          (await ctx.db
            .from(visualizations)
            .where(eq("insightId", id))
            .all()) as VisualizationRow[]
        ).map((v) => v.id),
      );
      // Find dashboards with layout items referencing any owned visualization.
      const allDashboards = (await ctx.db
        .from(dashboards)
        .all()) as DashboardRow[];
      const affectedDashboards = allDashboards.filter((d) => {
        const items = ((d.layout as DashboardItem[]) ?? []) as DashboardItem[];
        return items.some(
          (it) => it.visualizationId && ownedVizIds.has(it.visualizationId),
        );
      });
      // Clean up DataFrame metadata so the client-side Arrow cleanup hook fires.
      await deleteInsightDataFrames(ctx, id);
      // Delete the Insight — schema FK cascade removes its Visualizations.
      await ctx.db.from(insights).where(eq("id", id)).delete();
      return {
        ok: true,
        deleted: { kind: "insight", id },
        orphanedNodes: [
          ...derivedInsights.map((r) => ({
            id: r.id,
            kind: "insight" as const,
          })),
          ...affectedDashboards.map((d) => ({
            id: d.id,
            kind: "dashboard" as const,
          })),
        ],
      };
    }

    // --- DataTable ----------------------------------------------------------
    // No owned children (DataTable is owned by DataSource, not by DataTable).
    // Reference-boundary: Insights that SOURCE this DataTable enter drift-repair.
    // Arrow cleanup: delete the DataTable's DataFrame metadata if it has one.
    const table = (await ctx.db
      .from(dataTables)
      .where(eq("id", id))
      .first()) as typeof dataTables.$inferSelect | undefined;
    if (table) {
      const orphanedInsights = await findOrphanedInsights(ctx, id);
      if (table.dataFrameId) {
        await ctx.db
          .from(dataFrames)
          .where(eq("id", table.dataFrameId))
          .delete();
      }
      await ctx.db.from(dataTables).where(eq("id", id)).delete();
      return {
        ok: true,
        deleted: { kind: "dataTable", id },
        orphanedNodes: orphanedInsights.map((r) => ({
          id: r.id,
          kind: "insight" as const,
        })),
      };
    }

    // --- DataSource ---------------------------------------------------------
    // Owned DataTables cascade-delete via the DB schema FK
    // (data_tables.data_source_id references data_sources.id ON DELETE CASCADE).
    // Collect owned tables before the delete (FK cascade would remove them).
    const source = await ctx.db.from(dataSources).where(eq("id", id)).first();
    if (source) {
      const ownedTables = (await ctx.db
        .from(dataTables)
        .where(eq("dataSourceId", id))
        .all()) as (typeof dataTables.$inferSelect)[];
      const orphanedNodes = await deleteDataSourceDependents(ctx, ownedTables);
      // PRE-RELEASE FLUSH GATE — collect credential refs from the config BEFORE
      // deleting the row, then delete the row, then flush a snapshot (so the
      // snapshot captures the "row deleted" state and can no longer reference
      // these refs), and only THEN release the refs. This ordering guarantees:
      //   collect-refs → delete-row → flush-snapshot → release-refs
      //
      // The previous ordering (release BEFORE delete) violated the invariant:
      // a ref was deleted from the vault before the canonical row was gone, and
      // before the snapshot captured its absence — a crash between release and
      // the next snapshot could leave the snapshot referencing a now-deleted ref.
      //
      // In preview mode vault.delete() is skipped — like vault.store(), it is a
      // keychain side-effect outside the DB transaction. A preview executes then
      // rolls back: the DataSource row (with its refs) survives, so its credential
      // must survive too. Releasing here would orphan the surviving row's refs.
      const sourceConfig = (source.config ?? {}) as DataSourceConfig;
      // Delete the DataSource — schema FK cascade removes its DataTables.
      await ctx.db.from(dataSources).where(eq("id", id)).delete();
      // Flush a snapshot and release credential vault refs held in the config.
      // See `releaseDataSourceCredentials` for the ordering guarantee and
      // fail-safe semantics. Credential-free deletes are a no-op here.
      await releaseDataSourceCredentials(ctx, sourceConfig);
      return { ok: true, deleted: { kind: "dataSource", id }, orphanedNodes };
    }

    throw new Error(`Node ${id} not found`);
  },
});

/**
 * The command-backing mutation registry. Spread into the app's `functions` so
 * `applyCommands` can dispatch each by path. Keys are the wire paths the
 * builders below reference.
 */
export const commandFunctions = {
  // DataSource
  getOrCreateDataSource,
  createDataSource,
  setDataSourceConfig,
  // DataTable
  createDataTable,
  setDataTableSchema,
  refreshDataTableCmd: refreshDataTable,
  // Fields & Metrics (targets DataTable or Insight via nodeId)
  addField,
  updateField,
  removeField,
  addMetric,
  updateMetric,
  removeMetric,
  // Insight
  createInsightCmd: createInsight,
  setInsightSource,
  selectFields,
  setInsightFilter,
  setInsightSort,
  addJoin,
  updateJoin,
  removeJoin,
  // Visualization
  createVisualizationCmd: createVisualization,
  setChartType,
  setChartEncoding,
  // Dashboard
  createDashboardCmd: createDashboard,
  addDashboardItemCmd: addDashboardItem,
  updateDashboardItemCmd: updateDashboardItem,
  setDashboardLayout,
  removeDashboardItemCmd: removeDashboardItem,
  fanOutDashboardItemsCmd: fanOutDashboardItems,
  // Cross-cutting
  renameNode,
  deleteNode,
};

// ---------------------------------------------------------------------------
// Typed command builders — the VOCABULARY face
// ---------------------------------------------------------------------------

/**
 * The polymorphic source for Insight commands (DataTable or another Insight's
 * DataFrame). Exported so callers can construct it without knowing the union
 * shape inline.
 */
export type InsightSourceInput =
  | { sourceType: "dataTable"; sourceId: UUID }
  | { sourceType: "insight"; sourceId: UUID };

/**
 * A filter predicate value operand — tagged union (discriminant required,
 * no property-presence).
 * `kind: 'value'`    → the author supplied the literal (v: null = IS NULL).
 * `kind: 'lateBound'` → the egress gate withheld the value; bound at publish.
 */
export type FilterOperandValue =
  | { kind: "value"; v: unknown }
  | { kind: "lateBound"; ref: LateBoundRef };

/**
 * Late-bound reference forms (spec: Artifact API, Operand value-binding).
 * column    → operand IS another column; no literal needed.
 * category  → opaque handle for a value the gate minted; resolved at publish.
 * placeholder → human supplies at publish.
 */
export type LateBoundRef =
  | { type: "column"; fieldId: UUID }
  | { type: "category"; handle: string }
  | { type: "placeholder"; prompt: string };

/**
 * A filter predicate where the value operand is a FilterOperandValue.
 * Mirrors InsightFilter from @dashframe/types but with the typed operand.
 */
export interface TypedInsightFilter {
  field: string;
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";
  value: FilterOperandValue;
}

/**
 * Filter override for a single dashboard item. Intentional subset of the domain
 * `InsightFilterOverride` (from @dashframe/types):
 *   - No `id?` field — override filters created by the fan-out primitive are
 *     anonymous (id is a UI-path concern for stable re-targeting concurrent edits).
 *   - `cleared?` is retained — callers can widen a source item's filter by passing
 *     `cleared: true` to cancel a specific field's inherited filter.
 *   - Kept inline (not imported) to avoid a circular package dependency from the
 *     server layer back into @dashframe/types.
 */
export interface DashboardItemFilterOverride {
  field: string;
  operator:
    | "eq"
    | "ne"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "contains"
    | "in"
    | "between";
  value: unknown;
  cleared?: boolean;
}

/** Override bag for a dashboard item (instrument-level overrides). */
export interface DashboardItemOverridesInput {
  filters?: DashboardItemFilterOverride[];
  sorts?: { field: string; direction: "asc" | "desc" }[];
  limit?: number;
}

/** A Dashboard item as supplied in AddDashboardItem / SetDashboardLayout. */
export interface DashboardItemInput {
  id: UUID;
  type: "visualization" | "markdown";
  visualizationId?: UUID;
  content?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  overrides?: DashboardItemOverridesInput;
}

/**
 * Typed payloads for each command. These are the intent-carrying messages the
 * human UI and the agent both construct; `COMMAND_PATHS` lowers them to the
 * `{ path, args }` envelope `applyCommands` dispatches. Keeping the builder pure
 * (no DB) means the only place command logic lives is the backing mutation.
 */
export interface CommandPayloads {
  // DataSource
  GetOrCreateDataSource: { id: UUID; type: string; name: string };
  CreateDataSource: {
    id: UUID;
    type: string;
    name: string;
    apiKey?: string;
    connectionString?: string;
    /** Provenance of the emitter — `{ kind: "agent" }` for agent-authored. */
    createdBy?: ArtifactProvenance;
  };
  SetDataSourceConfig: {
    id: UUID;
    apiKey?: string;
    connectionString?: string;
    /** Non-credential connector settings. Must not include 'apiKey' or 'connectionString'. */
    extra?: Record<string, unknown>;
  };
  // DataTable
  CreateDataTable: {
    id: UUID;
    dataSourceId: UUID;
    name: string;
    table: string;
    sourceSchema?: SourceSchema;
    fields?: Field[];
    metrics?: Metric[];
    dataFrameId?: UUID;
  };
  SetDataTableSchema: { id: UUID; sourceSchema: SourceSchema };
  RefreshDataTable: { id: UUID; dataFrameId: UUID };
  // Fields & Metrics (targets DataTable or Insight via nodeId)
  AddField: { nodeId: UUID; field: Field };
  UpdateField: { nodeId: UUID; fieldId: UUID; updates: Partial<Field> };
  RemoveField: { nodeId: UUID; fieldId: UUID };
  // AddMetric is polymorphic: targets DataTable (Metric shape, tableId) or
  // Insight (InsightMetric shape, sourceTable). The handler validates the shape
  // at the write boundary (requireInsightMetricShape) for the Insight path.
  AddMetric: { nodeId: UUID; metric: Metric | InsightMetric };
  UpdateMetric: { nodeId: UUID; metricId: UUID; updates: Partial<Metric> };
  RemoveMetric: { nodeId: UUID; metricId: UUID };
  // Insight
  CreateInsight: {
    id: UUID;
    name: string;
    source: InsightSourceInput;
    selectedFields?: UUID[];
    // Insight metrics carry `sourceTable`, not the DataTable `Metric.tableId`.
    // The read path (requireInsightMetric in app-artifacts.ts) enforces
    // `sourceTable`, so the typed face must guide callers to the right shape.
    metrics?: InsightMetric[];
  };
  SetInsightSource: { id: UUID; source: InsightSourceInput };
  SelectFields: { id: UUID; fieldIds: UUID[] };
  SetInsightFilter: { id: UUID; filters: TypedInsightFilter[] };
  SetInsightSort: { id: UUID; sorts: InsightSort[] };
  AddJoin: { id: UUID; join: InsightJoinConfig };
  UpdateJoin: {
    id: UUID;
    joinIndex: number;
    updates: Partial<InsightJoinConfig>;
  };
  RemoveJoin: { id: UUID; joinIndex: number };
  // Visualization
  CreateVisualization: {
    id: UUID;
    name: string;
    insightId: UUID;
    visualizationType: VisualizationType;
    spec: VegaLiteSpec;
    encoding?: VisualizationEncoding;
  };
  SetChartType: { id: UUID; visualizationType: VisualizationType };
  SetChartEncoding: {
    id: UUID;
    encoding: VisualizationEncoding;
    spec?: VegaLiteSpec;
  };
  // Dashboard
  CreateDashboard: { id: UUID; name: string; description?: string };
  AddDashboardItem: { dashboardId: UUID; item: DashboardItemInput };
  UpdateDashboardItem: {
    dashboardId: UUID;
    itemId: UUID;
    updates: Partial<Omit<DashboardItemInput, "id" | "type">>;
  };
  SetDashboardLayout: { dashboardId: UUID; items: DashboardItemInput[] };
  RemoveDashboardItem: { dashboardId: UUID; itemId: UUID };
  FanOutDashboardItems: {
    dashboardId: UUID;
    sourceItemId: UUID;
    field: string;
    placements: {
      id: UUID;
      value: unknown;
      x: number;
      y: number;
      width?: number;
      height?: number;
    }[];
  };
  // Cross-cutting
  RenameNode: { id: UUID; name: string };
  DeleteNode: { id: UUID };
}

export type CommandName = keyof CommandPayloads;

/**
 * Map a command name to the registry path its backing mutation is registered
 * under in the app `functions`. The single source of truth tying the typed
 * vocabulary to the dispatched path.
 */
export const COMMAND_PATHS: {
  [K in CommandName]: keyof typeof commandFunctions;
} = {
  GetOrCreateDataSource: "getOrCreateDataSource",
  CreateDataSource: "createDataSource",
  SetDataSourceConfig: "setDataSourceConfig",
  CreateDataTable: "createDataTable",
  SetDataTableSchema: "setDataTableSchema",
  RefreshDataTable: "refreshDataTableCmd",
  AddField: "addField",
  UpdateField: "updateField",
  RemoveField: "removeField",
  AddMetric: "addMetric",
  UpdateMetric: "updateMetric",
  RemoveMetric: "removeMetric",
  CreateInsight: "createInsightCmd",
  SetInsightSource: "setInsightSource",
  SelectFields: "selectFields",
  SetInsightFilter: "setInsightFilter",
  SetInsightSort: "setInsightSort",
  AddJoin: "addJoin",
  UpdateJoin: "updateJoin",
  RemoveJoin: "removeJoin",
  CreateVisualization: "createVisualizationCmd",
  SetChartType: "setChartType",
  SetChartEncoding: "setChartEncoding",
  CreateDashboard: "createDashboardCmd",
  AddDashboardItem: "addDashboardItemCmd",
  UpdateDashboardItem: "updateDashboardItemCmd",
  SetDashboardLayout: "setDashboardLayout",
  RemoveDashboardItem: "removeDashboardItemCmd",
  FanOutDashboardItems: "fanOutDashboardItemsCmd",
  RenameNode: "renameNode",
  DeleteNode: "deleteNode",
};

/**
 * Build one `Command` envelope from a typed payload. `cmd("AddField", {...})`
 * gives compile-time checking of the payload AND the right dispatch path — the
 * capability-parity seam: the same builder the UI and agent call.
 */
export function cmd<K extends CommandName>(
  name: K,
  payload: CommandPayloads[K],
): Command {
  return { path: COMMAND_PATHS[name], args: payload };
}

/**
 * Which credential fields each command's `args` may carry, keyed by the REGISTRY
 * PATH the command dispatches against (`COMMAND_PATHS` value, the same string
 * stored in `draft_command_log.path`). The single source of truth tying a
 * command path to its credential-bearing arg fields.
 *
 * Used by both the capture-before-log seam (rewrite plaintext args → vault refs
 * before the command is snapshotted into the log) and the transition-release
 * mechanism (extract draft-minted / replaced refs from the durable log). Keeping
 * this with the vocabulary keeps the credential-field set in lockstep with the
 * command handlers that read those fields.
 */
export const CREDENTIAL_COMMAND_FIELDS: Readonly<
  Record<string, ReadonlyArray<"apiKey" | "connectionString">>
> = {
  [COMMAND_PATHS.CreateDataSource]: ["apiKey", "connectionString"],
  [COMMAND_PATHS.SetDataSourceConfig]: ["apiKey", "connectionString"],
};
