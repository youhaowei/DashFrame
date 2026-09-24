import type { ConnectorCatalogEntry } from "@dashframe/types";

export type SourceFreshness =
  | {
      kind: "fetched";
      /** Undefined while the connector kind is unknown (registry not hydrated). */
      verb?: "imported" | "refreshed";
      at: number;
    }
  /** Some tables were never fetched: no source-wide time can be claimed. */
  | { kind: "partial"; fetched: number; total: number };

/**
 * "Is this source current?" from its tables' fetch times (undefined for a
 * table never fetched). A file source was imported when its newest file
 * landed. A remote source is only as current as its stalest table, so it reads
 * the oldest fetch. Unknown kinds get the conservative oldest time and no verb.
 * If some tables were never fetched, the source is not current as a whole, so
 * it reports how many were; if none were, there is nothing to say.
 */
export function sourceFreshness(
  fetchTimes: readonly (number | undefined)[],
  sourceType: ConnectorCatalogEntry["sourceType"] | undefined,
): SourceFreshness | undefined {
  const times = fetchTimes.filter((time): time is number => !!time);
  if (times.length === 0) return undefined;
  if (times.length < fetchTimes.length)
    return { kind: "partial", fetched: times.length, total: fetchTimes.length };
  if (sourceType === "file")
    return { kind: "fetched", verb: "imported", at: Math.max(...times) };
  const at = Math.min(...times);
  return sourceType === "remote-api"
    ? { kind: "fetched", verb: "refreshed", at }
    : { kind: "fetched", at };
}
