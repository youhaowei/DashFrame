import type { InsightSourceGeneration, UUID } from "@dashframe/types";
import { z } from "zod";

type SourceGeneration = InsightSourceGeneration;
const sourceGenerationSchema = z.object({
  tableId: z.string().uuid(),
  dataFrameId: z.string().uuid(),
  lastFetchedAt: z.number().finite(),
});

function normalize(value: unknown): SourceGeneration[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = sourceGenerationSchema.safeParse(entry);
    if (!parsed.success) return [];
    return [
      {
        tableId: parsed.data.tableId as UUID,
        dataFrameId: parsed.data.dataFrameId as UUID,
        lastFetchedAt: parsed.data.lastFetchedAt,
      },
    ];
  });
}

/** Private-field brand prevents connector/provider Errors from spoofing pointers. */
export class PublishedSourceMaterializationError extends Error {
  readonly #sourceGenerations: SourceGeneration[];

  constructor(error: unknown, sourceGenerations: unknown) {
    super(error instanceof Error ? error.message : "FETCH_EXECUTION_FAILED", {
      cause: error,
    });
    this.#sourceGenerations = normalize(sourceGenerations);
  }

  sourceGenerations(): SourceGeneration[] {
    return this.#sourceGenerations.map(
      ({ tableId, dataFrameId, lastFetchedAt }) => ({
        tableId,
        dataFrameId,
        lastFetchedAt,
      }),
    );
  }
}

export function trustedPublishedSourceGenerations(
  error: unknown,
): SourceGeneration[] | undefined {
  if (!(error instanceof PublishedSourceMaterializationError)) return undefined;
  const generations = error.sourceGenerations();
  return generations.length ? generations : undefined;
}
