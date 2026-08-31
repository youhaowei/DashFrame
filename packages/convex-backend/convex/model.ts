import type { Infer } from "convex/values";
import type { artifact } from "./schema";
export type ArtifactRow = Infer<typeof artifact>;
export type DataSourceRow = ArtifactRow;
export type DataTableRow = ArtifactRow;
export type DataFrameRow = ArtifactRow;
export type InsightRow = ArtifactRow;
export type VisualizationRow = ArtifactRow;
export type DashboardRow = ArtifactRow;
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
