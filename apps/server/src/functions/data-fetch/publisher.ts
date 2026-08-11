/** Canonical DB publication for immutable live-fetch generations. */
import { schema } from "@dashframe/server-core";
import type { DataFrameStorageLocation, UUID } from "@dashframe/types";
import { eq } from "@wystack/db";

import type { DashframeFunctionContext } from "../../app-context";
import type { PublishMaterialization } from "./materializer";

const { dataFrames, dataTables } = schema;

/**
 * Publishes only after C1 has saved and registered every generation. The
 * transaction never deletes old rows/files, so old frame handles stay valid.
 */
export async function publishMaterialization(
  ctx: DashframeFunctionContext,
  value: PublishMaterialization,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    for (const { source, frame } of value.sources) {
      await tx.into(dataFrames).insert({
        id: frame.id,
        storage: { type: "file", key: frame.id } as DataFrameStorageLocation,
        fieldIds: frame.fieldIds,
        name: source.table.name,
        sourceId: source.table.dataSourceId,
        definitionId: source.table.id,
        rowCount: frame.rowCount,
        columnCount: frame.fieldIds.length,
        analysis: {
          schema: frame.schema,
          provenance: source.provenance,
          fetchedAt: value.fetchedAt,
        } as never,
        lastRefreshedAt: new Date(value.fetchedAt),
      });
      await tx
        .from(dataTables)
        .where(eq("id", source.table.id))
        .update({
          dataFrameId: frame.id,
          lastFetchedAt: new Date(value.fetchedAt),
        });
    }
    if (value.target.kind === "saved") {
      // Detach, don't delete: historical handles remain readable.
      await tx
        .from(dataFrames)
        .where(eq("insightId", value.target.insightId))
        .update({ insightId: null });
    }
    await tx.into(dataFrames).insert({
      id: value.result.id,
      storage: {
        type: "file",
        key: value.result.id,
      } as DataFrameStorageLocation,
      fieldIds: value.result.fieldIds,
      name:
        value.target.kind === "saved"
          ? `Insight ${value.target.insightId}`
          : "Live fetch",
      ...(value.target.kind === "saved"
        ? { insightId: value.target.insightId }
        : {}),
      rowCount: value.result.rowCount,
      columnCount: value.result.fieldIds.length,
      analysis: {
        schema: value.result.schema,
        definitionFingerprint: value.definitionFingerprint,
        provenance: value.provenance,
        fetchedAt: value.fetchedAt,
      } as never,
      lastRefreshedAt: new Date(value.fetchedAt),
    });
  });
}

export function staleFrameMetadata(row: {
  id: UUID;
  fieldIds: unknown;
  rowCount: number | null;
  analysis: unknown;
  lastRefreshedAt: Date | null;
}) {
  const analysis = row.analysis as {
    schema?: unknown;
    definitionFingerprint?: unknown;
    provenance?: unknown;
    fetchedAt?: unknown;
  } | null;
  if (
    !analysis ||
    !Array.isArray(analysis.schema) ||
    typeof analysis.definitionFingerprint !== "string" ||
    !analysis.provenance ||
    typeof analysis.provenance !== "object" ||
    typeof (analysis.provenance as { connectorKind?: unknown })
      .connectorKind !== "string" ||
    typeof (analysis.provenance as { bindingVersion?: unknown })
      .bindingVersion !== "string" ||
    typeof analysis.fetchedAt !== "number" ||
    !Number.isFinite(analysis.fetchedAt) ||
    row.rowCount == null ||
    !Number.isInteger(row.rowCount) ||
    row.rowCount < 0
  )
    return undefined;
  return {
    stale: true as const,
    dataFrameId: row.id,
    schema: analysis.schema as never,
    rowCount: row.rowCount!,
    definitionFingerprint: analysis.definitionFingerprint,
    provenance: analysis.provenance as never,
    fetchedAt: analysis.fetchedAt,
  };
}
