import {
  makeGa4Connector,
  type Ga4ReportVersion,
  type GoogleOAuthTokenBundle,
} from "@dashframe/connector-ga4";
import { makeNotionConnector } from "@dashframe/connector-notion";
import { makePostgresConnector } from "@dashframe/connector-postgres";
import type { SecretResolver as BoundSecretResolver } from "@dashframe/engine";
import { inspectArrowIpc } from "@dashframe/engine-server/arrow-data-path";
import { CREDENTIAL_CLASS } from "@dashframe/server-core";
import type {
  DataSourceRow,
  DataTableRow,
} from "@dashframe/convex-backend/model";
import type { Field, UUID } from "@dashframe/types";
import { getFieldSensitivity } from "@dashframe/types";
import {
  isSecretRef,
  type SecretRef,
  type SecretVault,
} from "@wystack/secret-vault";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser, type HostContext } from "./context";
import { hostOperation } from "./operation";
import { publishWithConfirmation } from "./data-fetch/publisher";
import { parseStoredDataTableState } from "@dashframe/convex-backend/codecs";

type DataSourceConfig = {
  apiKey?: string;
  connectionString?: string;
  defaultSchema?: string;
  sourceBindingVersion?: string;
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const reviewedFieldsInputSchema = z.array(
  z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      tableId: z.string().uuid().optional(),
      columnName: z.string().min(1).optional(),
      type: z.enum(["string", "number", "boolean", "date", "unknown"]),
      isIdentifier: z.boolean().optional(),
      isReference: z.boolean().optional(),
      sensitivity: z.enum(["unclassified", "sensitive", "cleared"]).optional(),
      sensitivityReason: z.string().optional(),
      sensitivitySource: z.enum(["user", "classifier"]).optional(),
    })
    .strict(),
);

function parseReviewedFieldsInput(value: unknown): unknown {
  return value === undefined
    ? undefined
    : reviewedFieldsInputSchema.parse(value);
}

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
        `set the API key`,
    );
  }
  const secretRef = ref as SecretRef;
  // Pre-bind vault.withSecret to this one ref. The connector calls
  // `this.auth(use => ...)` and never sees the vault or ref itself.
  return <T>(use: (plaintext: string) => Promise<T>) =>
    vault.withSecret(secretRef, use);
}

