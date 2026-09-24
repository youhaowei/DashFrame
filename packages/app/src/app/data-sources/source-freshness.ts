import type { ConnectorCatalogEntry } from "@dashframe/types";

export type SourceFreshness = {
  /** Undefined while the connector kind is unknown (registry not hydrated). */
  verb?: "imported" | "refreshed";
  at: number;
};

/**
 * "Is this source current?" from its tables' fetch times. A file source was
 * imported when its newest file landed. A remote source is only as current as
 * its stalest table, so it reads the oldest fetch. Unknown kinds get the
 * conservative oldest time and no verb. Tables never fetched carry no time.
 */
export function sourceFreshness(
  fetchTimes: readonly number[],
  sourceType: ConnectorCatalogEntry["sourceType"] | undefined,
): SourceFreshness | undefined {
  if (fetchTimes.length === 0) return undefined;
  if (sourceType === "file")
    return { verb: "imported", at: Math.max(...fetchTimes) };
  const at = Math.min(...fetchTimes);
  return sourceType === "remote-api" ? { verb: "refreshed", at } : { at };
}
