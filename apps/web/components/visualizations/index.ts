// Core visualization components - used by Dexie-migrated pages
export { CreateVisualizationModal } from "./CreateVisualizationModal";
export { VegaChart } from "./VegaChart";
export { EmptyState } from "./EmptyState";
export { VisualizationDisplay } from "./VisualizationDisplay";
export { VisualizationPreview } from "./VisualizationPreview";
export { JoinFlowModal } from "./JoinFlowModal";

// Re-export VirtualTable from @dashframe/ui for backward compatibility
// TableView is deprecated - use VirtualTable from @dashframe/ui directly
export { VirtualTable as TableView } from "@dashframe/ui";
