// =============================================================================
// @dashframe/ui — DashFrame-specific UI components
//
// stdui primitives and components: import from "@wystack/ui-react"
// Icons: import from "@wystack/ui-react/icons"
// Core tokens/theme utils: import from "@wystack/ui-core"
// React theme provider: import from "@wystack/ui-react/theme"
//
// This package exports ONLY DashFrame-specific components, hooks, and utilities
// that are not part of the stdui design system.
// =============================================================================

// -- DashFrame-specific components --

export {
  VirtualTable,
  type FetchDataParams,
  type FetchDataResult,
  type VirtualTableColumn,
  type VirtualTableColumnConfig,
  type VirtualTableProps,
} from "./components/VirtualTable";

export {
  SortableList,
  type SortableListItem,
  type SortableListProps,
} from "./components/SortableList";

export {
  JoinTypeIcon,
  getJoinTypeDescription,
  getJoinTypeLabel,
  type JoinType,
  type JoinTypeIconProps,
} from "./components/JoinTypeIcon";

export {
  ItemSelector,
  type ItemSelectorProps,
  type SelectableItem,
} from "./components/ItemSelector";

export {
  ControlTooltip,
  type ControlTooltipProps,
} from "./components/ControlTooltip";

// Chart icons (static SVG representations of chart types)
// NOTE: DotIcon is renamed to ChartDotIcon to avoid conflict with @wystack/ui-react/icons DotIcon
export {
  AreaYIcon,
  BarXIcon,
  BarYIcon,
  CHART_ICONS,
  DotIcon as ChartDotIcon,
  HeatmapIcon,
  HexbinIcon,
  LineIcon,
  RasterIcon,
  getChartIcon,
} from "./components/chart-icons";

// Breadcrumb — DashFrame's version (enhanced with Link integration)
export {
  Breadcrumb,
  type BreadcrumbItem,
  type BreadcrumbProps,
} from "./components/Breadcrumb";

// -- DashFrame-specific hooks --

export {
  useContainerDimensions,
  type ContainerDimensions,
  type UseContainerDimensionsOptions,
} from "./hooks/useContainerDimensions";

// -- Field wrappers (primitives + Field component, not in stdui) --

export { Input as InputField } from "./fields/input";
export { MultiSelect as MultiSelectField } from "./fields/multi-select";
export { Select as SelectField } from "./fields/select";

// -- Display-layer utilities --

export { formatNumeric } from "./lib/format-numeric";
export { formatDateValue } from "./lib/format-virtual-table-value";
export { groupHoverAndFocusWithinReveal } from "./lib/reveal-on-focus-within";
