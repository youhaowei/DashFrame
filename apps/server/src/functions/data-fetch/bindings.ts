/** Server-only Source Binding resolution for live data fetches. */
import { schema } from "@dashframe/server-core";
import type { Field, UUID } from "@dashframe/types";
import { eq } from "@wystack/db";
import { Table, tableFromIPC, tableToIPC } from "apache-arrow";

import type { DashframeFunctionContext } from "../../app-context";
import {
  ga4ConnectorFor,
  notionConnectorFor,
  postgresConnectorFor,
} from "../app-artifacts";

const SOURCE_BINDING_VERSION = "v1";
/** GA4 supports offset windows; other adapters own their provider pagination. */
const GA4_PAGE_SIZE = 10_000;

type SourceRow = typeof schema.dataSources.$inferSelect;
type TableRow = typeof schema.dataTables.$inferSelect;
type FrameRow = typeof schema.dataFrames.$inferSelect;

export type SourceBinding = Readonly<{
  connectorKind: string;
  sourceBindingVersion: typeof SOURCE_BINDING_VERSION;
  dataSourceId: UUID;
  table: Pick<
    TableRow,
    "id" | "table" | "fields" | "dataSourceId" | "dataFrameId"
  >;
}>;

export type LiveSourceResult = {
  arrowBuffer: string;
  fieldIds: string[];
  fields: Field[];
  rowCount: number;
  provenance: Pick<SourceBinding, "connectorKind" | "sourceBindingVersion">;
};

type BindingAdapter = (
  ctx: DashframeFunctionContext,
  binding: SourceBinding,
) => Promise<LiveSourceResult>;

/** Exact kind+version registry; adding a connector never widens RPC input. */
const sourceBindingRegistry = new Map<string, BindingAdapter>();

function bindingKey(kind: string, version: string): string {
  return `${kind}:${version}`;
}

/** Resolves only persisted IDs; caller-provided provider identity never enters. */
export async function resolveSourceBinding(
  ctx: DashframeFunctionContext,
  tableId: UUID,
): Promise<SourceBinding> {
  const table = (await ctx.db
    .from(schema.dataTables)
    .where(eq("id", tableId))
    .first()) as TableRow | undefined;
  if (!table || !table.table) throw new Error("TARGET_NOT_READY");
  const source = (await ctx.db
    .from(schema.dataSources)
    .where(eq("id", table.dataSourceId))
    .first()) as SourceRow | undefined;
  if (!source) throw new Error("TARGET_NOT_READY");
  const config = source.config;
  if (config !== null && (typeof config !== "object" || Array.isArray(config)))
    throw new Error("TARGET_NOT_READY");
  const configuredVersion = (
    config as { sourceBindingVersion?: unknown } | null
  )?.sourceBindingVersion;
  const version = configuredVersion ?? SOURCE_BINDING_VERSION;
  if (typeof version !== "string") throw new Error("TARGET_NOT_READY");
  if (!sourceBindingRegistry.has(bindingKey(source.kind, version)))
    throw new Error("TARGET_NOT_READY");
  return {
    connectorKind: source.kind,
    sourceBindingVersion: SOURCE_BINDING_VERSION,
    dataSourceId: source.id,
    table,
  };
}

type QueryConnector = {
  query: (
    resource: string,
    tableId: UUID,
    options?: { pagination: { offset: number; limit: number } },
  ) => Promise<{
    arrowBuffer: string;
    fieldIds: string[];
    fields: Field[];
    rowCount: number;
  }>;
};

/**
 * Runs a persisted remote binding to exhaustion. The connector factory is
 * server-owned, so provider identity and credentials never cross this seam.
 */
