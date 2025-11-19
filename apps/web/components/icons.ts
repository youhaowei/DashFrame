import type { IconType } from "react-icons";
import {
  LuArrowUpDown,
  LuCheck,
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
  LuChevronUp,
  LuChevronsDown,
  LuChevronsLeft,
  LuChevronsRight,
  LuChevronsUp,
  LuCircle,
  LuDatabase,
  LuLayers,
  LuLayoutDashboard,
  LuLayoutGrid,
  LuLifeBuoy,
  LuList,
  LuLoader,
  LuMenu,
  LuMoon,
  LuEllipsisVertical,
  LuPlus,
  LuRefreshCw,
  LuSparkles,
  LuSun,
  LuTable,
  LuTrash2,
  LuTrendingUp,
  LuX,
} from "react-icons/lu";
import { FiFileText } from "react-icons/fi";
import { SiNotion } from "react-icons/si";

// Type export - maps to IconType for compatibility
export type LucideIcon = IconType;

// Navigation & Layout
export { LuArrowUpDown as ArrowUpDown };
export { LuChevronDown as ChevronDown };
export { LuChevronDown as ChevronDownIcon };
export { LuChevronUp as ChevronUp };
export { LuChevronUp as ChevronUpIcon };
export { LuChevronRight as ChevronRight };
export { LuChevronRight as ChevronRightIcon };
export { LuChevronLeft as ChevronLeft };
export { LuChevronsLeft as ChevronsLeft };
export { LuChevronsRight as ChevronsRight };
export { LuChevronsUp as ChevronsUp };
export { LuChevronsDown as ChevronsDown };
export { LuLayoutDashboard as Dashboard };
export { LuMenu as Menu };

// Theme & Appearance
export { LuMoon as Moon };
export { LuSun as Sun };
export { LuEllipsisVertical as MoreOptions };

// Content & Data
export { LuTrendingUp as Chart };
export { LuTrendingUp as LineChart };
export { LuTable as Table };
export { LuTable as TableIcon };
export { LuLayoutGrid as Grid };
export { LuList as List };
export { LuLayers as Layers };

// Data Sources & Files
export { LuDatabase as Database };
export { FiFileText as File };
export { SiNotion as Notion };

// UI Elements
export { LuCheck as Check };
export { LuCircle as Dot };
export { LuX as X };
export { LuX as Close };
export { LuX as CloseIcon };
export { LuPlus as Plus };
export { LuTrash2 as Delete };

// Dashboard & Actions
export { LuSparkles as Sparkles };
export { LuRefreshCw as Refresh };
export { LuLifeBuoy as Help };
export { LuLoader as Spinner };

// Backwards compatibility aliases (for gradual migration)
export { LuCheck as CheckIcon };
export { LuCircle as CircleIcon };
export { LuX as XIcon };
export { LuTrash2 as Trash2 };
export { LuRefreshCw as RefreshCw };
export { LuLifeBuoy as LifeBuoy };
export { LuLayoutDashboard as LayoutDashboard };
export { LuLayoutGrid as LayoutGrid };
export { FiFileText as FileText };
export { LuEllipsisVertical as MoreHorizontal };
export { LuTrendingUp as BarChart3 };
export { LuLoader as Loader2 };
