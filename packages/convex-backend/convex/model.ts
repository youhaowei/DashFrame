import type { Infer } from "convex/values";
import type { artifact } from "./schema";
export type PublicationMetadata = Infer<
  typeof import("./publication").publicationMetadata
>;
export type ArtifactRow = Infer<typeof artifact>;
type HostRow = Omit<ArtifactRow, "workspaceId" | "revision">;
export type DataSourceRow = HostRow & {
  kind: string;
  storage: string;
  config: import("./values").ObjectValue;
};
export type DataTableRow = Omit<
  HostRow,
  "fields" | "metrics" | "sourceSchema"
> & {
  dataSourceId: string;
  table: string;
  fields: import("@dashframe/types").Field[];
  metrics: import("@dashframe/types").Metric[];
  sourceSchema?: import("@dashframe/types").SourceSchema | null;
};
export type DataFrameRow = Omit<HostRow, "storage"> & {
  storage: import("@dashframe/types").DataFrameStorageLocation;
  fieldIds: string[];
};
export type InsightRow = HostRow & {
  definition: import("./values").ObjectValue;
};
export type VisualizationRow = HostRow & {
  insightId: string;
  chartType: string;
};
export type DashboardRow = HostRow & {
  layout: import("./values").ObjectValue[];
};
export const artifactTables = [
  "dataSources",
  "dataTables",
  "insights",
  "dataFrames",
  "visualizations",
  "dashboards",
] as const;
export type ArtifactTable = (typeof artifactTables)[number];
export const artifactKinds = {
  dataSources: "dataSource",
  dataTables: "dataTable",
  insights: "insight",
  dataFrames: "dataFrame",
  visualizations: "visualization",
  dashboards: "dashboard",
} as const;

export type HostBatchState = Infer<
  typeof import("./lifecycleValues").hostBatchState
>;
export type CleanupClaim = Infer<
  typeof import("./lifecycleValues").cleanupClaim
>;

/** Payload of the ConvexError thrown when a reference scan exceeds its cap. */
export const RESOURCE_REFERENCE_SCAN_CAP_CODE = "RESOURCE_REFERENCE_SCAN_CAP";
export type ResourceReferenceScanCapPayload = {
  code: typeof RESOURCE_REFERENCE_SCAN_CAP_CODE;
  table: string;
  message: string;
};

function capPayload(data: unknown): ResourceReferenceScanCapPayload | null {
  // Convex replaces `ConvexError.data` with a JSON string as the value leaves a
  // function (`serializeConvexErrorData`), and nests another layer per enclosing
  // invocation; a client that decodes the response hands back the object again.
  // Callers can see any of those, so unwrap string layers before matching.
  let value = data;
  for (let depth = 0; typeof value === "string" && depth < 4; depth++) {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const payload = value as Partial<ResourceReferenceScanCapPayload>;
  return payload.code === RESOURCE_REFERENCE_SCAN_CAP_CODE &&
    typeof payload.table === "string" &&
    typeof payload.message === "string"
    ? (payload as ResourceReferenceScanCapPayload)
    : null;
}

/**
 * Structural, not `instanceof ConvexError`: the host reads this after the value
 * has crossed a client boundary, where the class identity is not guaranteed.
 */
export function resourceReferenceScanCapPayload(
  error: unknown,
): ResourceReferenceScanCapPayload | null {
  if (typeof error !== "object" || error === null || !("data" in error))
    return null;
  return capPayload((error as { data: unknown }).data);
}

export function isResourceReferenceScanCapError(error: unknown): boolean {
  return resourceReferenceScanCapPayload(error) !== null;
}
