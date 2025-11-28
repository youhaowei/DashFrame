// Core visualization components - used by Convex-migrated pages
export { CreateVisualizationModal } from "./CreateVisualizationModal";
export { VegaChart } from "./VegaChart";
export { EmptyState } from "./EmptyState";

// Re-export DataFrameTable from @dashframe/ui for backward compatibility
// TableView is deprecated - use DataFrameTable from @dashframe/ui directly
export { DataFrameTable as TableView } from "@dashframe/ui";

// Legacy components - kept for backward compatibility
// Note: These are being migrated to Convex and will be removed
export { VisualizationTabs } from "./VisualizationTabs";
export { VisualizationControls } from "./VisualizationControls";
export { VisualizationDisplay } from "./VisualizationDisplay";
export { VisualizationPanel } from "./VisualizationPanel";
export { JoinFlowModal } from "./JoinFlowModal";
