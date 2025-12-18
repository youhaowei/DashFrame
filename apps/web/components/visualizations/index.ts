// Core visualization components - used by Dexie-migrated pages
export { CreateVisualizationModal } from "./CreateVisualizationModal";
export { EmptyState } from "./EmptyState";
export { VisualizationDisplay } from "./VisualizationDisplay";
export { VisualizationItemCard } from "./VisualizationItemCard";
export { VisualizationPreview } from "./VisualizationPreview";
export { JoinFlowModal } from "./JoinFlowModal";

// Re-export VirtualTable from @dashframe/ui for backward compatibility
// TableView is deprecated - use VirtualTable from @dashframe/ui directly
export { VirtualTable as TableView } from "@dashframe/ui";

// Note: VegaChart is deprecated - use Chart from @dashframe/visualization