async function fetchPagedRemoteBinding(
  ctx: DashframeFunctionContext,
  binding: SourceBinding,
  kind: "googleAnalytics" | "notion" | "postgres",
  connectorFor: (
    ctx: DashframeFunctionContext,
    sourceId: UUID,
  ) => Promise<QueryConnector>,
): Promise<LiveSourceResult> {
  if (
    binding.connectorKind !== kind ||
    binding.sourceBindingVersion !== SOURCE_BINDING_VERSION
  )
    throw new Error("TARGET_NOT_READY");
  try {
    const connector = await connectorFor(ctx, binding.dataSourceId);
    const pages: Array<Awaited<ReturnType<QueryConnector["query"]>>> = [];
    let offset = 0;
    let expected: string | undefined;
    for (;;) {
      const page = await connector.query(
        binding.table.table,
        binding.table.id,
        {
          pagination: { offset, limit: GA4_PAGE_SIZE },
        },
      );
      const signature = pageSignature(page);
      if (expected === undefined) expected = signature;
      else if (signature !== expected) throw new Error("SOURCE_SCHEMA_CHANGED");
      pages.push(page);
      // A short page, including an empty page after an exact multiple, is the
      // provider's completion signal. Never publish an accumulated prefix.
      if (page.rowCount < GA4_PAGE_SIZE) break;
      offset += GA4_PAGE_SIZE;
    }
    return {
      ...combinePages(pages),
      provenance: {
        connectorKind: binding.connectorKind,
        sourceBindingVersion: binding.sourceBindingVersion,
      },
    };
  } catch (error) {
    // Provider text and credential details remain private to the adapter.
    throw new Error(
      error instanceof Error &&
        (error.message === "TARGET_NOT_READY" ||
          error.message === "SOURCE_SCHEMA_CHANGED")
        ? error.message
        : "FETCH_EXECUTION_FAILED",
    );
  }
}

/**
 * Notion and Postgres already exhaust their source inside one connector query.
 * Passing synthetic offsets to Notion would repeatedly fetch its first page;
 * keep provider-specific continuation ownership below the binding seam.
 */
async function fetchExhaustiveRemoteBinding(
  ctx: DashframeFunctionContext,
  binding: SourceBinding,
  kind: "notion" | "postgres",
  connectorFor: (
    ctx: DashframeFunctionContext,
    sourceId: UUID,
  ) => Promise<QueryConnector>,
): Promise<LiveSourceResult> {
  if (
    binding.connectorKind !== kind ||
    binding.sourceBindingVersion !== SOURCE_BINDING_VERSION
  )
    throw new Error("TARGET_NOT_READY");
  try {
    const connector = await connectorFor(ctx, binding.dataSourceId);
    const result = await connector.query(binding.table.table, binding.table.id);
    pageSignature(result);
    return {
      ...result,
      provenance: {
        connectorKind: binding.connectorKind,
        sourceBindingVersion: binding.sourceBindingVersion,
      },
    };
  } catch (error) {
    throw new Error(
      error instanceof Error &&
        (error.message === "TARGET_NOT_READY" ||
          error.message === "SOURCE_SCHEMA_CHANGED")
        ? error.message
        : "FETCH_EXECUTION_FAILED",
    );
  }
}

/** Credential refinement stays inside ga4ConnectorFor. */
export async function fetchGa4Binding(
  ctx: DashframeFunctionContext,
  binding: SourceBinding,
): Promise<LiveSourceResult> {
  return fetchPagedRemoteBinding(
    ctx,
    binding,
    "googleAnalytics",
    ga4ConnectorFor,
  );
}

export async function fetchNotionBinding(
  ctx: DashframeFunctionContext,
  binding: SourceBinding,
): Promise<LiveSourceResult> {
  return fetchExhaustiveRemoteBinding(
    ctx,
    binding,
    "notion",
    notionConnectorFor,
  );
}

export async function fetchPostgresBinding(
  ctx: DashframeFunctionContext,
  binding: SourceBinding,
): Promise<LiveSourceResult> {
  return fetchExhaustiveRemoteBinding(
    ctx,
    binding,
    "postgres",
    postgresConnectorFor,
  );
}

/** Reads only the table's prepared, server-owned current source generation. */
export async function fetchLocalBinding(
  ctx: DashframeFunctionContext,
  binding: SourceBinding,
): Promise<LiveSourceResult> {
  if (
    binding.connectorKind !== "local" ||
    binding.sourceBindingVersion !== SOURCE_BINDING_VERSION ||
    !binding.table.dataFrameId ||
    !ctx.dataFrameStorage
  )
    throw new Error("TARGET_NOT_READY");
  try {
    const frame = (await ctx.db
      .from(schema.dataFrames)
      .where(eq("id", binding.table.dataFrameId))
      .first()) as FrameRow | undefined;
    const storage = frame?.storage as { type?: unknown; key?: unknown } | null;
    if (
      !frame ||
      frame.sourceId !== binding.dataSourceId ||
      frame.definitionId !== binding.table.id ||
      storage?.type !== "file" ||
      storage.key !== frame.id
    )
      throw new Error("TARGET_NOT_READY");
    const arrow = await ctx.dataFrameStorage.load(frame.id);
    if (!arrow) throw new Error("TARGET_NOT_READY");
    const fieldIds = frame.fieldIds;
    const fields = binding.table.fields;
    const rowCount = frame.rowCount;
    if (
      !Array.isArray(fieldIds) ||
      !fieldIds.every((id): id is string => typeof id === "string") ||
      !Array.isArray(fields) ||
      !fields.every(isField) ||
      typeof rowCount !== "number" ||
      !Number.isSafeInteger(rowCount) ||
      rowCount < 0
    )
      throw new Error("FETCH_EXECUTION_FAILED");
    const encoded = Buffer.from(arrow).toString("base64");
    pageSignature({
      arrowBuffer: encoded,
      fieldIds,
      fields,
      rowCount,
    });
    return {
      arrowBuffer: encoded,
      fieldIds,
      fields,
      rowCount,
      provenance: {
        connectorKind: binding.connectorKind,
        sourceBindingVersion: binding.sourceBindingVersion,
      },
    };
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message === "TARGET_NOT_READY"
        ? error.message
        : "FETCH_EXECUTION_FAILED",
    );
  }
}

