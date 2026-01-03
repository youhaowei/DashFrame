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
export { GeistMono, GeistSans } from "./lib/fonts";

// Icons
export * from "./lib/icons";
export type { LucideIcon } from "./lib/icons";

// UI Primitives (shadcn/ui components)
export { Alert, AlertDescription, AlertTitle } from "./primitives/alert";
export { Badge } from "./primitives/badge";
// Button - High-level component with icon, loading, iconOnly support
// Use buttonVariants only when styling non-button elements as buttons
export { Button, type ButtonProps } from "./components/button";
export { buttonVariants } from "./primitives/button";
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  type CardProps,
} from "./primitives/card";
export { Checkbox } from "./primitives/checkbox";
export {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./primitives/collapsible";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "./primitives/dialog";
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./primitives/dropdown-menu";
export {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "./primitives/field";
export { Input } from "./primitives/input";
export {
  ClickableItemCard,
  ItemCard,
  type ItemCardProps,
} from "./primitives/item-card";
export { Label } from "./primitives/label";
export { MultiSelect } from "./primitives/multi-select";
export {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuIndicator,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuViewport,
  navigationMenuTriggerStyle,
} from "./primitives/navigation-menu";
export { ScrollArea, ScrollBar } from "./primitives/scroll-area";
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./primitives/select";
export { Separator } from "./primitives/separator";
export { Skeleton } from "./primitives/skeleton";
export { Surface } from "./primitives/surface";
export { Switch } from "./primitives/switch";
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./primitives/table";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "./primitives/tabs";
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
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
export {
  Breadcrumb,
  type BreadcrumbItem,
  type BreadcrumbProps,
} from "./components/Breadcrumb";
export type { ButtonGroupProps as ActionGroupProps } from "./components/ButtonGroup";
export { CollapseHandle } from "./components/CollapseHandle";
export { CollapsibleSection } from "./components/CollapsibleSection";
export { Container } from "./components/Container";
export { EmptyState } from "./components/EmptyState";
export {
  ItemList,
  type ItemListProps,
  type ListItem,
} from "./components/ItemList";
export {
  ItemSelector,
  type ItemSelectorProps,
  type SelectableItem,
} from "./components/ItemSelector";
export {
  JoinTypeIcon,
  getJoinTypeDescription,
  getJoinTypeLabel,
  type JoinType,
  type JoinTypeIconProps,
} from "./components/JoinTypeIcon";
export { Panel, PanelSection } from "./components/Panel";
export { Section, type SectionProps } from "./components/Section";
export { SectionList, type SectionListProps } from "./components/SectionList";
export {
  SortableList,
  type SortableListItem,
  type SortableListProps,
} from "./components/SortableList";
export { Spinner, type SpinnerProps } from "./components/Spinner";
export { Stack } from "./components/Stack";
export { Toggle } from "./components/Toggle";
export { Tooltip as CustomTooltip } from "./components/Tooltip";
export {
  VirtualTable,
  type FetchDataParams,
  type FetchDataResult,
  type VirtualTableColumn,
  type VirtualTableColumnConfig,
  type VirtualTableProps,
} from "./components/VirtualTable";

// Chart Icons (static SVG representations of chart types)
export {
  AreaYIcon,
  BarXIcon,
  BarYIcon,
  CHART_ICONS,
  DotIcon,
  HeatmapIcon,
  HexbinIcon,
  LineIcon,
  RasterIcon,
  getChartIcon,
} from "./components/chart-icons";

// Field Wrappers (primitives + Field component)
export { Input as InputField } from "./fields/input";
export { MultiSelect as MultiSelectField } from "./fields/multi-select";
export { Select as SelectField } from "./fields/select";
