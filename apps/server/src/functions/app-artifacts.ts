import {
  makeGa4Connector,
  type Ga4ReportVersion,
  type GoogleOAuthTokenBundle,
} from "@dashframe/connector-ga4";
import { makeNotionConnector } from "@dashframe/connector-notion";
import { makePostgresConnector } from "@dashframe/connector-postgres";
// The canonical bound-resolver type — aliased for readability at the mint site.
import type { SecretResolver as BoundSecretResolver } from "@dashframe/engine";
import { inspectArrowIpc } from "@dashframe/engine-server/arrow-data-path";
import { schema } from "@dashframe/server-core";
import type {
  DataFrameAnalysis,
  DataFrameJSON,
  DataFrameStorageLocation,
  DataSource,
  DataTable,
  Field,
  Insight,
  Metric,
  SourceSchema,
  UUID,
  VegaLiteSpec,
  Visualization,
  VisualizationEncoding,
  VisualizationType,
} from "@dashframe/types";
import { getFieldSensitivity, stripSampleValues } from "@dashframe/types";
import { boolean, eq, int, jsonb, text, uuid } from "@wystack/db";
import { PermissionDeniedError } from "@wystack/permissions";
import type { SecretRef, SecretVault } from "@wystack/secret-vault";
import { isSecretRef } from "@wystack/secret-vault";
import { randomUUID } from "node:crypto";

import type { DashframeFunctionContext } from "../app-context";
import { permissions } from "../permissions";
import { wy } from "../wystack";
import { decodeInsight, type InsightRow } from "./insights";
import { tsToMillis } from "./timestamps";
import {
  applyCredentialField,
  flushThenReleaseRefs,
  inDraftContext,
  isRecord,
  modeFromCtx,
  vaultFromCtx,
  type DataSourceConfig,
} from "./utils";

const {
  dashboards,
  dataFrames,
  dataSources,
  dataTables,
  insights,
  visualizations,
} = schema;

type DataSourceRow = typeof dataSources.$inferSelect;
type DataTableRow = typeof dataTables.$inferSelect;
type DataFrameRow = typeof dataFrames.$inferSelect;
type VisualizationRow = typeof visualizations.$inferSelect;

type DataFrameEntry = DataFrameJSON & {
  name: string;
  insightId?: UUID;
  sourceId?: UUID;
  definitionId?: UUID;
  rowCount?: number;
  columnCount?: number;
  // `null` is a deliberate clear signal (see updateDataFrameEntry below), not
  // merely "absent" — keep it distinct from `undefined` so a future cleanup
  // doesn't read the clearing branch as dead code and revert it.
  analysis?: DataFrameAnalysis | null;
  lastRefreshedAt?: number;
  currentInsightResult?: boolean;
};

function nullableDateFromEpoch(value: number | undefined): Date | null {
  return value === undefined ? null : new Date(value);
}

/**
 * Map a `data_sources` row to the `DataSource` read DTO.
 *
 * Presence flags (hasApiKey / hasConnectionString) are derived from the vault
 * when a vault is available: the config field holds a SecretRef, and
 * `vault.has(ref)` checks whether the ref resolves to a live secret without
 * decrypting. Falls back to a simple truthiness check (Boolean(config.apiKey))
 * when no vault is injected — this covers legacy rows in tests and pre-vault
 * dev paths where the config still holds plaintext-or-ref values.
 */
async function rowToDataSource(
  row: DataSourceRow,
  vault?: import("@wystack/secret-vault").SecretVault,
): Promise<DataSource> {
  const config = (row.config ?? {}) as DataSourceConfig;
  let hasApiKey: boolean;
  let hasConnectionString: boolean;
  if (vault != null) {
    // Presence via vault: config.apiKey is a SecretRef when set via the vault
    // path; isSecretRef guards against legacy plaintext rows.
    hasApiKey = isSecretRef(config.apiKey)
      ? await vault.has(
          config.apiKey as import("@wystack/secret-vault").SecretRef,
        )
      : Boolean(config.apiKey);
    hasConnectionString = isSecretRef(config.connectionString)
      ? await vault.has(
          config.connectionString as import("@wystack/secret-vault").SecretRef,
        )
      : Boolean(config.connectionString);
  } else {
    // Fallback: no vault — simple truthiness (covers legacy/test paths).
    hasApiKey = Boolean(config.apiKey);
    hasConnectionString = Boolean(config.connectionString);
  }
  // Pass through any non-credential keys from the stored config so future
  // fields are forward-compatible. Two exclusion criteria apply:
  //   1. Key name — "apiKey" and "connectionString" are the typed credential
  //      slots; they never appear in the public DTO (only the boolean flags do).
  //   2. Value shape — any value that is a well-formed SecretRef ("secret:<uuid>")
  //      is also dropped, regardless of key name. Guards the sink by value shape,
  //      not only by provenance: a future credential field stored under a
  //      non-standard key name can't leak a live ref to the renderer.
  const otherKeys: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (k !== "apiKey" && k !== "connectionString" && !isSecretRef(v)) {
      otherKeys[k] = v;
    }
  }
  return {
    id: row.id,
    type: row.kind,
    name: row.name,
    config: { hasApiKey, hasConnectionString, ...otherKeys },
    createdAt: tsToMillis(row.createdAt),
  };
}

function rowToDataTable(row: DataTableRow): DataTable {
  return {
    id: row.id,
    dataSourceId: row.dataSourceId,
    name: row.name,
    table: row.table,
    sourceSchema: (row.sourceSchema as SourceSchema | null) ?? undefined,
    fields: row.fields as Field[],
    metrics: row.metrics as Metric[],
    dataFrameId: row.dataFrameId ?? undefined,
    createdAt: tsToMillis(row.createdAt),
    lastFetchedAt: row.lastFetchedAt?.getTime(),
  };
}

function rowToDataFrame(row: DataFrameRow): DataFrameEntry {
  return {
    id: row.id,
    storage: row.storage as DataFrameStorageLocation,
    fieldIds: row.fieldIds as UUID[],
    primaryKey: (row.primaryKey as string | string[] | null) ?? undefined,
    createdAt: tsToMillis(row.createdAt),
    name: row.name,
    insightId: row.insightId ?? undefined,
    sourceId: row.sourceId ?? undefined,
    definitionId: row.definitionId ?? undefined,
    rowCount: row.rowCount ?? undefined,
    columnCount: row.columnCount ?? undefined,
    analysis: (row.analysis as DataFrameAnalysis | null) ?? undefined,
    lastRefreshedAt: row.lastRefreshedAt?.getTime() ?? undefined,
    currentInsightResult:
      (row.analysis as { currentInsightResult?: unknown } | null)
        ?.currentInsightResult === true,
  };
}

