/** Native metadata publication for immutable live-fetch generations. */
import { isDeepStrictEqual } from "node:util";
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
  await publishWithConfirmation(
    ctx.metadata,
    `materialize:${value.result.id}`,
    value,
    () => ctx.metadata.publishMaterialization(value),
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
