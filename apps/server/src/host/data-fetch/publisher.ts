/** Native metadata publication for immutable live-fetch generations. */
import { isDeepStrictEqual } from "node:util";
import type { PublicationMetadata } from "@dashframe/convex-backend/model";
import type { UUID } from "@dashframe/types";

import type { HostContext } from "../context";
import type { PublishMaterialization } from "./materializer";

/** A missing acknowledgement cannot distinguish rejection from a later commit. */
export class PublicationOutcomeUnknownError extends Error {
  constructor(
    readonly operationId: string,
    cause: unknown,
  ) {
    super("FRAME_PUBLICATION_UNCONFIRMED", { cause });
    this.name = "PublicationOutcomeUnknownError";
  }
}

/**
 * Recover a lost acknowledgement only from an exact durable operation record.
 * Absence is inconclusive: a query can finish before the mutation commits.
 * Callers must retain all potentially referenced files on an unknown outcome.
 */
export async function publishWithConfirmation(
  metadata: Pick<HostContext["metadata"], "getOperation">,
  operationId: string,
  request: unknown,
  publish: () => Promise<void>,
): Promise<void> {
  // Match the JSON boundary used by the host's native metadata adapter.
  const expected: unknown = JSON.parse(JSON.stringify(request));
  try {
    await publish();
  } catch (error) {
    try {
      const committed = await metadata.getOperation(operationId);
      if (committed && isDeepStrictEqual(committed.request, expected)) return;
    } catch {
      // Neither an unavailable query nor a mismatching record permits cleanup.
    }
    throw new PublicationOutcomeUnknownError(operationId, error);
  }
}

/** Publish after every generation is saved; preserve all old frame handles. */
export async function publishMaterialization(
  ctx: HostContext,
  value: PublishMaterialization,
): Promise<void> {
  // Project explicitly so Arrow buffers and field sample values never cross
  // into Convex or its durable idempotency receipt.
  const frameMetadata = (frame: PublishMaterialization["result"]) => ({
    id: frame.id,
    fieldIds: [...frame.fieldIds],
    rowCount: frame.rowCount,
    schema: frame.schema.map(({ id, name, type }) => ({ id, name, type })),
  });
  const provenanceMetadata = (
    provenance: PublishMaterialization["provenance"],
  ) => ({
    connectorKind: provenance.connectorKind,
    bindingVersion: provenance.bindingVersion,
  });
  const request: PublicationMetadata = {
    target:
      value.target.kind === "saved"
        ? { kind: "saved", insightId: value.target.insightId }
        : { kind: value.target.kind },
    sources: value.sources.map(({ source, frame }) => ({
      source: {
        table: {
          id: source.table.id,
          dataSourceId: source.table.dataSourceId,
          table: source.table.table,
          name: source.table.name,
        },
        provenance: provenanceMetadata(source.provenance),
      },
      frame: frameMetadata(frame),
    })),
    result: frameMetadata(value.result),
    definitionFingerprint: value.definitionFingerprint,
    provenance: provenanceMetadata(value.provenance),
    fetchedAt: value.fetchedAt,
  };
  await publishWithConfirmation(
    ctx.metadata,
    `materialize:${value.result.id}`,
    request,
    () => ctx.metadata.publishMaterialization(request),
  );
}

export function staleFrameMetadata(row: {
  id: UUID;
  fieldIds: unknown;
  rowCount: number | null;
  analysis: unknown;
  lastRefreshedAt: number | null;
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