function rowToVisualization(row: VisualizationRow): Visualization {
  const options = (row.options ?? {}) as { spec?: VegaLiteSpec };
  return {
    id: row.id,
    insightId: row.insightId,
    name: row.name,
    visualizationType: row.chartType as VisualizationType,
    encoding: row.encoding as VisualizationEncoding | undefined,
    spec: options.spec ?? {},
    createdAt: tsToMillis(row.createdAt),
    updatedAt: row.updatedAt?.getTime(),
  };
}

const listDataSources = wy.procedure
  .input({})
  .query(async (ctx): Promise<DataSource[]> => {
    const vault = vaultFromCtx(ctx);
    const rows = (await ctx.db.from(dataSources).all()) as DataSourceRow[];
    return Promise.all(rows.map((row) => rowToDataSource(row, vault)));
  });

const getDataSource = wy.procedure
  .input({ id: uuid })
  .query(async (ctx, { id }): Promise<DataSource | null> => {
    const vault = vaultFromCtx(ctx);
    const row = (await ctx.db.from(dataSources).where(eq("id", id)).first()) as
      | DataSourceRow
      | undefined;
    return row ? rowToDataSource(row, vault) : null;
  });

const getDataSourceByType = wy.procedure
  .input({ type: text })
  .query(async (ctx, { type }): Promise<DataSource | null> => {
    const vault = vaultFromCtx(ctx);
    const row = (await ctx.db
      .from(dataSources)
      .where(eq("kind", type))
      .first()) as DataSourceRow | undefined;
    return row ? rowToDataSource(row, vault) : null;
  });

// NOTE: the racy `getOrCreateDataSourceByType` (check-then-insert keyed on
// `kind`, no unique constraint → concurrent ingests double-insert, PR #46
// Greptile P1) was REPLACED by the `GetOrCreateDataSource` command in
// `./commands.ts`, which keys idempotency on a client-minted primary key. See
// that file's traceability table.

const listDataTables = wy.procedure
  .input({ dataSourceId: uuid.optional() })
  .query(async (ctx, { dataSourceId }): Promise<DataTable[]> => {
    const rows = dataSourceId
      ? ((await ctx.db
          .from(dataTables)
          .where(eq("dataSourceId", dataSourceId))
          .all()) as DataTableRow[])
      : ((await ctx.db.from(dataTables).all()) as DataTableRow[]);
    return rows.map(rowToDataTable);
  });

const getDataTable = wy.procedure
  .input({ id: uuid })
  .query(async (ctx, { id }): Promise<DataTable | null> => {
    const row = (await ctx.db.from(dataTables).where(eq("id", id)).first()) as
      | DataTableRow
      | undefined;
    return row ? rowToDataTable(row) : null;
  });

const listDataFrames = wy.procedure
  .input({})
  .query(async (ctx): Promise<DataFrameEntry[]> => {
    const rows = (await ctx.db.from(dataFrames).all()) as DataFrameRow[];
    return rows.map(rowToDataFrame);
  });

const getDataFrameEntry = wy.procedure
  .input({ id: uuid })
  .query(async (ctx, { id }): Promise<DataFrameEntry | null> => {
    const row = (await ctx.db.from(dataFrames).where(eq("id", id)).first()) as
      | DataFrameRow
      | undefined;
    return row ? rowToDataFrame(row) : null;
  });

const getDataFrameByInsight = wy.procedure
  .input({ insightId: uuid })
  .query(async (ctx, { insightId }): Promise<DataFrameEntry | null> => {
    const rows = (await ctx.db
      .from(dataFrames)
      .where(eq("insightId", insightId))
      .all()) as DataFrameRow[];
    const row =
      rows.find(
        (candidate) =>
          (candidate.analysis as { currentInsightResult?: unknown } | null)
            ?.currentInsightResult === true,
      ) ??
      rows.reduce<DataFrameRow | undefined>((latest, candidate) => {
        if (!latest) return candidate;
        const candidateTime =
          candidate.lastRefreshedAt?.getTime() ?? candidate.createdAt.getTime();
        const latestTime =
          latest.lastRefreshedAt?.getTime() ?? latest.createdAt.getTime();
        return candidateTime > latestTime ? candidate : latest;
      }, undefined);
    return row ? rowToDataFrame(row) : null;
  });

const putDataFrameEntry = wy.procedure
  .input({ entry: jsonb })
  .mutation(async (ctx, { entry }): Promise<{ id: string }> => {
    const value = entry as DataFrameEntry;
    const existing = (await ctx.db
      .from(dataFrames)
      .where(eq("id", value.id))
      .first()) as DataFrameRow | undefined;
    assertExistingServerFrameImmutable(existing, value.storage);
    assertServerFrameOwnership(value.id, value.storage);
    // Strip raw sample values before persisting — privacy floor: the artifact
    // DB holds zero raw cell values. In-memory callers that need sampleValues
    // (e.g. the suggest-mode PII classifier) operate on the runtime object
    // before it reaches this write boundary.
    const safeAnalysis = sanitizePublicAnalysis(value.analysis);
    const row = {
      id: value.id,
      storage: value.storage,
      fieldIds: value.fieldIds,
      primaryKey: value.primaryKey ?? null,
      createdAt: new Date(value.createdAt),
      name: value.name,
      insightId: value.insightId ?? null,
      sourceId: value.sourceId ?? null,
      definitionId: value.definitionId ?? null,
      rowCount: value.rowCount ?? null,
      columnCount: value.columnCount ?? null,
      analysis: safeAnalysis,
      lastRefreshedAt: nullableDateFromEpoch(value.lastRefreshedAt),
    };
    if (existing) {
      await ctx.db.from(dataFrames).where(eq("id", value.id)).update(row);
    } else {
      await ctx.db.into(dataFrames).insert(row);
    }
    return { id: value.id };
  });

const updateDataFrameEntry = wy.procedure
  .input({ id: uuid, updates: jsonb })
  .mutation(async (ctx, { id, updates }): Promise<{ ok: true }> => {
    const patch = updates as Partial<DataFrameEntry>;
    const existing = (await ctx.db
      .from(dataFrames)
      .where(eq("id", id))
      .first()) as DataFrameRow | undefined;
    assertPublicFrameUpdate(existing, patch);
    if (patch.storage !== undefined) {
      assertExistingServerFrameImmutable(existing, patch.storage);
      assertServerFrameOwnership(id, patch.storage);
    }
    await ctx.db
      .from(dataFrames)
      .where(eq("id", id))
      .update({
        ...(patch.storage !== undefined ? { storage: patch.storage } : {}),
        ...(patch.fieldIds !== undefined ? { fieldIds: patch.fieldIds } : {}),
        ...(patch.primaryKey !== undefined
          ? { primaryKey: patch.primaryKey }
          : {}),
        ...(patch.createdAt !== undefined
          ? { createdAt: new Date(patch.createdAt) }
          : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.insightId !== undefined
          ? { insightId: patch.insightId }
          : {}),
        ...(patch.sourceId !== undefined ? { sourceId: patch.sourceId } : {}),
        ...(patch.definitionId !== undefined
          ? { definitionId: patch.definitionId }
          : {}),
        ...(patch.rowCount !== undefined ? { rowCount: patch.rowCount } : {}),
        ...(patch.columnCount !== undefined
          ? { columnCount: patch.columnCount }
          : {}),
        // Strip raw sample values at the write boundary (privacy floor).
        ...(patch.analysis !== undefined
          ? {
              analysis: preserveCurrentInsightMarker(
                sanitizePublicAnalysis(patch.analysis),
                existing?.analysis,
              ),
            }
          : {}),
        ...(patch.lastRefreshedAt !== undefined
          ? {
              lastRefreshedAt: nullableDateFromEpoch(patch.lastRefreshedAt),
            }
          : {}),
      });
    return { ok: true };
  });

