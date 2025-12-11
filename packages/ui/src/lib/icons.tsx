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
// ============================================================================

// Navigation & Layout
export { LuArrowLeft as ArrowLeft };
export { LuArrowRight as ArrowRight };
export { LuArrowUpDown as ArrowUpDown };
export { LuChevronDown as ChevronDown };
export { LuChevronUp as ChevronUp };
export { LuChevronRight as ChevronRight };
export { LuChevronLeft as ChevronLeft };
export { LuChevronsLeft as ChevronsLeft };
export { LuChevronsRight as ChevronsRight };
export { LuChevronsUp as ChevronsUp };
export { LuChevronsDown as ChevronsDown };
export { LuChevronsUpDown as ChevronsUpDown };
export { LuMenu as Menu };
export { LuGripHorizontal as DragHandle };

// Pages & Views
export { LuLayoutDashboard as Dashboard };
export { LuLayoutGrid as Grid };

// Actions
export { LuPlus as Plus };
export { LuPencil as Edit };
export { LuTrash2 as Delete };
export { LuCopy as Copy };
export { LuRefreshCw as Refresh };
export { LuX as Close };
export { LuEye as Eye };
export { LuExternalLink as ExternalLink };
export { LuMerge as Merge };

// Settings & Configuration
export { LuSettings as Settings };
export { LuShield as Shield };
export { LuEllipsisVertical as More };

// Theme & Appearance
export { LuMoon as Moon };
export { LuSun as Sun };

// Data Visualization
export { LuTrendingUp as Chart };
export { LuTable as TableIcon };
export { LuList as List };
export { LuLayers as Layers };

// Data Sources & Files
export { LuDatabase as Database };
export { FiFileText as File };
export { SiNotion as Notion };
export { LuCloud as Cloud };
export { LuFileSpreadsheet as Spreadsheet };
export { LuCalculator as Calculator };

// Brands
export { SiGithub as Github };

// Status & Feedback
export { LuCheck as Check };
export { LuCircleCheck as CheckCircle };
export { LuSquareCheck as CheckSquare };
export { LuCircleAlert as AlertCircle };
export { LuInfo as Info };
export { LuLoader as Loader };
export { LuCircleDot as Pending };

// Data Types
export { LuType as TextType };
export { LuHash as NumberType };
export { LuCalendar as DateType };
export { LuToggleLeft as BooleanType };

// UI Elements
export { LuCircle as Circle };
export { LuDot as Dot };
export { LuCircleDot as DataPoint };

// Utilities
export { LuSparkles as Sparkles };
export { LuLifeBuoy as Help };
export { LuTerminal as Terminal };
export { LuLightbulb as Lightbulb };
export { LuSearch as Search };
export { LuUsers as Users };
