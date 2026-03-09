// =============================================================================
// @dashframe/ui — Thin re-export layer
//
// Most primitives, components, and utilities come from @stdui/react.
// This file adds DashFrame-specific components, overrides, and field wrappers.
// Icons are exported separately via the "./icons" export path.
// =============================================================================

// -- Base: everything from stdui --
// Includes: cn, colorVariants, sizeScale, stateVariant, Button, ButtonGroup,
// Spinner, EmptyState, ErrorState, LoadingState, Stack, Container, Panel,
// Section, SectionList, ItemList, CollapseHandle, CollapsibleSection, Toggle,
// Tooltip, all primitives (Badge, Card, Dialog, Select, Tabs, Input, etc.)
export * from "@stdui/react";

// -- Icons (re-exported so `from "@dashframe/ui"` icon imports keep working) --
export * from "./lib/icons";

// -- DashFrame-specific components (not in stdui) --

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

// Chart icons (static SVG representations of chart types)
// NOTE: DotIcon is renamed to ChartDotIcon to avoid conflict with @stdui/icons DotIcon
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

// Breadcrumb — DashFrame's version overrides stdui's Breadcrumb primitive
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

// -- Theme (from stdui subpath export, re-exported for convenience) --

export { StduiProvider, useTheme } from "@stdui/react/theme";
export type { ResolvedMode, ThemeMode } from "@stdui/react/theme";

// -- Fonts --

export { GeistMono, GeistSans } from "./lib/fonts";

// -- Field wrappers (primitives + Field component, not in stdui) --

export { Input as InputField } from "./fields/input";
export { MultiSelect as MultiSelectField } from "./fields/multi-select";
export { Select as SelectField } from "./fields/select";

// -- Deprecated aliases --

/** @deprecated Use ButtonGroup instead. ActionGroup will be removed in a future version. */
export { ButtonGroup as ActionGroup } from "@stdui/react";
/** @deprecated Use ButtonGroupProps instead. ActionGroupProps will be removed in a future version. */
export type { ButtonGroupProps as ActionGroupProps } from "@stdui/react";