const removeDataFrameEntry = wy.procedure
  .input({ id: uuid })
  .mutation(async (ctx, { id }): Promise<{ ok: true }> => {
    assertCanonicalFrameSideEffects(ctx);
    const row = (await ctx.db.from(dataFrames).where(eq("id", id)).first()) as
      | DataFrameRow
      | undefined;
    if (row && (row.storage as DataFrameStorageLocation).type !== "file") {
      throw new Error("Only server-owned DataFrames can be removed");
    }
    const staged = await stageServerFrames(ctx, row ? [row] : []);
    try {
      await ctx.db.transaction(async (tx) => {
        await tx
          .from(dataTables)
          .where(eq("dataFrameId", id))
          .update({ dataFrameId: null, lastFetchedAt: null });
        await tx.from(dataFrames).where(eq("id", id)).delete();
      });
    } catch (error) {
      await rollbackStagedServerFrames(ctx, staged);
      throw error;
    }
    await commitStagedServerFrames(ctx, staged);
    return { ok: true };
  });

const listInsights = wy.procedure
  .input({ excludeIds: jsonb.optional() })
  .query(async (ctx, { excludeIds }): Promise<Insight[]> => {
    const excluded = new Set((excludeIds as UUID[] | undefined) ?? []);
    const rows = (await ctx.db.from(insights).all()) as InsightRow[];
    return rows
      .map(decodeInsight)
      .filter((insight) => !excluded.has(insight.id));
  });

const getInsight = wy.procedure
  .input({ id: uuid })
  .query(async (ctx, { id }): Promise<Insight | null> => {
    const row = (await ctx.db.from(insights).where(eq("id", id)).first()) as
      | InsightRow
      | undefined;
    return row ? decodeInsight(row) : null;
  });

const listVisualizations = wy.procedure
  .input({ insightId: uuid.optional() })
  .query(async (ctx, { insightId }): Promise<Visualization[]> => {
    const rows = insightId
      ? ((await ctx.db
          .from(visualizations)
          .where(eq("insightId", insightId))
          .all()) as VisualizationRow[])
      : ((await ctx.db.from(visualizations).all()) as VisualizationRow[]);
    return rows.map(rowToVisualization);
  });

const getVisualization = wy.procedure
  .input({ id: uuid })
  .query(async (ctx, { id }): Promise<Visualization | null> => {
    const row = (await ctx.db
      .from(visualizations)
      .where(eq("id", id))
      .first()) as VisualizationRow | undefined;
    return row ? rowToVisualization(row) : null;
  });

const clearAllData = wy.procedure
  .input({})
  .mutation(async (ctx): Promise<{ ok: true }> => {
    assertCanonicalFrameSideEffects(ctx);
    // One unconditional DELETE FROM per table (DrizzleTracker.delete() with no
    // .where() clears the whole table). Idempotent and a single statement
    // each — no per-row round-trips, no partial-clear retry hazard. FK-child
    // tables first so cascade order is satisfied even without DB-level FKs.
    const frames = (await ctx.db.from(dataFrames).all()) as DataFrameRow[];
    const staged = await stageServerFrames(ctx, frames);
    try {
      await ctx.db.transaction(async (tx) => {
        await tx.from(dashboards).delete();
        await tx.from(visualizations).delete();
        await tx.from(insights).delete();
        await tx.from(dataFrames).delete();
        await tx.from(dataTables).delete();
        await tx.from(dataSources).delete();
      });
    } catch (error) {
      await rollbackStagedServerFrames(ctx, staged);
      throw error;
    }
    await commitStagedServerFrames(ctx, staged);
    return { ok: true };
  });

// ============================================================================
// Connector factory — the single (vault, ref) → boundResolver → connector
// mint site. Called by the notion data-plane routes below. The call site
// (the WyStack mutation handler) has no ref in scope after this call — only
// the typed connector data methods are visible.
// ============================================================================

/**
 * Mint a bound SecretResolver for a single credential ref.
 *
 * Capability attenuation: the returned resolver can open ONLY the secret at
 * `ref`. It cannot resolve any other ref — it's not a vault handle.
 *
 * The return type is the canonical `SecretResolver` from `@dashframe/engine`
 * (aliased `BoundSecretResolver` for local readability) — not a re-declaration —
 * so the connector factory's contract and this mint site can't drift.
 *
 * @throws when no vault is injected into this server (fail-closed)
 * @throws when `ref` is not a well-formed SecretRef
 */
function mintBoundResolver(
  vault: SecretVault | undefined,
  ref: string | undefined,
  label: string,
): BoundSecretResolver {
  if (vault == null) {
    throw new Error(
      `[connector-factory] no vault injected — cannot resolve credential for ${label}`,
    );
  }
  if (!ref || !isSecretRef(ref)) {
    throw new Error(
      `[connector-factory] ${label} has no valid SecretRef in config — ` +
        `run the control-plane migration first or set the API key`,
    );
  }
  const secretRef = ref as SecretRef;
  // Pre-bind vault.withSecret to this one ref. The connector calls
  // `this.auth(use => ...)` and never sees the vault or ref itself.
  return <T>(use: (plaintext: string) => Promise<T>) =>
    vault.withSecret(secretRef, use);
}

/**
 * Build a Notion connector for a DataSource: read the row, verify it's a notion
 * source, mint a bound resolver from the stored credential ref, and construct
 * the connector. The single seam where a notion connector is created from a
 * DataSource id — both data-plane routes go through it.
 *
 * @throws when the row is missing, not a notion source, or has no valid ref
 */
export async function notionConnectorFor(
  ctx: DashframeFunctionContext,
  dataSourceId: UUID,
): Promise<ReturnType<typeof makeNotionConnector>> {
  const vault = vaultFromCtx(ctx);
  const row = (await ctx.db
    .from(dataSources)
    .where(eq("id", dataSourceId))
    .first()) as DataSourceRow | undefined;
  if (!row) throw new Error(`DataSource ${dataSourceId} not found`);
  if (row.kind !== "notion") {
    throw new Error(`DataSource ${dataSourceId} is not a notion source`);
  }
  const config = (row.config ?? {}) as DataSourceConfig;
  const auth = mintBoundResolver(
    vault,
    config.apiKey,
    `DataSource(${dataSourceId})`,
  );
  return makeNotionConnector(auth);
}

