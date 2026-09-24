// Core visualization components
export { DateTransformPicker } from "./DateTransformPicker";
export { JoinFlowModal } from "./JoinFlowModal";
export { VisualizationDisplay } from "./VisualizationDisplay";
export { VisualizationPreview } from "./VisualizationPreview";

// Re-export VirtualTable from @dashframe/ui for backward compatibility
// TableView is deprecated - use VirtualTable from @dashframe/ui directly
export { VirtualTable as TableView } from "@dashframe/ui";

// Note: VegaChart is deprecated - use Chart from @dashframe/visualization
