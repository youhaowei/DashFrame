import { v } from "convex/values";
const provenance = v.object({
  connectorKind: v.string(),
  bindingVersion: v.string(),
});
const frame = v.object({
  id: v.string(),
  fieldIds: v.array(v.string()),
  rowCount: v.number(),
  schema: v.array(
    v.object({ id: v.string(), name: v.string(), type: v.string() }),
  ),
});
/** Only immutable frame metadata crosses into Convex; row bytes stay on the host. */
export const publicationMetadata = v.object({
  sources: v.array(
    v.object({
      source: v.object({
        table: v.object({
          id: v.string(),
          dataSourceId: v.string(),
          table: v.string(),
          name: v.string(),
        }),
        provenance,
      }),
      frame,
    }),
  ),
  target: v.union(
    v.object({ kind: v.literal("ephemeral") }),
    v.object({ kind: v.literal("transient") }),
    v.object({ kind: v.literal("saved"), insightId: v.string() }),
  ),
  result: frame,
  definitionFingerprint: v.string(),
  provenance,
  fetchedAt: v.number(),
});