// ============================================================================
// Notion data-plane routes — server-side connector calls via bound resolver.
// notionConnectorFor is the only place connectors are constructed.
// ============================================================================

/**
 * Database list entry the Notion renderer controls expect: `{ id, title }`.
 * The connector's `connect()` returns the engine `RemoteDatabase` shape
 * (`{ id, name }`); this route maps `name → title` so `DataSourceControls`
 * renders and adds databases by `title` without a DTO mismatch.
 */
type NotionDatabase = { id: string; title: string };

/**
 * listNotionDatabases — connect to Notion and list accessible databases.
 *
 * Resolves the credential via the vault; the handler has no plaintext in scope.
 * Accepts the DataSource id — the ref is read from the row, never from the client.
 */
const listNotionDatabases = wy.procedure
  .input({ dataSourceId: uuid })
  .mutation(async (ctx, { dataSourceId }): Promise<NotionDatabase[]> => {
    const connector = await notionConnectorFor(ctx, dataSourceId);
    const databases = await connector.connect();
    return databases.map((db) => ({ id: db.id, title: db.name }));
  });

/**
 * Serializable Notion inspection/import result. Inspection returns schema
 * only; a reviewed import or refresh also returns the current DataFrame ID.
 * Row bytes never cross the client boundary.
 */
type NotionQueryResult = {
  dataFrameId?: UUID;
  fieldIds: string[];
  fields: Field[];
  rowCount: number;
};

async function persistConnectorFrame(
  ctx: DashframeFunctionContext,
  args: {
    arrowBuffer: string;
    dataSourceId: UUID;
    tableId: UUID;
    fieldIds: string[];
    approvedFields: Field[];
    rowCount: number;
  },
): Promise<UUID> {
  assertCanonicalFrameSideEffects(ctx);
  const storage = ctx.dataFrameStorage;
  if (!storage) {
    throw new Error("Server DataFrame storage is not configured");
  }
  const arrow = new Uint8Array(Buffer.from(args.arrowBuffer, "base64"));
  let ipc: ReturnType<typeof inspectArrowIpc>;
  try {
    ipc = inspectArrowIpc(arrow);
  } catch {
    throw new Error("Connector returned malformed Arrow IPC");
  }
  const expectedNames = args.approvedFields.map(
    (field) => field.columnName ?? field.name,
  );
  if (
    ipc.rowCount !== args.rowCount ||
    ipc.fieldNames.length !== expectedNames.length ||
    ipc.fieldNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error("Connector Arrow schema does not match reviewed fields");
  }
  const dataFrameId = randomUUID() as UUID;
  await storage.save(dataFrameId, arrow);
  let stagedPrevious: StagedServerFrame[] = [];
  try {
    await ctx.db.transaction(async (tx) => {
      // Ownership validation and replacement discovery belong inside the same
      // serialized DB transaction as the link update. Otherwise a concurrent
      // DeleteNode or refresh can invalidate an earlier read and leave an
      // unowned or duplicate snapshot behind.
      const table = (await tx
        .from(dataTables)
        .where(eq("id", args.tableId))
        .first()) as DataTableRow | undefined;
      if (!table) throw new Error(`DataTable ${args.tableId} not found`);
      if (table.dataSourceId !== args.dataSourceId) {
        throw new Error(
          `DataTable ${args.tableId} does not belong to DataSource ${args.dataSourceId}`,
        );
      }
      const previousCandidates = await framesByIds(
        { ...ctx, db: tx },
        table.dataFrameId ? [table.dataFrameId] : [],
      );
      const previous = await framesUnreferencedOutsideTables(
        { ...ctx, db: tx },
        previousCandidates,
        new Set([args.tableId]),
      );
      stagedPrevious = await stageServerFrames(ctx, previous);
      await tx.into(dataFrames).insert({
        id: dataFrameId,
        storage: { type: "file", key: dataFrameId },
        fieldIds: args.fieldIds,
        name: table.name,
        sourceId: args.dataSourceId,
        definitionId: args.tableId,
        rowCount: args.rowCount,
        columnCount: args.fieldIds.length,
        lastRefreshedAt: new Date(),
      });
      await tx.from(dataTables).where(eq("id", args.tableId)).update({
        fields: args.approvedFields,
        dataFrameId,
        lastFetchedAt: new Date(),
      });
      for (const oldFrame of previous) {
        await tx.from(dataFrames).where(eq("id", oldFrame.id)).delete();
      }
    });
  } catch (error) {
    await rollbackStagedServerFrames(ctx, stagedPrevious);
    await storage.delete(dataFrameId).catch(() => undefined);
    throw error;
  }
  await commitStagedServerFrames(ctx, stagedPrevious);
  return dataFrameId;
}

async function connectorTableBinding(
  ctx: DashframeFunctionContext,
  dataSourceId: UUID,
  tableId: UUID,
): Promise<DataTableRow> {
  const table = (await ctx.db
    .from(dataTables)
    .where(eq("id", tableId))
    .first()) as DataTableRow | undefined;
  if (!table) throw new Error(`DataTable ${tableId} not found`);
  if (table.dataSourceId !== dataSourceId) {
    throw new Error(
      `DataTable ${tableId} does not belong to DataSource ${dataSourceId}`,
    );
  }
  return table;
}

async function requireConnectorMaterializationPermission(
  ctx: DashframeFunctionContext,
  snapshot: boolean | undefined,
): Promise<void> {
  if (snapshot && !(await ctx.can(permissions.commands.commit))) {
    throw new PermissionDeniedError(permissions.commands.commit.id);
  }
}

const CONNECTOR_INSPECTION_ROW_LIMIT = 100;

function connectorQueryOptions(
  limit: number | undefined,
  snapshot: boolean | undefined,
): { pagination: { offset: number; limit: number } } | undefined {
  const requestedLimit =
    limit !== undefined && Number.isInteger(limit) && limit > 0
      ? limit
      : undefined;
  const effectiveLimit = snapshot
    ? requestedLimit
    : (requestedLimit ?? CONNECTOR_INSPECTION_ROW_LIMIT);
  return effectiveLimit === undefined
    ? undefined
    : { pagination: { offset: 0, limit: effectiveLimit } };
}

