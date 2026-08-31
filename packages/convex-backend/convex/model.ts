import type { Infer } from "convex/values";
import type { artifact } from "./schema";
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
