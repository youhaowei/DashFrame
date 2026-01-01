// Utilities
export { cn } from "./lib/utils";

// Variant tokens (shared CVA values)
export {
  colorVariants,
  sizeScale,
  type ColorVariant,
  type SizeVariant,
} from "./lib/variants";

// Hooks
export {
  useContainerDimensions,
  type ContainerDimensions,
  type UseContainerDimensionsOptions,
} from "./hooks/useContainerDimensions";

// Fonts
export { GeistSans, GeistMono } from "./lib/fonts";

// Icons
export * from "./lib/icons";
export type { LucideIcon } from "./lib/icons";

// UI Primitives (shadcn/ui components)
export { Alert, AlertTitle, AlertDescription } from "./primitives/alert";
export { Badge } from "./primitives/badge";
// Button - High-level component with icon, loading, iconOnly support
// Use buttonVariants only when styling non-button elements as buttons
export { Button, type ButtonProps } from "./components/button";
export { buttonVariants } from "./primitives/button";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  type CardProps,
} from "./primitives/card";
export {
  ItemCard,
  ClickableItemCard,
  type ItemCardProps,
} from "./primitives/item-card";
export { Checkbox } from "./primitives/checkbox";
export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./primitives/collapsible";
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./primitives/dialog";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from "./primitives/dropdown-menu";
export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "./primitives/field";
export { Input } from "./primitives/input";
export { Label } from "./primitives/label";
export { MultiSelect } from "./primitives/multi-select";
export {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
  navigationMenuTriggerStyle,
} from "./primitives/navigation-menu";
export { ScrollArea, ScrollBar } from "./primitives/scroll-area";
export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from "./primitives/select";
export { Separator } from "./primitives/separator";
export { Skeleton } from "./primitives/skeleton";
export { Surface } from "./primitives/surface";
export { Switch } from "./primitives/switch";
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from "./primitives/table";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./primitives/tabs";
export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "./primitives/tooltip";

// Shared Components (custom reusable components)
export { type ItemAction } from "./components/button";
export { ButtonGroup, type ButtonGroupProps } from "./components/ButtonGroup";
/**
 * @deprecated Use ButtonGroup instead. ActionGroup will be removed in a future version.
 */
export { ButtonGroup as ActionGroup } from "./components/ButtonGroup";
/**
 * @deprecated Use ButtonGroupProps instead. ActionGroupProps will be removed in a future version.
 */
export type { ButtonGroupProps as ActionGroupProps } from "./components/ButtonGroup";
export {
  Breadcrumb,
  type BreadcrumbItem,
  type BreadcrumbProps,
} from "./components/Breadcrumb";
export { CollapseHandle } from "./components/CollapseHandle";
export { CollapsibleSection } from "./components/CollapsibleSection";
export { Section, type SectionProps } from "./components/Section";
export { Container } from "./components/Container";
export { EmptyState } from "./components/EmptyState";
export {
  ItemSelector,
  type ItemSelectorProps,
  type SelectableItem,
} from "./components/ItemSelector";
export { Panel, PanelSection } from "./components/Panel";
export { Stack } from "./components/Stack";
export { Toggle } from "./components/Toggle";
export { Spinner, type SpinnerProps } from "./components/Spinner";
export { Tooltip as CustomTooltip } from "./components/Tooltip";
export {
  VirtualTable,
  type VirtualTableProps,
  type VirtualTableColumnConfig,
  type VirtualTableColumn,
  type FetchDataParams,
  type FetchDataResult,
} from "./components/VirtualTable";
export { SectionList, type SectionListProps } from "./components/SectionList";
export {
  ItemList,
  type ItemListProps,
  type ListItem,
} from "./components/ItemList";
export {
  SortableList,
  type SortableListProps,
  type SortableListItem,
} from "./components/SortableList";
export {
  JoinTypeIcon,
  getJoinTypeLabel,
  getJoinTypeDescription,
  type JoinTypeIconProps,
  type JoinType,
} from "./components/JoinTypeIcon";

// Chart Icons (static SVG representations of chart types)
export {
  BarYIcon,
  BarXIcon,
  LineIcon,
  AreaYIcon,
  DotIcon,
  HexbinIcon,
  HeatmapIcon,
  RasterIcon,
  CHART_ICONS,
  getChartIcon,
} from "./components/chart-icons";

// Field Wrappers (primitives + Field component)
export { Input as InputField } from "./fields/input";
export { MultiSelect as MultiSelectField } from "./fields/multi-select";
export { Select as SelectField } from "./fields/select";