function approvedFieldsForSnapshot(
  value: unknown,
  fieldIds: readonly string[],
  resultFields: readonly Field[],
): Field[] {
  if (
    resultFields.some((field) => getFieldSensitivity(field) === "sensitive")
  ) {
    throw new Error("Sensitive remote columns cannot be imported");
  }
  if (!Array.isArray(value)) {
    throw new Error("Reviewed fields are required before import");
  }
  const byColumn = new Map<string, Field>();
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.id !== "string") {
      throw new Error("Reviewed fields are invalid");
    }
    const field = candidate as unknown as Field;
    if (getFieldSensitivity(field) !== "cleared") {
      throw new Error("Every remote column must be reviewed before import");
    }
    const column = field.columnName ?? field.name;
    if (typeof column !== "string" || !column) {
      throw new Error("Reviewed fields are invalid");
    }
    byColumn.set(column, field);
  }
  if (
    resultFields.length !== fieldIds.length ||
    resultFields.some((field, index) => field.id !== fieldIds[index]) ||
    byColumn.size !== resultFields.length ||
    resultFields.some((field) => !byColumn.has(field.columnName ?? field.name))
  ) {
    throw new Error("Reviewed fields do not match the remote result");
  }
  return resultFields.map((field) => {
    const approved = byColumn.get(field.columnName ?? field.name)!;
    return {
      ...field,
      sensitivity: approved.sensitivity,
      sensitivityReason: approved.sensitivityReason,
    };
  });
}

type StagedServerFrame = { token: string };

function assertCanonicalFrameSideEffects(ctx: DashframeFunctionContext): void {
  if (!isCanonicalContext(ctx)) {
    throw new Error(
      "Server frame side effects require a canonical commit context",
    );
  }
}

function isCanonicalContext(ctx: DashframeFunctionContext): boolean {
  return modeFromCtx(ctx) !== "preview" && !inDraftContext(ctx);
}

function atomicStorage(ctx: DashframeFunctionContext) {
  const storage = ctx.dataFrameStorage;
  if (
    !storage?.stageDelete ||
    !storage.commitDelete ||
    !storage.rollbackDelete
  ) {
    throw new Error("Server DataFrame storage lacks atomic delete support");
  }
  return storage as Required<
    Pick<typeof storage, "stageDelete" | "commitDelete" | "rollbackDelete">
  > &
    typeof storage;
}

async function stageServerFrames(
  ctx: DashframeFunctionContext,
  rows: DataFrameRow[],
): Promise<StagedServerFrame[]> {
  if (
    rows.some(
      (row) => (row.storage as DataFrameStorageLocation).type !== "file",
    )
  ) {
    throw new Error("Only server-owned DataFrames can be removed");
  }
  const fileRows = rows.filter(
    (row) => (row.storage as DataFrameStorageLocation).type === "file",
  );
  if (fileRows.length === 0) return [];
  // This handler owns staging + retained-snapshot finalization. Suppress the
  // generic post-handler reconciliation so it does not flush retention and
  // attempt the same cleanup a second time.
  ctx.markServerFrameCleanupHandled?.();
  const storage = atomicStorage(ctx);
  const staged: StagedServerFrame[] = [];
  try {
    for (const row of fileRows) {
      const location = row.storage as Extract<
        DataFrameStorageLocation,
        { type: "file" }
      >;
      const token = await storage.stageDelete(location.key as UUID);
      if (token) staged.push({ token });
    }
    return staged;
  } catch (error) {
    await rollbackStagedServerFrames(ctx, staged);
    throw error;
  }
}

async function commitStagedServerFrames(
  ctx: DashframeFunctionContext,
  staged: StagedServerFrame[],
): Promise<void> {
  if (staged.length === 0) return;
  if (ctx.flushSnapshotRetentionWindow == null) {
    console.error(
      "[dashframe] no retained-snapshot flush hook; leaving staged server frame deletes for startup recovery",
    );
    return;
  }
  try {
    // The metadata deletion must reach the durable project snapshot before the
    // staged bytes are destroyed. Recovery can otherwise restore an older
    // snapshot that still references a frame whose bytes no longer exist.
    await ctx.flushSnapshotRetentionWindow();
  } catch (error) {
    console.error(
      "[dashframe] snapshot flush failed; leaving staged server frame deletes for startup recovery",
      error,
    );
    return;
  }
  const storage = atomicStorage(ctx);
  const results = await Promise.allSettled(
    staged.map(({ token }) => storage.commitDelete(token)),
  );
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  const removedIds = staged.flatMap(({ token }, index) =>
    results[index]?.status === "fulfilled" ? [token.split(".")[0]!] : [],
  );
  if (removedIds.length > 0) {
    try {
      await ctx.unregisterServerFrames?.(removedIds);
    } catch (error) {
      // Metadata and file deletion are durable at this point. Runtime-native
      // cleanup must not turn that committed mutation into a reported failure.
      console.error(
        "[dashframe] native unregister failed after durable frame deletion; runtime cleanup will retry when configured",
        error,
      );
    }
  }
  if (failures.length > 0) {
    console.error(
      `[dashframe] ${failures.length} staged server frame delete(s) could not be finalized; startup recovery will retry`,
      failures.map(({ reason }) => reason),
    );
  }
}

function assertServerFrameOwnership(
  _id: string,
  storage: DataFrameStorageLocation,
): void {
  if (storage.type === "file") {
    throw new Error("Server frame storage is server-owned");
  }
  if (storage.type === "indexeddb") {
    throw new Error("Legacy browser DataFrames are not supported");
  }
}

function sanitizePublicAnalysis(
  analysis: DataFrameAnalysis | null | undefined,
): Record<string, unknown> | null {
  if (!analysis) return null;
  const safe = stripSampleValues(analysis) as unknown as Record<
    string,
    unknown
  >;
  const callerOwned = { ...safe };
  delete callerOwned.currentInsightResult;
  return callerOwned;
}

function assertPublicFrameUpdate(
  existing: DataFrameRow | undefined,
  patch: Partial<DataFrameEntry>,
): void {
  if (!existing) return;
  const storage = existing.storage as DataFrameStorageLocation;
  if (storage.type === "indexeddb") {
    throw new Error("Legacy browser DataFrames are not supported");
  }
  if (storage.type !== "file") return;
  const changesOwner =
    (patch.insightId !== undefined &&
      patch.insightId !== (existing.insightId ?? undefined)) ||
    (patch.sourceId !== undefined &&
      patch.sourceId !== (existing.sourceId ?? undefined)) ||
    (patch.definitionId !== undefined &&
      patch.definitionId !== (existing.definitionId ?? undefined));
  if (changesOwner) {
    throw new Error("Server frame ownership cannot be changed");
  }
}

function preserveCurrentInsightMarker(
  analysis: Record<string, unknown> | null,
  existing: unknown,
): Record<string, unknown> | null {
  const marker = (existing as { currentInsightResult?: unknown } | null)
    ?.currentInsightResult;
  if (marker !== true && marker !== false) return analysis;
  return { ...(analysis ?? {}), currentInsightResult: marker };
}

function assertExistingServerFrameImmutable(
  existing: DataFrameRow | undefined,
  _next: DataFrameStorageLocation,
): void {
  if (
    (existing?.storage as DataFrameStorageLocation | undefined)?.type === "file"
  ) {
    throw new Error(
      "Server frame storage cannot be changed through public RPC",
    );
  }
}