export async function notionConnectorFor(
  ctx: HostContext,
  dataSourceId: UUID,
): Promise<ReturnType<typeof makeNotionConnector>> {
  const vault = ctx.vault;
  const row = (await ctx.metadata.getDataSource(dataSourceId)) as
    | DataSourceRow
    | undefined;
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

type NotionDatabase = { id: string; title: string };

export const listNotionDatabases = hostOperation({
  input: z.object({ dataSourceId: z.string().uuid() }).strict(),
  run: async (ctx, { dataSourceId }): Promise<NotionDatabase[]> => {
    const connector = await notionConnectorFor(ctx, dataSourceId);
    const databases = await connector.connect();
    return databases.map((db) => ({ id: db.id, title: db.name }));
  },
});

type NotionQueryResult = {
  dataFrameId?: UUID;
  fieldIds: string[];
  fields: Field[];
  rowCount: number;
};

async function connectorTableBinding(
  ctx: HostContext,
  dataSourceId: UUID,
  tableId: UUID,
): Promise<DataTableRow> {
  const table = (await ctx.metadata.getDataTable(tableId)) as
    | DataTableRow
    | undefined;
  if (!table) throw new Error(`DataTable ${tableId} not found`);
  if (table.dataSourceId !== dataSourceId) {
    throw new Error(
      `DataTable ${tableId} does not belong to DataSource ${dataSourceId}`,
    );
  }
  return table;
}

async function requireConnectorMaterializationPermission(
  ctx: HostContext,
  snapshot: boolean | undefined,
): Promise<void> {
  if (snapshot) requireUser(ctx);
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

export const queryNotionDatabase = hostOperation({
  input: z
    .object({
      dataSourceId: z.string().uuid(),
      databaseId: z.string(),
      tableId: z.string().uuid(),
      // Optional cap on rows fetched for preview. Inspection defaults to a small
      // server-side bound; an approved snapshot remains unbounded when omitted.
      limit: z.number().int().optional(),
      snapshot: z.boolean().optional(),
      approvedFields: z.unknown().optional(),
    })
    .strict(),
  run: async (
    ctx,
    { dataSourceId, databaseId, tableId, limit, snapshot, approvedFields },
  ): Promise<NotionQueryResult> => {
    const reviewedFields = parseReviewedFieldsInput(approvedFields);
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
            reviewedFields,
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
});

export async function postgresConnectorFor(
  ctx: HostContext,
  dataSourceId: UUID,
): Promise<ReturnType<typeof makePostgresConnector>> {
  const vault = ctx.vault;
  const row = (await ctx.metadata.getDataSource(dataSourceId)) as
    | DataSourceRow
    | undefined;
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

type PostgresQueryResult = {
  dataFrameId?: UUID;
  fieldIds: string[];
  fields: Field[];
  rowCount: number;
};

export const listPostgresTables = hostOperation({
  input: z.object({ dataSourceId: z.string().uuid() }).strict(),
  run: async (
    ctx,
    { dataSourceId },
  ): Promise<{ id: string; title: string }[]> => {
    const connector = await postgresConnectorFor(ctx, dataSourceId);
    const tables = await connector.connect();
    return tables.map((t) => ({ id: t.id, title: t.name }));
  },
});

export const queryPostgresTable = hostOperation({
  input: z
    .object({
      dataSourceId: z.string().uuid(),
      /** "schema.table" ref from listPostgresTables, or a user SELECT statement */
      databaseId: z.string(),
      tableId: z.string().uuid(),
      /** Optional cap on rows fetched for the preview. */
      limit: z.number().int().optional(),
      snapshot: z.boolean().optional(),
      approvedFields: z.unknown().optional(),
    })
    .strict(),
  run: async (
    ctx,
    { dataSourceId, databaseId, tableId, limit, snapshot, approvedFields },
  ): Promise<PostgresQueryResult> => {
    const reviewedFields = parseReviewedFieldsInput(approvedFields);
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
            reviewedFields,
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
});

export async function ga4ConnectorFor(
  ctx: HostContext,
  dataSourceId: UUID,
  reportVersion?: Ga4ReportVersion,
): Promise<ReturnType<typeof makeGa4Connector>> {
  const vault = ctx.vault;
  const row = (await ctx.metadata.getDataSource(dataSourceId)) as
    | DataSourceRow
    | undefined;
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

async function persistGa4TokenBundleLocked(
  ctx: HostContext,
  dataSourceId: UUID,
  vault: SecretVault | undefined,
  bundle: GoogleOAuthTokenBundle,
): Promise<void> {
  const current = await ctx.metadata.getDataSource(dataSourceId);
  if (!current || !vault) throw new Error("TARGET_NOT_READY");
  const config = { ...((current.config ?? {}) as DataSourceConfig) };
  const previous = config.apiKey;
  const next = await vault.store(JSON.stringify(bundle), {
    class: CREDENTIAL_CLASS.ConnectorKey,
    locatorHint: `apiKey-${dataSourceId}`,
  });
  config.apiKey = next;
  // An uncertain network outcome can already be committed. Leave the new
  // secret available until reconciliation can prove it is unreferenced.
  await ctx.metadata.replaceDataSourceConfig({
    id: dataSourceId,
    expectedConfig: current.config,
    config,
  });
  if (isSecretRef(previous) && previous !== next) {
    await vault.delete(previous);
  }
}

const ga4TokenWrites = new Map<UUID, Promise<void>>();

async function persistGa4TokenBundle(
  ctx: HostContext,
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

export const listGa4Properties = hostOperation({
  input: z.object({ dataSourceId: z.string().uuid() }).strict(),
  run: async (
    ctx,
    { dataSourceId },
  ): Promise<{ id: string; title: string }[]> => {
    const connector = await ga4ConnectorFor(ctx, dataSourceId);
    const properties = await connector.connect();
    return properties.map((property) => ({
      id: property.id,
      title: property.name,
    }));
  },
});

type Ga4QueryResult = {
  dataFrameId?: UUID;
  fieldIds: string[];
  fields: Field[];
  rowCount: number;
};

export const queryGa4Property = hostOperation({
  input: z
    .object({
      dataSourceId: z.string().uuid(),
      tableId: z.string().uuid(),
      limit: z.number().int().optional(),
      snapshot: z.boolean().optional(),
      approvedFields: z.unknown().optional(),
    })
    .strict(),
  run: async (
    ctx,
    { dataSourceId, tableId, limit, snapshot, approvedFields },
  ): Promise<Ga4QueryResult> => {
    const reviewedFields = parseReviewedFieldsInput(approvedFields);
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
            reviewedFields,
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
});

function withCanonicalFieldOwnership(
  fields: readonly Field[],
  tableId: UUID,
): Field[] {
  return fields.map((field) => ({ ...field, tableId }));
}

export const prepareRemoteDataTable = hostOperation({
  input: z.object({ id: z.string().uuid() }).strict(),
  userOnly: true,
  run: async (ctx, { id }): Promise<{ fields: Field[] }> => {
    const table = (await ctx.metadata.getDataTable(id)) as
      | DataTableRow
      | undefined;
    if (!table) throw new Error(`DataTable ${id} not found`);
    const source = (await ctx.metadata.getDataSource(table.dataSourceId)) as
      | DataSourceRow
      | undefined;
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

    const discoveredFields = withCanonicalFieldOwnership(result.fields, id);
    parseStoredDataTableState(
      { sourceSchema: null, fields: discoveredFields, metrics: [] },
      `Data table ${id} discovered fields`,
    );
    const preparedFields = await ctx.metadata.prepareRemoteDataTable({
      id,
      dataSourceId: table.dataSourceId,
      table: table.table,
      fields: discoveredFields,
    });
    return { fields: preparedFields };
  },
});
async function persistConnectorFrame(
  ctx: HostContext,
  args: {
    arrowBuffer: string;
    dataSourceId: UUID;
    tableId: UUID;
    fieldIds: string[];
    approvedFields: Field[];
    rowCount: number;
  },
): Promise<UUID> {
  requireUser(ctx);
  const storage = ctx.dataFrameStorage;
  if (!storage) throw new Error("TARGET_NOT_READY");
  const arrow = new Uint8Array(Buffer.from(args.arrowBuffer, "base64"));
  const inspected = inspectArrowIpc(arrow);
  const fields = withCanonicalFieldOwnership(args.approvedFields, args.tableId);
  parseStoredDataTableState(
    { sourceSchema: null, fields, metrics: [] },
    "Connector fields",
  );
  const names = fields.map((field) => field.columnName ?? field.name);
  if (
    inspected.rowCount !== args.rowCount ||
    inspected.fieldNames.length !== names.length ||
    inspected.fieldNames.some((name, index) => name !== names[index])
  ) {
    throw new Error("Connector Arrow schema does not match reviewed fields");
  }
  const table = await connectorTableBinding(
    ctx,
    args.dataSourceId,
    args.tableId,
  );
  const id = randomUUID() as UUID;
  const now = Date.now();
  await storage.save(id, arrow);
  // Immutable files remain available after a lost commit acknowledgement.
  // An unconfirmed operation may leave an orphan; a missing operation record
  // cannot justify deletion while the publication could still be in flight.
  const publication = {
    dataTableId: table.id,
    dataSourceId: args.dataSourceId,
    expectedDataFrameId: table.dataFrameId ?? null,
    frameRow: {
      id,
      storage: { type: "file", key: id },
      fieldIds: args.fieldIds,
      name: table.name,
      sourceId: args.dataSourceId,
      definitionId: args.tableId,
      rowCount: args.rowCount,
      columnCount: fields.length,
      lastRefreshedAt: now,
      analysis: {
        schema: fields.map((field) => ({
          id: field.id,
          name: field.columnName ?? field.name,
          type: field.type,
        })),
      },
    },
    tableUpdate: { fields, dataFrameId: id, lastFetchedAt: now },
  } satisfies Parameters<HostContext["metadata"]["commitImportedFrame"]>[0];
  await publishWithConfirmation(ctx.metadata, `import:${id}`, publication, () =>
    ctx.metadata.commitImportedFrame(publication),
  );
  return id;
}
