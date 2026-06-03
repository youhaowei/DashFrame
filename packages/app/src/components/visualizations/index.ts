// Core visualization components - used by Dexie-migrated pages
export { CreateVisualizationModal } from "./CreateVisualizationModal";
export { DateTransformPicker } from "./DateTransformPicker";
export { EmptyState } from "./EmptyState";
export { JoinFlowModal } from "./JoinFlowModal";
export { VisualizationDisplay } from "./VisualizationDisplay";
export { VisualizationItemCard } from "./VisualizationItemCard";
export { VisualizationPreview } from "./VisualizationPreview";

// Re-export VirtualTable from @dashframe/ui for backward compatibility
// TableView is deprecated - use VirtualTable from @dashframe/ui directly
export { VirtualTable as TableView } from "@dashframe/ui";

// Note: VegaChart is deprecated - use Chart from @dashframe/visualization