async function rollbackStagedServerFrames(
  ctx: DashframeFunctionContext,
  staged: StagedServerFrame[],
): Promise<void> {
  if (staged.length === 0) return;
  const storage = atomicStorage(ctx);
  for (const { token } of staged.toReversed()) {
    await storage.rollbackDelete(token);
  }
}

async function framesByIds(
  ctx: DashframeFunctionContext,
  ids: readonly string[],
): Promise<DataFrameRow[]> {
  const rows: DataFrameRow[] = [];
  for (const id of new Set(ids)) {
    const row = (await ctx.db.from(dataFrames).where(eq("id", id)).first()) as
      | DataFrameRow
      | undefined;
    if (row) rows.push(row);
  }
  return rows;
}

async function framesUnreferencedOutsideTables(
  ctx: DashframeFunctionContext,
  frames: DataFrameRow[],
  removedTableIds: ReadonlySet<string>,
): Promise<DataFrameRow[]> {
  const keep: DataFrameRow[] = [];
  for (const frame of frames) {
    const references = (await ctx.db
      .from(dataTables)
      .where(eq("dataFrameId", frame.id))
      .all()) as DataTableRow[];
    if (references.every((table) => removedTableIds.has(table.id))) {
      keep.push(frame);
    }
  }
  return keep;
}

/**
 * queryNotionDatabase — fetch rows from a specific Notion database server-side
 * and return schema for review or persist a reviewed server snapshot.
 *
 * The credential resolves via the bound resolver inside `connector.query`; the
 * handler has no plaintext in scope and the client receives only data.
 */
const queryNotionDatabase = wy.procedure
  .input({
    dataSourceId: uuid,
    databaseId: text,
    tableId: uuid,
    // Optional cap on rows fetched for preview. Inspection defaults to a small
    // server-side bound; an approved snapshot remains unbounded when omitted.
    limit: int.optional(),
    snapshot: boolean.optional(),
    approvedFields: jsonb.optional(),
  })
  .mutation(
    async (
      ctx,
      { dataSourceId, databaseId, tableId, limit, snapshot, approvedFields },
    ): Promise<NotionQueryResult> => {
      const connector = await notionConnectorFor(ctx, dataSourceId);
      const table = await connectorTableBinding(ctx, dataSourceId, tableId);
      if (databaseId !== table.table) {
        throw new Error(
          `DataTable ${tableId} is bound to remote resource ${table.table}`,
        );
      }
      await requireConnectorMaterializationPermission(ctx, snapshot);
      const pagination = connectorQueryOptions(limit, snapshot);
      // query() resolves the apiKey via the bound resolver internally and returns
      // a serializable result — no credential in scope here, no DataFrame built.
      const result = await connector.query(table.table, tableId, pagination);
      const dataFrameId = snapshot
        ? await persistConnectorFrame(ctx, {
            arrowBuffer: result.arrowBuffer,
            dataSourceId,
            tableId,
            fieldIds: result.fieldIds,
            approvedFields: approvedFieldsForSnapshot(
              approvedFields,
              result.fieldIds,
              result.fields,
            ),
            rowCount: result.rowCount,
          })
        : undefined;
      return {
        ...(dataFrameId ? { dataFrameId } : {}),
        fieldIds: result.fieldIds,
        fields: result.fields,
        rowCount: result.rowCount,
      };
    },
  );

// ============================================================================
// Postgres connector factory — mirrors notionConnectorFor.
// postgresConnectorFor is the single seam where a postgres connector is
// created from a DataSource id. Both postgres data-plane routes go through it.
// ============================================================================

/**
 * Build a Postgres connector for a DataSource: read the row, verify it's a
 * postgres source, mint a bound resolver from the stored connectionString ref,
 * and construct the connector.
 *
 * @throws when the row is missing, not a postgres source, or has no valid ref
 */
export async function postgresConnectorFor(
  ctx: DashframeFunctionContext,
  dataSourceId: UUID,
): Promise<ReturnType<typeof makePostgresConnector>> {
  const vault = vaultFromCtx(ctx);
  const row = (await ctx.db
    .from(dataSources)
    .where(eq("id", dataSourceId))
    .first()) as DataSourceRow | undefined;
  if (!row) throw new Error(`DataSource ${dataSourceId} not found`);
  if (row.kind !== "postgres") {
    throw new Error(`DataSource ${dataSourceId} is not a postgres source`);
  }
  const config = (row.config ?? {}) as DataSourceConfig;
  // connectionString holds the SecretRef (same vault slot as Notion's apiKey).
  const auth = mintBoundResolver(
    vault,
    config.connectionString,
    `DataSource(${dataSourceId})`,
  );
  // connectionStringRef is for introspection only; the bound `auth` resolver
  // is the actual credential source. Pass the ref as-is — never coerce to "".
  //
  // Sink guard: defaultSchema flows into quoteIdentifier() in connect(); verify
  // it's a string before passing it through (config is an untyped JSON blob).
  const defaultSchema =
    typeof config.defaultSchema === "string" ? config.defaultSchema : undefined;
  return makePostgresConnector(auth, {
    connectionStringRef: config.connectionString,
    defaultSchema,
  });
}

// ============================================================================
// Postgres data-plane routes — server-side connector calls via bound resolver.
// postgresConnectorFor is the only place postgres connectors are constructed.
// ============================================================================

/**
 * Serializable Postgres inspection/import result. The DataFrame ID exists only
 * after reviewed fields pass the server privacy gate and a snapshot is saved.
 */
type PostgresQueryResult = {
  dataFrameId?: UUID;
  fieldIds: string[];
  fields: Field[];
  rowCount: number;
};

/**
 * listPostgresTables — connect to Postgres and list tables/views in the
 * configured schema.
 *
 * Resolves the credential via the vault; the handler has no plaintext in scope.
 * Accepts the DataSource id — the ref is read from the row, never from the client.
 */
const listPostgresTables = wy.procedure
  .input({ dataSourceId: uuid })
  .mutation(
    async (ctx, { dataSourceId }): Promise<{ id: string; title: string }[]> => {
      const connector = await postgresConnectorFor(ctx, dataSourceId);
      const tables = await connector.connect();
      return tables.map((t) => ({ id: t.id, title: t.name }));
    },
  );

/**
 * queryPostgresTable — fetch rows from a Postgres table or run a SELECT
 * server-side and return schema for review or persist a reviewed snapshot.
 *
 * The credential resolves via the bound resolver inside `connector.query`; the
 * handler has no plaintext in scope and the client receives only data.
 * The connector enforces read-only at both layers (allowlist + SET SESSION).
 */
