import type { IconType } from "react-icons";
import {
  LuArrowLeft,
  LuArrowRight,
  LuArrowUpDown,
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
  LuCopy,
  LuDatabase,
  LuDot,
  LuExternalLink,
  LuFileSpreadsheet,
  LuEye,
  LuGripHorizontal,
  LuGripVertical,
  LuInfo,
  LuLightbulb,
  LuMerge,
  LuPencil,
  LuHash,
  LuLayers,
  LuLayoutDashboard,
  LuLayoutGrid,
  LuLifeBuoy,
  LuList,
  LuLoader,
  LuMenu,
  LuMoon,
  LuSettings,
  LuShield,
  LuEllipsisVertical,
  LuPlus,
  LuRefreshCw,
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
  LuCloud,
  LuCalculator,
  LuSearch,
} from "react-icons/lu";
import { FiFileText } from "react-icons/fi";
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
export { LuArrowLeft as ArrowLeftIcon };
export { LuArrowRight as ArrowRightIcon };
export { LuArrowUpDown as ArrowUpDownIcon };
export { LuChevronDown as ChevronDownIcon };
export { LuChevronUp as ChevronUpIcon };
export { LuChevronRight as ChevronRightIcon };
export { LuChevronLeft as ChevronLeftIcon };
export { LuChevronsLeft as ChevronsLeftIcon };
export { LuChevronsRight as ChevronsRightIcon };
export { LuChevronsUp as ChevronsUpIcon };
export { LuChevronsDown as ChevronsDownIcon };
export { LuChevronsUpDown as ChevronsUpDownIcon };
export { LuMenu as MenuIcon };
export { LuGripHorizontal as DragHandleIcon };
export { LuGripVertical as DragHandleVerticalIcon };

// Pages & Views
export { LuLayoutDashboard as DashboardIcon };
export { LuLayoutGrid as GridIcon };

// Actions
export { LuPlus as PlusIcon };
export { LuPencil as EditIcon };
export { LuTrash2 as DeleteIcon };
export { LuCopy as CopyIcon };
export { LuRefreshCw as RefreshIcon };
export { LuX as CloseIcon };
export { LuEye as EyeIcon };
export { LuExternalLink as ExternalLinkIcon };
export { LuMerge as MergeIcon };

// Settings & Configuration
export { LuSettings as SettingsIcon };
export { LuShield as ShieldIcon };
export { LuEllipsisVertical as MoreIcon };

// Theme & Appearance
export { LuMoon as DarkModeIcon };
export { LuSun as LightModeIcon };

// Data Visualization
export { LuTrendingUp as ChartIcon };
export { LuTable as TableIcon };
export { LuList as ListIcon };
export { LuLayers as LayersIcon };

// Data Sources & Files
export { LuDatabase as DatabaseIcon };
export { FiFileText as FileIcon };
export { SiNotion as NotionIcon };
export { LuCloud as CloudIcon };
export { LuFileSpreadsheet as SpreadsheetIcon };
export { LuCalculator as CalculatorIcon };

// Brands
export { SiGithub as GithubIcon };

// Status & Feedback
export { LuCheck as CheckIcon };
export { LuCircleCheck as CheckCircleIcon };
export { LuSquareCheck as CheckSquareIcon };
export { LuCircleAlert as AlertCircleIcon };
export { LuInfo as InfoIcon };
export { LuLoader as LoaderIcon };
export { LuCircleDot as PendingIcon };

// Data Types
export { LuType as TextTypeIcon };
export { LuHash as NumberTypeIcon };
export { LuCalendar as DateTypeIcon };
export { LuToggleLeft as BooleanTypeIcon };

// UI Elements
export { LuCircle as CircleIcon };
export { LuDot as DotIcon };
export { LuCircleDot as DataPointIcon };

// Utilities
export { LuSparkles as SparklesIcon };
export { LuLifeBuoy as HelpIcon };
export { LuTerminal as TerminalIcon };
export { LuLightbulb as LightbulbIcon };
export { LuSearch as SearchIcon };
export { LuUsers as UsersIcon };
