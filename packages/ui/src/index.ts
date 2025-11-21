// Utilities
export { cn } from "./lib/utils";

// Icons
export * from "./lib/icons";
export type { LucideIcon } from "./lib/icons";

// UI Primitives (shadcn/ui components)
export { Alert } from "./primitives/alert";
export { Badge } from "./primitives/badge";
export { Button, buttonVariants } from "./primitives/button";
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./primitives/card";
export { Checkbox } from "./primitives/checkbox";
export { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./primitives/collapsible";
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
export { Field, FieldLabel, FieldDescription } from "./primitives/field";
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
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./primitives/tooltip";

// Shared Components (custom reusable components)
export { ActionGroup, type ActionGroupProps, type ItemAction } from "./components/ActionGroup";
export { Card as CustomCard } from "./components/Card";
export { CollapseHandle } from "./components/CollapseHandle";
export { CollapsibleSection } from "./components/CollapsibleSection";
export { Container } from "./components/Container";
export { EmptyState } from "./components/EmptyState";
export { ItemSelector, type ItemSelectorProps } from "./components/ItemSelector";
export { Panel, PanelSection } from "./components/Panel";
export { Stack } from "./components/Stack";
export { Toggle } from "./components/Toggle";
export { Tooltip as CustomTooltip } from "./components/Tooltip";