const queryPostgresTable = wy.procedure
  .input({
    dataSourceId: uuid,
    /** "schema.table" ref from listPostgresTables, or a user SELECT statement */
    databaseId: text,
    tableId: uuid,
    /** Optional cap on rows fetched for the preview. */
    limit: int.optional(),
    snapshot: boolean.optional(),
    approvedFields: jsonb.optional(),
  })
  .mutation(
    async (
      ctx,
      { dataSourceId, databaseId, tableId, limit, snapshot, approvedFields },
    ): Promise<PostgresQueryResult> => {
      const connector = await postgresConnectorFor(ctx, dataSourceId);
      const table = await connectorTableBinding(ctx, dataSourceId, tableId);
      if (databaseId !== table.table) {
        throw new Error(
          `DataTable ${tableId} is bound to remote resource ${table.table}`,
        );
      }
      await requireConnectorMaterializationPermission(ctx, snapshot);
      const pagination = connectorQueryOptions(limit, snapshot);
      const result = await connector.query(table.table, tableId, pagination);
      const dataFrameId = snapshot
        ? await persistConnectorFrame(ctx, {
            arrowBuffer: result.arrowBuffer,
            dataSourceId,
            tableId,
            fieldIds: result.fieldIds,
            approvedFields: approvedFieldsForSnapshot(
              approvedFields,
              result.fieldIds,
              result.fields,
            ),
            rowCount: result.rowCount,
          })
        : undefined;
      return {
        ...(dataFrameId ? { dataFrameId } : {}),
        fieldIds: result.fieldIds,
        fields: result.fields,
        rowCount: result.rowCount,
      };
    },
  );

// ============================================================================
// GA4 connector factory + data plane — mirrors postgresConnectorFor.
// ============================================================================

export async function ga4ConnectorFor(
  ctx: DashframeFunctionContext,
  dataSourceId: UUID,
  reportVersion?: Ga4ReportVersion,
): Promise<ReturnType<typeof makeGa4Connector>> {
  const vault = vaultFromCtx(ctx);
  const row = (await ctx.db
    .from(dataSources)
    .where(eq("id", dataSourceId))
    .first()) as DataSourceRow | undefined;
  if (!row) throw new Error(`DataSource ${dataSourceId} not found`);
  if (row.kind !== "googleAnalytics") {
    throw new Error(
      `DataSource ${dataSourceId} is not a Google Analytics source`,
    );
  }
  const config = (row.config ?? {}) as DataSourceConfig;
  const persistedReportVersion =
    config.sourceBindingVersion === "v2" ? "v2" : "v1";
  const auth = mintBoundResolver(
    vault,
    config.apiKey,
    `DataSource(${dataSourceId})`,
  );
  // Client credentials come from server config on every call rather than from
  // the stored bundle, so rotating the OAuth client is a config change instead
  // of a re-write of every connected source's vault entry.
  const oauthClient = ctx.googleOAuth;
  return makeGa4Connector(auth, {
    reportVersion: reportVersion ?? persistedReportVersion,
    ...(oauthClient
      ? {
          oauthClient: {
            clientId: oauthClient.clientId,
            clientSecret: oauthClient.clientSecret,
          },
        }
      : {}),
    persistTokenBundle: (bundle) =>
      persistGa4TokenBundle(ctx, dataSourceId, vault, bundle),
  });
}

/**
 * Write a renewed GA4 token bundle back to the source's vault entry.
 *
 * Without this the connector holds a fresh access token only for the life of
 * one request: the next call past the stored expiry refreshes again, spending a
 * Google grant per request instead of per hour.
 *
 * The vault has no in-place rotate — `store` mints a new ref — so this follows
 * the same ordering every other credential rotation here uses:
 * store-new → canonical-write → flush-snapshot → release-old. Releasing the old
 * ref before the new config is durable would leave a snapshot pointing at a
 * credential that no longer exists.
 *
 * Callers reach this through `persistGa4TokenBundle`, which serializes it per
 * source. It must not be called directly: `superseded` is computed from the
 * read a few lines below, so two interleaved runs would each supersede only
 * what their own read saw and one of the minted refs would be stored and then
 * never referenced or released.
 */
async function persistGa4TokenBundleLocked(
  ctx: DashframeFunctionContext,
  dataSourceId: UUID,
  vault: SecretVault | undefined,
  bundle: GoogleOAuthTokenBundle,
): Promise<void> {
  // A preview executes and rolls back, but a vault write is outside that
  // transaction and would survive the rollback pointing at a discarded config.
  if (modeFromCtx(ctx) === "preview") return;
  const current = (await ctx.db
    .from(dataSources)
    .where(eq("id", dataSourceId))
    .first()) as DataSourceRow | undefined;
  if (!current) return;
  const config = { ...((current.config ?? {}) as DataSourceConfig) };
  const superseded: SecretRef[] = [];
  await applyCredentialField(
    config,
    "apiKey",
    JSON.stringify(bundle),
    vault,
    `apiKey-${dataSourceId}`,
    false,
    false,
    superseded,
  );
  await ctx.db
    .from(dataSources)
    .where(eq("id", dataSourceId))
    .update({ config });
  await flushThenReleaseRefs(
    ctx.flushSnapshot,
    superseded,
    vault,
    `ga4-refresh-${dataSourceId}`,
  );
}

/**
 * In-flight token write per data source, so the read-modify-write above runs
 * one at a time.
 *
 * Keyed by source rather than global: refreshes for different sources share
 * nothing, and a global lock would let one slow vault write stall every other
 * source's queries.
 */
const ga4TokenWrites = new Map<UUID, Promise<void>>();

/**
 * Write a renewed GA4 token bundle back, serialized against other writes for
 * the same source.
 *
 * Serializing makes the second writer re-read after the first has landed, so
 * its `superseded` list contains the first writer's ref and
 * `flushThenReleaseRefs` actually releases it. Without that, two simultaneous
 * refreshes each mint a ref, the last config write wins, and the loser's blob
 * stays in the vault forever with nothing pointing at it.
 *
 * This narrows the race to the write, not the refresh: two callers can still
 * both hit Google, and if Google rotated the refresh token the second caller's
 * bundle carries the pre-rotation one, so the surviving config can hold a dead
 * refresh token. Tolerable, because Google's web-server flow does not rotate
 * refresh tokens per call, and a bundle that does go stale costs one failed
 * refresh before the next call re-reads and recovers. Coalescing the refresh
 * itself has to happen above the connector boundary and is a separate change.
 */
