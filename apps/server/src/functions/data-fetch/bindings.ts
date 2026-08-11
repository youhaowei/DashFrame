/** Server-only Source Binding resolution for live data fetches. */
import { schema } from "@dashframe/server-core";
import type { Field, UUID } from "@dashframe/types";
import { eq } from "@wystack/db";
import { Table, tableFromIPC, tableToIPC } from "apache-arrow";

import type { DashframeFunctionContext } from "../../app-context";
import { ga4ConnectorFor } from "../app-artifacts";

const SOURCE_BINDING_VERSION = "v1";
/** Keep each provider response bounded while exhaustively paging the source. */
const GA4_PAGE_SIZE = 10_000;

type SourceRow = typeof schema.dataSources.$inferSelect;
type TableRow = typeof schema.dataTables.$inferSelect;

export type SourceBinding = Readonly<{
  connectorKind: string;
  sourceBindingVersion: typeof SOURCE_BINDING_VERSION;
  dataSourceId: UUID;
  table: Pick<TableRow, "id" | "table" | "fields" | "dataSourceId">;
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

/** First registry adapter. Credential refinement stays inside ga4ConnectorFor. */
export async function fetchGa4Binding(
  ctx: DashframeFunctionContext,
  binding: SourceBinding,
): Promise<LiveSourceResult> {
  if (
    binding.connectorKind !== "googleAnalytics" ||
    binding.sourceBindingVersion !== SOURCE_BINDING_VERSION
  )
    throw new Error("TARGET_NOT_READY");
  try {
    const connector = await ga4ConnectorFor(ctx, binding.dataSourceId);
    const pages: Array<Awaited<ReturnType<typeof connector.query>>> = [];
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
      // provider's only completion signal. Never publish an accumulated prefix.
      if (page.rowCount < GA4_PAGE_SIZE) break;
      offset += GA4_PAGE_SIZE;
    }
    const result = combineGa4Pages(pages);
    return {
      ...result,
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

function combineGa4Pages(
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
