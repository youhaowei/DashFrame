/** Server-only Source Binding resolution for live data fetches. */
import { schema } from "@dashframe/server-core";
import type { Field, UUID } from "@dashframe/types";
import { eq } from "@wystack/db";

import type { DashframeFunctionContext } from "../../app-context";
import { ga4ConnectorFor } from "../app-artifacts";

const SOURCE_BINDING_VERSION = "v1";

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
  const version =
    (source.config as { sourceBindingVersion?: unknown } | null)
      ?.sourceBindingVersion ?? SOURCE_BINDING_VERSION;
  if (version !== SOURCE_BINDING_VERSION) throw new Error("TARGET_NOT_READY");
  if (source.kind !== "googleAnalytics") throw new Error("TARGET_NOT_READY");
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
    const result = await connector.query(binding.table.table, binding.table.id);
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
      error instanceof Error && error.message === "TARGET_NOT_READY"
        ? "TARGET_NOT_READY"
        : "FETCH_EXECUTION_FAILED",
    );
  }
}