async function persistGa4TokenBundle(
  ctx: DashframeFunctionContext,
  dataSourceId: UUID,
  vault: SecretVault | undefined,
  bundle: GoogleOAuthTokenBundle,
): Promise<void> {
  const previous = ga4TokenWrites.get(dataSourceId) ?? Promise.resolve();
  // Chained on a tail that settles either way. A persist failure is non-fatal
  // to the request that hit it (see `accessTokenFor`), so it must not reject
  // every write queued behind it — that would turn one storage hiccup into a
  // permanently broken refresh path for the source.
  const settle = () =>
    persistGa4TokenBundleLocked(ctx, dataSourceId, vault, bundle);
  const result = previous.then(settle, settle);
  // Drop the entry once this is the last write outstanding, or the map grows a
  // permanent entry per source connected in the process's lifetime. Folded
  // into the stored tail rather than chained separately so the cleanup runs
  // before anything queued behind this write reads the map.
  // Only clears its own entry: a writer that queued behind this one has
  // already replaced the map value, and deleting that would let a third writer
  // start from an empty chain and race the one still running.
  const forget = () => {
    if (ga4TokenWrites.get(dataSourceId) === tail) {
      ga4TokenWrites.delete(dataSourceId);
    }
  };
  const tail: Promise<void> = result.then(forget, forget);
  ga4TokenWrites.set(dataSourceId, tail);
  return result;
}

const listGa4Properties = wy.procedure
  .input({ dataSourceId: uuid })
  .mutation(
    async (ctx, { dataSourceId }): Promise<{ id: string; title: string }[]> => {
      const connector = await ga4ConnectorFor(ctx, dataSourceId);
      const properties = await connector.connect();
      return properties.map((property) => ({
        id: property.id,
        title: property.name,
      }));
    },
  );

/**
 * Serializable GA4 inspection/import result. Structurally identical
 * to Postgres today, but deliberately kept per-connector here.
 */
type Ga4QueryResult = {
  dataFrameId?: UUID;
  fieldIds: string[];
  fields: Field[];
  rowCount: number;
};

/**
 * Read a GA4 property into a DataTable.
 *
 * Named for what it queries: a GA4 "table" is a property, not a saved report,
 * and the old name promised a report selection that never existed.
 *
 * The property comes from the DataTable row rather than from a caller-supplied
 * argument. The row records which property the table was created from, so
 * taking a separate property id let the two disagree and wrote one property's
 * data into another property's table.
 */
const queryGa4Property = wy.procedure
  .input({
    dataSourceId: uuid,
    tableId: uuid,
    limit: int.optional(),
    snapshot: boolean.optional(),
    approvedFields: jsonb.optional(),
  })
  .mutation(
    async (
      ctx,
      { dataSourceId, tableId, limit, snapshot, approvedFields },
    ): Promise<Ga4QueryResult> => {
      const connector = await ga4ConnectorFor(ctx, dataSourceId);
      const table = await connectorTableBinding(ctx, dataSourceId, tableId);
      await requireConnectorMaterializationPermission(ctx, snapshot);
      const pagination = connectorQueryOptions(limit, snapshot);
      const result = await connector.query(table.table, tableId, pagination);
      const dataFrameId = snapshot
        ? await persistConnectorFrame(ctx, {
            arrowBuffer: result.arrowBuffer,
            dataSourceId,
            tableId,
            fieldIds: result.fieldIds,
            approvedFields: approvedFieldsForSnapshot(
              approvedFields,
              result.fieldIds,
              result.fields,
            ),
            rowCount: result.rowCount,
          })
        : undefined;
      return {
        ...(dataFrameId ? { dataFrameId } : {}),
        fieldIds: result.fieldIds,
        fields: result.fields,
        rowCount: result.rowCount,
      };
    },
  );

function structuralFieldSignature(fields: readonly Field[]): string {
  return JSON.stringify(
    fields.map((field) => ({
      name: field.name,
      columnName: field.columnName,
      type: field.type,
    })),
  );
}

/**
 * Discover and persist the structural schema for a newly-bound remote table.
 * The connector, not the renderer, authors the Field objects. Repeated calls
 * verify the stored schema and fail closed on drift rather than blessing it.
 */
const prepareRemoteDataTable = wy.procedure
  .input({ id: uuid })
  .authorize(permissions.commands.commit)
  .mutation(async (ctx, { id }): Promise<{ fields: Field[] }> => {
    const table = (await ctx.db
      .from(dataTables)
      .where(eq("id", id))
      .first()) as DataTableRow | undefined;
    if (!table) throw new Error(`DataTable ${id} not found`);
    const source = (await ctx.db
      .from(dataSources)
      .where(eq("id", table.dataSourceId))
      .first()) as DataSourceRow | undefined;
    if (!source) throw new Error(`DataSource ${table.dataSourceId} not found`);

    const pagination = { pagination: { offset: 0, limit: 1 } };
    let result = null;
    if (source.kind === "notion") {
      result = await (
        await notionConnectorFor(ctx, source.id)
      ).query(table.table, table.id, pagination);
    } else if (source.kind === "postgres") {
      result = await (
        await postgresConnectorFor(ctx, source.id)
      ).query(table.table, table.id, pagination);
    } else if (source.kind === "googleAnalytics") {
      result = await (
        await ga4ConnectorFor(ctx, source.id)
      ).query(table.table, table.id, pagination);
    }
    if (!result) {
      throw new Error(`DataSource ${source.id} is not a remote connector`);
    }

    let preparedFields = result.fields;
    await ctx.db.transaction(async (tx) => {
      const current = (await tx
        .from(dataTables)
        .where(eq("id", id))
        .first()) as DataTableRow | undefined;
      if (!current) throw new Error(`DataTable ${id} not found`);
      if (
        current.dataSourceId !== table.dataSourceId ||
        current.table !== table.table
      ) {
        throw new Error("Remote table binding changed during schema discovery");
      }
      const currentFields = (current.fields ?? []) as Field[];
      if (
        currentFields.length > 0 &&
        structuralFieldSignature(currentFields) !==
          structuralFieldSignature(result.fields)
      ) {
        throw new Error("SOURCE_SCHEMA_CHANGED");
      }
      if (currentFields.length === 0) {
        await tx
          .from(dataTables)
          .where(eq("id", id))
          .update({ fields: result.fields });
      } else {
        // Connector discovery creates fresh Field ids on every call. Once a
        // structural schema is prepared, its persisted ids are canonical and
        // must be returned unchanged to every consumer.
        preparedFields = currentFields;
      }
    });
    return { fields: preparedFields };
  });

export const appArtifactFunctions = {
  listDataSources,
  getDataSource,
  getDataSourceByType,
  listDataTables,
  getDataTable,
  listDataFrames,
  getDataFrameEntry,
  getDataFrameByInsight,
  putDataFrameEntry,
  updateDataFrameEntry,
  removeDataFrameEntry,
  listInsights,
  getInsight,
  listVisualizations,
  getVisualization,
  clearAllData,
  // Notion data-plane routes (auth-blind via bound resolver)
  listNotionDatabases,
  queryNotionDatabase,
  // Postgres data-plane routes (auth-blind via bound resolver)
  listPostgresTables,
  queryPostgresTable,
  // Google Analytics data-plane routes (auth-blind via bound resolver)
  listGa4Properties,
  queryGa4Property,
  prepareRemoteDataTable,
};