function isField(value: unknown): value is Field {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Field).id === "string" &&
    typeof (value as Field).name === "string" &&
    typeof (value as Field).tableId === "string"
  );
}

function pageSignature(page: {
  arrowBuffer: string;
  fieldIds: string[];
  fields: Field[];
  rowCount: number;
}): string {
  const table = tableFromIPC(Buffer.from(page.arrowBuffer, "base64"));
  if (
    !Number.isSafeInteger(page.rowCount) ||
    page.rowCount < 0 ||
    table.numRows !== page.rowCount
  )
    throw new Error("FETCH_EXECUTION_FAILED");
  if (
    !Array.isArray(page.fieldIds) ||
    new Set(page.fieldIds).size !== page.fieldIds.length ||
    !page.fieldIds.every((id) => typeof id === "string") ||
    page.fields.length !== page.fieldIds.length ||
    !page.fields.every(isField) ||
    page.fields.some((field, index) => field.id !== page.fieldIds[index]) ||
    table.schema.fields.length !== page.fields.length ||
    table.schema.fields.some(
      (field, index) =>
        field.name !==
        (page.fields[index]?.columnName ?? page.fields[index]?.name),
    )
  )
    throw new Error("FETCH_EXECUTION_FAILED");
  return JSON.stringify({
    fieldIds: page.fieldIds,
    fields: page.fields,
    schema: table.schema.fields.map((field) => ({
      name: field.name,
      nullable: field.nullable,
      type: field.type.toString(),
      metadata: Array.from(field.metadata ?? []).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    })),
  });
}

function combinePages(
  pages: Array<{
    arrowBuffer: string;
    fieldIds: string[];
    fields: Field[];
    rowCount: number;
  }>,
): Omit<LiveSourceResult, "provenance"> {
  const first = pages[0];
  if (!first) throw new Error("FETCH_EXECUTION_FAILED");
  const tables = pages.map((page) =>
    tableFromIPC(Buffer.from(page.arrowBuffer, "base64")),
  );
  const arrow = tableToIPC(
    new Table(tables[0]!.schema, ...tables.flatMap((table) => table.batches)),
  );
  return {
    arrowBuffer: Buffer.from(arrow).toString("base64"),
    fieldIds: first.fieldIds,
    fields: first.fields,
    rowCount: pages.reduce((total, page) => total + page.rowCount, 0),
  };
}

sourceBindingRegistry.set(
  bindingKey("googleAnalytics", SOURCE_BINDING_VERSION),
  fetchGa4Binding,
);
sourceBindingRegistry.set(
  bindingKey("notion", SOURCE_BINDING_VERSION),
  fetchNotionBinding,
);
sourceBindingRegistry.set(
  bindingKey("postgres", SOURCE_BINDING_VERSION),
  fetchPostgresBinding,
);
sourceBindingRegistry.set(
  bindingKey("local", SOURCE_BINDING_VERSION),
  fetchLocalBinding,
);

/** Dispatches a resolved persisted binding; callers never select an adapter. */
export async function fetchSourceBinding(
  ctx: DashframeFunctionContext,
  binding: SourceBinding,
): Promise<LiveSourceResult> {
  const adapter = sourceBindingRegistry.get(
    bindingKey(binding.connectorKind, binding.sourceBindingVersion),
  );
  if (!adapter) throw new Error("TARGET_NOT_READY");
  return adapter(ctx, binding);
}
