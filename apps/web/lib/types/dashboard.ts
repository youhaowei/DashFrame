import type { UUID } from "@dashframe/core";

export type DashboardItemType = "visualization" | "markdown";

export interface DashboardLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export interface DashboardItem {
  id: UUID;
  type: DashboardItemType;
  layout: DashboardLayout;

  // For visualizations
  visualizationId?: UUID;

  // For markdown
  content?: string;
}

export interface Dashboard {
  id: UUID;
  name: string;
  description?: string;
  items: DashboardItem[];
  createdAt: number;
  updatedAt: number;
}
