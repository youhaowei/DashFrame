import type { IconType } from "react-icons";
import { FiFileText } from "react-icons/fi";
import {
  LuArrowLeft,
  LuArrowRight,
  LuArrowUpDown,
  LuCalculator,
  LuCalendar,
  LuCheck,
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
  LuChevronUp,
  LuChevronsDown,
  LuChevronsLeft,
  LuChevronsRight,
  LuChevronsUp,
  LuChevronsUpDown,
  LuCircle,
  LuCircleAlert,
  LuCircleCheck,
  LuCircleDot,
  LuCloud,
  LuCopy,
  LuDatabase,
  LuDot,
  LuEllipsisVertical,
  LuExternalLink,
  LuEye,
  LuFileSpreadsheet,
  LuGripHorizontal,
  LuGripVertical,
  LuHash,
  LuInfo,
  LuLayers,
  LuLayoutDashboard,
  LuLayoutGrid,
  LuLifeBuoy,
  LuLightbulb,
  LuList,
  LuLoaderPinwheel,
  LuMenu,
  LuMerge,
  LuMoon,
  LuPencil,
  LuPlus,
  LuRefreshCw,
  LuSearch,
  LuSettings,
  LuShield,
  LuSparkles,
  LuSquareCheck,
  LuSun,
  LuTable,
  LuTerminal,
  LuToggleLeft,
  LuTrash2,
  LuTrendingUp,
  LuType,
  LuUsers,
  LuX,
} from "react-icons/lu";
import { SiGithub, SiNotion } from "react-icons/si";

// Type export - maps to IconType for compatibility (import from "@dashframe/ui/icons")
export type LucideIcon = IconType;

// ============================================================================
// SEMANTIC ICON EXPORTS
// All icons use semantic names that describe their purpose/action,
// not their visual appearance. One icon = one export name.
// All semantic exports end with "Icon" for consistency.
// ============================================================================

// Navigation & Layout
export {
  LuArrowLeft as ArrowLeftIcon,
  LuArrowRight as ArrowRightIcon,
  LuArrowUpDown as ArrowUpDownIcon,
  LuChevronDown as ChevronDownIcon,
  LuChevronLeft as ChevronLeftIcon,
  LuChevronRight as ChevronRightIcon,
  LuChevronUp as ChevronUpIcon,
  LuChevronsDown as ChevronsDownIcon,
  LuChevronsLeft as ChevronsLeftIcon,
  LuChevronsRight as ChevronsRightIcon,
  LuChevronsUpDown as ChevronsUpDownIcon,
  LuChevronsUp as ChevronsUpIcon,
  LuGripHorizontal as DragHandleIcon,
  LuGripVertical as DragHandleVerticalIcon,
  LuMenu as MenuIcon,
};

// Pages & Views
export { LuLayoutDashboard as DashboardIcon, LuLayoutGrid as GridIcon };

// Actions
export {
  LuX as CloseIcon,
  LuCopy as CopyIcon,
  LuTrash2 as DeleteIcon,
  LuPencil as EditIcon,
  LuExternalLink as ExternalLinkIcon,
  LuEye as EyeIcon,
  LuMerge as MergeIcon,
  LuPlus as PlusIcon,
  LuRefreshCw as RefreshIcon,
};

// Settings & Configuration
export {
  LuEllipsisVertical as MoreIcon,
  LuSettings as SettingsIcon,
  LuShield as ShieldIcon,
};

// Theme & Appearance
export { LuMoon as DarkModeIcon, LuSun as LightModeIcon };

// Data Visualization
export {
  LuTrendingUp as ChartIcon,
  LuLayers as LayersIcon,
  LuList as ListIcon,
  LuTable as TableIcon,
};

// Data Sources & Files
export {
  LuCalculator as CalculatorIcon,
  LuCloud as CloudIcon,
  LuDatabase as DatabaseIcon,
  FiFileText as FileIcon,
  SiNotion as NotionIcon,
  LuFileSpreadsheet as SpreadsheetIcon,
};

// Brands
export { SiGithub as GithubIcon };

// Status & Feedback
export {
  LuCircleAlert as AlertCircleIcon,
  LuCircleCheck as CheckCircleIcon,
  LuCheck as CheckIcon,
  LuSquareCheck as CheckSquareIcon,
  LuInfo as InfoIcon,
  LuLoaderPinwheel as LoaderIcon,
  LuCircleDot as PendingIcon,
};

// Data Types
export {
  LuToggleLeft as BooleanTypeIcon,
  LuCalendar as DateTypeIcon,
  LuHash as NumberTypeIcon,
  LuType as TextTypeIcon,
};

// UI Elements
export {
  LuCircle as CircleIcon,
  LuCircleDot as DataPointIcon,
  LuDot as DotIcon,
};

// Utilities
export {
  LuLifeBuoy as HelpIcon,
  LuLightbulb as LightbulbIcon,
  LuSearch as SearchIcon,
  LuSparkles as SparklesIcon,
  LuTerminal as TerminalIcon,
  LuUsers as UsersIcon,
};
