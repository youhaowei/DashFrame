"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  RefreshCw,
  Trash2,
  ChevronDown,
  CheckIcon,
  ArrowUpDown,
  Input,
  Label,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  Panel,
  Toggle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Select as SelectPrimitive,
  SelectContent,
  SelectTrigger,
  SelectValue,
  FieldLabel,
  Badge,
  SelectField,
} from "@dashframe/ui";
import { computeInsightDataFrame } from "@/lib/insights/compute-preview";
import { Copy, Info, Hash, Calendar, Type } from "@dashframe/ui/icons";
import { toast } from "sonner";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import {
  useDataFramesStore,
  type DataFrameEntry,
} from "@/lib/stores/dataframes-store";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { useDataFrameData } from "@/hooks/useDataFrameData";
import type {
  Visualization,
  VisualizationType,
  VisualizationEncoding,
  AxisType,
} from "@/lib/stores/types";
import { trpc } from "@/lib/trpc/Provider";
import { autoSelectEncoding } from "@/lib/visualizations/auto-select";
import { analyzeDataFrame, type ColumnAnalysis } from "@dashframe/dataframe";
import * as RadixSelect from "@radix-ui/react-select";

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  isFooter?: boolean;
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
  className,
  isFooter = false,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn(!isFooter && "border-border/40 border-b", className)}
    >
      <CollapsibleTrigger className="hover:bg-muted/30 flex w-full items-center justify-between px-4 py-3 text-left transition-colors">
        <h3 className="text-foreground text-sm font-semibold">{title}</h3>
        <ChevronDown
          className={cn(
            "text-muted-foreground h-4 w-4 transition-transform duration-200",
            // Footer collapses upward, so flip the logic
            isFooter ? !isOpen && "rotate-180" : isOpen && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 py-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Get a warning message for a column selection based on analysis and context
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complex by design: evaluates multiple warning conditions based on chart type, axis, and data characteristics
function getColumnWarning(
  columnName: string | undefined,
  axis: "x" | "y",
  chartType: VisualizationType,
  analysis: ColumnAnalysis[],
  otherAxisColumn?: string,
): { message: string; reason: string } | null {
  if (!columnName) return null;

  const col = analysis.find((a) => a.columnName === columnName);
  if (!col) return null;

  // Helper: check if a column name looks like an identifier
  const looksLikeId = (name: string) => {
    const lower = name.toLowerCase();
    return (
      lower === "id" ||
      lower === "_rowindex" ||
      lower.endsWith("_id") ||
      lower.endsWith("id") ||
      lower.startsWith("_row")
    );
  };

  const isIdentifier =
    col.category === "identifier" ||
    looksLikeId(columnName) ||
    col.category === "uuid";
  const isReference =
    col.category === "reference" ||
    col.category === "url" ||
    col.category === "email";
  const isNumerical = col.category === "numerical";
  const isTemporal = col.category === "temporal";
  const isCategorical = col.category === "categorical";

  // 1. General Warnings (Apply to all charts)

  // Warn if X and Y are the same column
  if (otherAxisColumn && columnName === otherAxisColumn) {
    return {
      message: "Same column on both axes",
      reason:
        "Comparing a column to itself usually doesn't show meaningful insights.",
    };
  }

  // 2. Y-Axis Specific Logic (Vertical Axis - usually the "Measure")
  if (axis === "y") {
    // Identifiers and References are almost never good Y-axis candidates
    if (isIdentifier || isReference) {
      return {
        message: "Not a measurable value",
        reason:
          "This column contains unique labels or IDs, which cannot be aggregated (sum/avg) meaningfully.",
      };
    }

    // Most charts (Bar, Line, Area, Scatter) require a numerical Y-axis
    if (["bar", "line", "area", "scatter"].includes(chartType)) {
      if (!isNumerical) {
        return {
          message: "Numerical column recommended",
          reason: `${chartType.charAt(0).toUpperCase() + chartType.slice(1)} charts need numerical values on the Y-axis to show height, trends, or position.`,
        };
      }
    }
  }

  // 3. X-Axis Specific Logic (Horizontal Axis - usually the "Dimension")
  if (axis === "x") {
    // Scatter plots need numerical X-axis
    if (chartType === "scatter") {
      if (!isNumerical) {
        return {
          message: "Numerical column recommended",
          reason:
            "Scatter plots need numerical values on both axes to show correlations between two measures.",
        };
      }
    }

    // Line/Area charts prefer Temporal or Numerical (continuous)
    if (chartType === "line" || chartType === "area") {
      if (isCategorical && col.cardinality > 20) {
        return {
          message: "Too many categories",
          reason:
            "Line charts with many categories can look cluttered. Consider a Bar chart or filtering.",
        };
      }
      if (!isTemporal && !isNumerical && !isCategorical) {
        return {
          message: "Ordered column recommended",
          reason: "Line charts work best with time-series or continuous data.",
        };
      }
    }

    // Bar charts prefer Categorical or Temporal (discrete buckets)
    if (chartType === "bar") {
      if (isNumerical && col.cardinality > 20) {
        return {
          message: "Many unique values",
          reason:
            "A numerical X-axis with many values might be better suited for a Histogram or Scatter plot.",
        };
      }
    }
  }

  return null;
}

/**
 * Create column options ranked by suitability with inline warning indicators
 */
function getRankedColumnOptions(
  columns: string[],
  axis: "x" | "y",
  chartType: VisualizationType,
  analysis: ColumnAnalysis[],
  otherAxisColumn?: string,
): Array<{
  label: string;
  value: string;
  score: number;
  warning?: { message: string; reason: string };
}> {
  return columns
    .map(
      // eslint-disable-next-line sonarjs/cognitive-complexity -- Complex by design: ranks columns based on multiple heuristics and chart type
      (col) => {
        const warning = getColumnWarning(
          col,
          axis,
          chartType,
          analysis,
          otherAxisColumn,
        );
        const colAnalysis = analysis.find((a) => a.columnName === col);

        if (!colAnalysis)
          return {
            label: col,
            value: col,
            score: 0,
            warning: warning || undefined,
          };

        const isNumerical = colAnalysis.category === "numerical";
        const isTemporal = colAnalysis.category === "temporal";
        const isCategorical = colAnalysis.category === "categorical";
        const isIdentifier =
          colAnalysis.category === "identifier" ||
          colAnalysis.category === "uuid";

        // Base Score
        let score = 50;

        // --- Y-AXIS SCORING ---
        if (axis === "y") {
          // Y-axis is almost always the "Measure" (Numerical)
          if (isNumerical) score += 100;

          // Penalize non-numericals heavily for standard charts
          if (
            !isNumerical &&
            ["bar", "line", "area", "scatter"].includes(chartType)
          ) {
            score -= 50;
          }

          // Identifiers are terrible Y-axis candidates
          if (isIdentifier) score -= 100;
        }

        // --- X-AXIS SCORING ---
        else if (axis === "x") {
          if (chartType === "bar") {
            // Bar charts love Categories
            if (isCategorical) score += 80;
            if (isTemporal) score += 60; // Time is also good for bars (e.g. monthly sales)
            if (isNumerical) score -= 20; // Numerical X is usually for histograms
          } else if (chartType === "line" || chartType === "area") {
            // Line charts love Time
            if (isTemporal) score += 100;
            if (isNumerical) score += 60; // Continuous X is good
            if (isCategorical) score += 20; // Categories ok if low cardinality
          } else if (chartType === "scatter") {
            // Scatter needs Numerical X
            if (isNumerical) score += 100;
            if (!isNumerical) score -= 50;
          }
        }

        // --- GENERAL PENALTIES ---

        // Severe penalty for using the same column on both axes
        if (otherAxisColumn && col === otherAxisColumn) {
          score -= 200;
        }

        // Penalty for existing warnings (ensure warned items drop to bottom)
        if (warning) {
          score -= 50;
        }

        // Format label with warning indicator if needed (though UI handles this separately now)
        const label = col;

        return { label, value: col, score, warning: warning || undefined };
      },
    )
    .sort((a, b) => b.score - a.score); // Sort by score descending
}

/**
 * Provenance Summary Component - Shows insight name, source, DataFrame stats, and refresh controls
 */
interface ProvenanceSummaryProps {
  insight:
  | {
    id: string;
    name: string;
    lastComputedAt?: number;
    filters?: {
      excludeNulls?: boolean;
      limit?: number;
      orderBy?: { fieldOrMetricId: string; direction: "asc" | "desc" };
    };
  }
  | null
  | undefined;
  dataFrameEntry: DataFrameEntry | null;
  source: { name: string } | null;
  dataTable: { name: string } | null;
  isRefreshable: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  refreshError?: string;
  dataTableFields?: Array<{ id: string; name: string }>;
  insightMetrics?: Array<{ id: string; name: string }>;
}

function ProvenanceSummary({
  insight,
  dataFrameEntry,
  source,
  dataTable,
  isRefreshable,
  isRefreshing,
  onRefresh,
  refreshError,
  dataTableFields = [],
  insightMetrics = [],
}: ProvenanceSummaryProps) {
  const rowCount = dataFrameEntry?.rowCount ?? 0;
  const colCount = dataFrameEntry?.columnCount ?? 0;
  const lastRefreshed = dataFrameEntry?.createdAt;

  // Determine freshness indicator
  const isStale =
    insight?.lastComputedAt && lastRefreshed
      ? insight.lastComputedAt > lastRefreshed
      : false;

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return "Not yet refreshed";
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return "Just now";
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  // Build filter description
  const getFilterDescription = () => {
    if (!insight?.filters) return null;
    const { excludeNulls, limit, orderBy } = insight.filters;
    const parts: string[] = [];

    if (excludeNulls) {
      parts.push("Excludes nulls");
    }

    if (limit) {
      parts.push(`Top ${limit}`);
    }

    if (orderBy) {
      // Find field or metric name
      const field = dataTableFields.find(
        (f) => f.id === orderBy.fieldOrMetricId,
      );
      const metric = insightMetrics.find(
        (m) => m.id === orderBy.fieldOrMetricId,
      );
      const name = field?.name || metric?.name || "unknown";
      parts.push(`Sorted by ${name} (${orderBy.direction})`);
    }

    return parts.length > 0 ? parts.join(" • ") : null;
  };

  const filterDescription = getFilterDescription();

  return (
    <div className="border-border/40 space-y-3 border-b px-4 py-3">
      {/* Insight name with link */}
      <div className="space-y-1">
        <Label className="text-muted-foreground text-xs font-medium">
          Insight
        </Label>
        {insight ? (
          <Link
            href={`/insights/${insight.id}`}
            className="text-primary text-sm font-medium hover:underline"
          >
            {insight.name}
          </Link>
        ) : (
          <p className="text-muted-foreground text-sm">Unknown insight</p>
        )}
      </div>

      {/* Source and table badges */}
      {source && dataTable && (
        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs font-medium">
            Data source
          </Label>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="text-xs">
              {source.name || "Unknown source"}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {dataTable.name || "Unknown table"}
            </Badge>
          </div>
        </div>
      )}

      {/* DataFrame stats */}
      <div className="space-y-1">
        <Label className="text-muted-foreground text-xs font-medium">
          Data
        </Label>
        <p className="text-foreground text-sm">
          <span className="font-medium">{rowCount.toLocaleString()}</span> rows
          • <span className="font-medium">{colCount}</span> columns
        </p>
      </div>

      {/* Last refreshed timestamp */}
      <div className="space-y-1">
        <Label className="text-muted-foreground text-xs font-medium">
          Last refreshed
        </Label>
        <div className="flex items-center justify-between">
          <p className="text-foreground text-sm">{formatTime(lastRefreshed)}</p>
          {isStale && (
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-50 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
            >
              Stale
            </Badge>
          )}
        </div>
      </div>

      {/* Filters display (if any) */}
      {filterDescription && (
        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs font-medium">
            Active filters
          </Label>
          <p className="text-foreground text-sm">{filterDescription}</p>
        </div>
      )}

      {/* Refresh button */}
      {isRefreshable && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
          {isRefreshing ? "Refreshing..." : "Refresh data"}
        </Button>
      )}

      {refreshError && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border p-2 text-xs">
          {refreshError}
        </div>
      )}
    </div>
  );
}

/**
 * Metrics Strip Component - Shows available metrics with aggregation badges
 */
interface MetricItem {
  id: string;
  name: string;
  aggregation: string;
  columnName?: string;
}

interface MetricsStripProps {
  insight: { id: string; metrics?: MetricItem[] };
}

function MetricsStrip({ insight }: MetricsStripProps) {
  const metrics = insight?.metrics ?? [];

  if (metrics.length === 0) {
    return (
      <div className="bg-muted/30 rounded-md border p-3 text-center">
        <p className="text-foreground text-xs font-medium">
          No metrics defined
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          Metrics help you aggregate and summarize data.
        </p>
        <Link
          href={`/insights/${insight.id}`}
          className="text-primary mt-2 inline-block text-xs font-medium hover:underline"
        >
          Add metrics in insight editor →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {metrics.map((metric) => (
        <div
          key={metric.id}
          className="bg-muted/20 flex items-center justify-between rounded-md border px-3 py-2"
        >
          <span className="text-foreground text-sm">{metric.name}</span>
          <Badge variant="secondary" className="font-mono text-xs">
            {metric.aggregation}
            {metric.columnName && `(${metric.columnName})`}
          </Badge>
        </div>
      ))}
    </div>
  );
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- Main visualization controls component with multiple conditional rendering paths
export function VisualizationControls() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const [isHydrated, setIsHydrated] = useState(false);

  // Inline state access so Zustand can track dependencies properly
  const activeViz = useVisualizationsStore((state) => {
    if (!state.activeId) return null;
    return state.visualizations.get(state.activeId) ?? null;
  });

  // Wait for client-side hydration before rendering content from stores
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const updateEncoding = useVisualizationsStore(
    (state) => state.updateEncoding,
  );
  const update = useVisualizationsStore((state) => state.update);
  const remove = useVisualizationsStore((state) => state.remove);
  const getDataFrameEntry = useDataFramesStore((state) => state.getEntry);
  const getInsight = useInsightsStore((state) => state.getInsight);

  const queryNotionDatabase = trpc.notion.queryDatabase.useMutation();

  // Load DataFrame data asynchronously from IndexedDB
  const { data: dataFrameData, isLoading: isLoadingData } = useDataFrameData(
    activeViz?.source.dataFrameId,
  );

  // Get DataFrame entry for metadata
  const dataFrameEntry = activeViz?.source.dataFrameId
    ? (getDataFrameEntry(activeViz.source.dataFrameId) ?? null)
    : null;

  // Don't render anything until hydrated to avoid hydration mismatch
  if (!isHydrated || isLoadingData) {
    return (
      <div className="text-muted-foreground flex h-full w-full items-center justify-center p-6 text-sm">
        Loading controls…
      </div>
    );
  }

  if (!activeViz) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="border-border/70 bg-background/40 w-full rounded-2xl border border-dashed p-8 text-center">
          <p className="text-foreground text-base font-medium">
            No visualization selected
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            Choose an existing visualization or create a new one to configure
            settings.
          </p>
        </div>
      </div>
    );
  }

  // Get insight - try direct reference first, fallback to dataFrame entry metadata
  let insight = activeViz.source.insightId
    ? getInsight(activeViz.source.insightId)
    : null;

  // Fallback: if no direct insight reference, try to find via dataFrame entry
  if (!insight && dataFrameEntry?.insightId) {
    insight = getInsight(dataFrameEntry.insightId);
  }

  if (!dataFrameEntry || !dataFrameData) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="border-destructive/40 bg-destructive/10 rounded-2xl border px-4 py-6 text-center">
          <p className="text-destructive text-sm font-medium">
            Unable to load DataFrame
          </p>
          <p className="text-destructive/80 mt-2 text-xs">
            Please refresh your data source or recreate this visualization.
          </p>
        </div>
      </div>
    );
  }

  const columns = (dataFrameData.columns || []).map(
    (col: { name: string }) => col.name,
  );
  const numericColumns = (dataFrameData.columns || [])
    .filter((col: { type: string }) => col.type === "number")
    .map((col: { name: string }) => col.name);

  // Analyze columns for warnings
  const columnAnalysis = analyzeDataFrame(
    dataFrameData.rows,
    dataFrameData.columns,
  );

  const hasNumericColumns = numericColumns.length > 0;

  // Determine if source is refreshable
  let isRefreshable = false;
  let source = null;
  let dataTable = null;

  if (activeViz.source.insightId && insight?.baseTable) {
    const allSources = useDataSourcesStore.getState().getAll();
    for (const src of allSources) {
      if (src.type === "notion") {
        const table = src.dataTables?.get(insight.baseTable.tableId);
        if (table) {
          source = src;
          dataTable = table;
          isRefreshable = true;
          break;
        }
      }
    }
  }

  // Only allow table visualization if there are no numeric columns
  const visualizationTypeOptions = hasNumericColumns
    ? [
      { label: "Table", value: "table" },
      { label: "Bar Chart", value: "bar" },
      { label: "Line Chart", value: "line" },
      { label: "Scatter Plot", value: "scatter" },
      { label: "Area Chart", value: "area" },
    ]
    : [{ label: "Table", value: "table" }];

  const columnOptions = columns.map((col: string) => ({
    label: col,
    value: col,
  }));

  // Get ranked options for X and Y axes with inline warnings
  const xAxisOptions = getRankedColumnOptions(
    columns,
    "x",
    activeViz.visualizationType,
    columnAnalysis,
    activeViz.encoding?.y,
  );

  const yAxisOptions = getRankedColumnOptions(
    columns,
    "y",
    activeViz.visualizationType,
    columnAnalysis,
    activeViz.encoding?.x,
  );

  const handleTypeChange = (type: string) => {
    const newType = type as VisualizationType;

    // Auto-select axes using shared utility (pass insight to prefer metrics)
    // Add empty fieldIds to make LoadedDataFrameData compatible with DataFrameData
    const dataFrameDataWithFieldIds = {
      ...dataFrameData,
      fieldIds: [] as string[],
    };
    const newEncoding = autoSelectEncoding(
      newType,
      dataFrameDataWithFieldIds,
      undefined, // fields - not available in this context yet
      activeViz.encoding,
      insight || undefined, // Pass insight to prioritize metrics for Y-axis
    );

    // Update both type and encoding
    update(activeViz.id, {
      visualizationType: newType,
      encoding: newEncoding,
    });
  };

  const handleEncodingChange = (
    field: keyof VisualizationEncoding,
    value: string,
  ) => {
    if (!activeViz) return;

    const newEncoding = { ...activeViz.encoding, [field]: value };

    // Auto-detect type if changing x or y
    if (field === "x" || field === "y") {
      const colAnalysis = columnAnalysis.find((c) => c.columnName === value);
      const typeField = field === "x" ? "xType" : "yType";

      if (colAnalysis) {
        let axisType: "quantitative" | "nominal" | "ordinal" | "temporal" =
          "nominal";

        if (colAnalysis.category === "numerical") {
          axisType = "quantitative";
        } else if (colAnalysis.category === "temporal") {
          axisType = "temporal";
        }

        // Override: Identifiers should default to categorical (nominal) even if numeric
        if (
          colAnalysis.category === "identifier" ||
          colAnalysis.category === "uuid"
        ) {
          axisType = "nominal";
        }

        newEncoding[typeField] = axisType;
      }
    }

    updateEncoding(activeViz.id, newEncoding);
  };

  // Helper to check if type toggle should be shown (mainly for numerical columns)
  const canToggleType = (columnName?: string) => {
    if (!columnName) return false;
    const col = columnAnalysis.find((c) => c.columnName === columnName);
    // Only allow toggling for numerical or temporal columns
    // Strings are always categorical, so no toggle needed
    return (
      col?.category === "numerical" ||
      col?.category === "temporal" ||
      col?.category === "identifier"
    );
  };

  // Helper to determine the effective axis type (defaulting intelligently if not set)
  const getEffectiveAxisType = (
    columnName: string | undefined,
    currentType: AxisType | undefined,
  ): string => {
    if (currentType) return currentType;
    if (!columnName) return "nominal";

    const col = columnAnalysis.find((c) => c.columnName === columnName);
    if (!col) return "nominal";

    if (col.category === "numerical") return "quantitative";
    if (col.category === "temporal") return "temporal";
    return "nominal";
  };

  // Helper to build toggle options for axis type based on column analysis
  const getAxisTypeToggleOptions = (
    columnName: string | undefined,
    currentType: AxisType | undefined,
  ) => {
    const effectiveType = getEffectiveAxisType(columnName, currentType);
    const col = columnAnalysis.find((c) => c.columnName === columnName);
    const isTemporalColumn = col?.category === "temporal";
    const showTemporal =
      effectiveType === "temporal" ||
      (effectiveType === "nominal" && isTemporalColumn);

    const options = [];

    if (showTemporal) {
      options.push({
        value: "temporal" as const,
        icon: <Calendar className="h-3 w-3" />,
        tooltip: "Temporal",
        ariaLabel: "Temporal",
      });
    } else {
      options.push({
        value: "quantitative" as const,
        icon: <Hash className="h-3 w-3" />,
        tooltip: "Continuous",
        ariaLabel: "Continuous",
      });
    }

    options.push({
      value: "nominal" as const,
      icon: <Type className="h-3 w-3" />,
      tooltip: "Categorical",
      ariaLabel: "Categorical",
    });

    return options;
  };

  const handleDelete = () => {
    if (confirm(`Are you sure you want to delete "${activeViz.name}"?`)) {
      remove(activeViz.id);
    }
  };

  const handleDuplicate = () => {
    // Clone the visualization with a new ID and name
    const newId = crypto.randomUUID() as string;
    const clonedViz: Visualization = {
      ...activeViz,
      id: newId,
      name: `${activeViz.name} (copy)`,
      createdAt: Date.now(),
    };

    const store = useVisualizationsStore.getState();
    store.visualizations.set(clonedViz.id, clonedViz);
    store.setActive(clonedViz.id);
    // Trigger store update to persist
    store.update(clonedViz.id, {});

    toast.success(`Duplicated "${activeViz.name}"`);
  };

  const handleRefresh = async () => {
    if (!activeViz.source.insightId) return;

    setRefreshError(undefined);
    const toastId = toast.loading("Refreshing data from Notion...");
    setIsRefreshing(true);

    try {
      // Get the insight
      const insight = getInsight(activeViz.source.insightId);
      if (!insight || !insight.baseTable) {
        throw new Error("Insight not found");
      }

      // Get the DataTable from the insight's base table
      const dataTableId = insight.baseTable.tableId;
      if (!dataTableId) throw new Error("No DataTable found for insight");

      // Get the DataTable to find which data source it belongs to
      // We need to search all data sources to find the one containing this DataTable
      const allSources = useDataSourcesStore.getState().getAll();
      let foundDataSource = null;
      let foundDataTable = null;

      for (const source of allSources) {
        if (source.type === "notion") {
          const table = source.dataTables?.get(dataTableId);
          if (table) {
            foundDataSource = source;
            foundDataTable = table;
            break;
          }
        }
      }

      if (!foundDataSource || !foundDataTable) {
        throw new Error("Notion data source not found");
      }

      // Fetch fresh data from Notion (returns raw DataFrame)
      const rawDataFrame = await queryNotionDatabase.mutateAsync({
        apiKey: foundDataSource.apiKey, // From NotionDataSource
        databaseId: foundDataTable.table, // From DataTable
        selectedPropertyIds: foundDataTable.fields.map(
          (f: { id: string }) => f.id,
        ), // Use field IDs
      });

      // Apply insight aggregation to raw data
      const aggregatedData = computeInsightDataFrame(
        insight,
        foundDataTable,
        rawDataFrame,
      );

      // NOTE: Implement refresh functionality with new IndexedDB storage (tracked)
      // This requires converting DataFrameData to Arrow buffer and creating a DataFrame class.
      // For now, we just show that data was fetched but don't persist it.
      // Future implementation should:
      // 1. Convert aggregatedData to Arrow buffer using tableToArrow
      // 2. Create DataFrame using DataFrame.create()
      // 3. Call addDataFrame to persist
      // 4. Update visualization source with new dataFrameId
      console.log("Refreshed data:", {
        rows: aggregatedData.rows.length,
        columns: aggregatedData.columns?.length ?? 0,
      });

      toast.success(
        "Data refreshed (preview only - persistence not yet implemented)",
        { id: toastId },
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      setRefreshError(errorMsg);
      console.error("Failed to refresh data:", error);
      toast.error(`Failed to refresh: ${errorMsg}`, {
        id: toastId,
        description: "Please check your Notion API key and try again.",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const actionsFooter = (
    <CollapsibleSection title="Actions" defaultOpen={false} isFooter={true}>
      <div className="space-y-2">
        {isRefreshable && (
          <Button
            variant="outline"
            className="w-full"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
            {isRefreshing ? "Refreshing..." : "Refresh data"}
          </Button>
        )}
        <Button variant="outline" className="w-full" onClick={handleDuplicate}>
          <Copy className="mr-2 h-4 w-4" />
          Duplicate
        </Button>
        <Button variant="destructive" className="w-full" onClick={handleDelete}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
      </div>
    </CollapsibleSection>
  );

  return (
    <Panel footer={actionsFooter}>
      {/* Name field at top */}
      <div className="border-border/40 border-b px-4 pb-3 pt-4">
        <Label
          htmlFor="viz-name"
          className="text-muted-foreground text-xs font-medium"
        >
          Name
        </Label>
        <Input
          id="viz-name"
          value={activeViz.name}
          onChange={(e) => update(activeViz.id, { name: e.target.value })}
          className="mt-1.5"
        />
      </div>

      {/* NEW: Provenance Summary (always visible) */}
      <ProvenanceSummary
        insight={insight}
        dataFrameEntry={dataFrameEntry}
        source={source}
        dataTable={dataTable}
        isRefreshable={isRefreshable}
        isRefreshing={isRefreshing}
        onRefresh={handleRefresh}
        refreshError={refreshError}
        dataTableFields={dataTable?.fields?.map((f) => ({
          id: f.id,
          name: f.name,
        }))}
        insightMetrics={insight?.metrics?.map((m) => ({
          id: m.id,
          name: m.name,
        }))}
      />

      {/* Encodings Section */}
      <CollapsibleSection title="Encodings" defaultOpen={true}>
        <div className="space-y-3">
          {/* X Axis with warning icon next to label */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FieldLabel>X Axis</FieldLabel>
                {(() => {
                  const selectedOption = xAxisOptions.find(
                    (opt) => opt.value === activeViz.encoding?.x,
                  );
                  return selectedOption?.warning ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 cursor-help text-amber-500" />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="z-100 max-w-xs">
                        <p className="text-xs font-semibold">
                          {selectedOption.warning.message}
                        </p>
                        <p className="mt-0.5 text-xs opacity-90">
                          {selectedOption.warning.reason}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  ) : null;
                })()}
              </div>

              {/* Axis Type Toggle */}
              {canToggleType(activeViz.encoding?.x) && (
                <Toggle
                  value={
                    getEffectiveAxisType(
                      activeViz.encoding?.x,
                      activeViz.encoding?.xType,
                    ) as "quantitative" | "nominal" | "temporal"
                  }
                  options={getAxisTypeToggleOptions(
                    activeViz.encoding?.x,
                    activeViz.encoding?.xType,
                  )}
                  onValueChange={(val) => {
                    if (!activeViz.encoding) return;
                    updateEncoding(activeViz.id, {
                      ...activeViz.encoding,
                      xType: val as AxisType,
                    });
                  }}
                  size="sm"
                  variant="outline"
                />
              )}
            </div>
            <SelectPrimitive
              value={activeViz.encoding?.x || undefined}
              onValueChange={(value) => handleEncodingChange("x", value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select column..." />
              </SelectTrigger>
              <SelectContent>
                {xAxisOptions.map((option) => (
                  <RadixSelect.Item
                    key={option.value}
                    value={option.value}
                    className={cn(
                      "focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none",
                      option.warning
                        ? "data-highlighted:text-amber-600 dark:data-highlighted:text-amber-400 text-amber-600 focus:text-amber-600 dark:text-amber-400 dark:focus:text-amber-400"
                        : "",
                    )}
                  >
                    <span className="absolute right-2 flex size-3.5 items-center justify-center">
                      <RadixSelect.ItemIndicator>
                        <CheckIcon className="size-4" />
                      </RadixSelect.ItemIndicator>
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <RadixSelect.ItemText>
                        {option.value}
                      </RadixSelect.ItemText>
                      {option.warning && (
                        <span className="text-muted-foreground text-[10px] font-normal">
                          {option.warning.message}
                        </span>
                      )}
                    </div>
                  </RadixSelect.Item>
                ))}
              </SelectContent>
            </SelectPrimitive>
          </div>

          {/* Swap Axes Button */}
          <div className="relative z-10 -my-1 flex justify-center">
            <Button
              variant="ghost"
              size="icon"
              className="bg-background shadow-xs hover:bg-muted text-muted-foreground h-6 w-6 rounded-full border"
              onClick={() => {
                if (!activeViz.encoding) return;
                updateEncoding(activeViz.id, {
                  ...activeViz.encoding,
                  x: activeViz.encoding.y,
                  y: activeViz.encoding.x,
                  // Also swap types
                  xType: activeViz.encoding.yType,
                  yType: activeViz.encoding.xType,
                });
              }}
              title="Swap X and Y axes"
            >
              <ArrowUpDown className="h-3 w-3" />
            </Button>
          </div>

          {/* Y Axis with warning icon next to label */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FieldLabel>Y Axis</FieldLabel>
                {(() => {
                  const selectedOption = yAxisOptions.find(
                    (opt) => opt.value === activeViz.encoding?.y,
                  );
                  return selectedOption?.warning ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 cursor-help text-amber-500" />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="z-100 max-w-xs">
                        <p className="text-xs font-semibold">
                          {selectedOption.warning.message}
                        </p>
                        <p className="mt-0.5 text-xs opacity-90">
                          {selectedOption.warning.reason}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  ) : null;
                })()}
              </div>

              {/* Axis Type Toggle */}
              {canToggleType(activeViz.encoding?.y) && (
                <Toggle
                  value={
                    getEffectiveAxisType(
                      activeViz.encoding?.y,
                      activeViz.encoding?.yType,
                    ) as "quantitative" | "nominal" | "temporal"
                  }
                  options={getAxisTypeToggleOptions(
                    activeViz.encoding?.y,
                    activeViz.encoding?.yType,
                  )}
                  onValueChange={(val) => {
                    if (!activeViz.encoding) return;
                    updateEncoding(activeViz.id, {
                      ...activeViz.encoding,
                      yType: val,
                    });
                  }}
                  size="sm"
                  variant="outline"
                />
              )}
            </div>
            <SelectPrimitive
              value={activeViz.encoding?.y || undefined}
              onValueChange={(value) => handleEncodingChange("y", value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select column..." />
              </SelectTrigger>
              <SelectContent>
                {yAxisOptions.map((option) => (
                  <RadixSelect.Item
                    key={option.value}
                    value={option.value}
                    className={cn(
                      "focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none",
                      option.warning
                        ? "data-highlighted:text-amber-600 dark:data-highlighted:text-amber-400 text-amber-600 focus:text-amber-600 dark:text-amber-400 dark:focus:text-amber-400"
                        : "",
                    )}
                  >
                    <span className="absolute right-2 flex size-3.5 items-center justify-center">
                      <RadixSelect.ItemIndicator>
                        <CheckIcon className="size-4" />
                      </RadixSelect.ItemIndicator>
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <RadixSelect.ItemText>
                        {option.value}
                      </RadixSelect.ItemText>
                      {option.warning && (
                        <span className="text-muted-foreground text-[10px] font-normal">
                          {option.warning.message}
                        </span>
                      )}
                    </div>
                  </RadixSelect.Item>
                ))}
              </SelectContent>
            </SelectPrimitive>
          </div>

          <SelectField
            label="Color (optional)"
            value={activeViz.encoding?.color || ""}
            onChange={(value) => handleEncodingChange("color", value)}
            onClear={() => handleEncodingChange("color", "")}
            options={columnOptions}
            placeholder="None"
          />
          {activeViz.visualizationType === "scatter" && (
            <SelectField
              label="Size (optional)"
              value={activeViz.encoding?.size || ""}
              onChange={(value) => handleEncodingChange("size", value)}
              onClear={() => handleEncodingChange("size", "")}
              options={columnOptions}
              placeholder="None"
            />
          )}
        </div>
      </CollapsibleSection>

      {/* NEW: Metrics Strip */}
      {insight && (
        <CollapsibleSection
          title="Metrics"
          defaultOpen={insight.metrics && insight.metrics.length > 0}
        >
          <MetricsStrip insight={insight} />
        </CollapsibleSection>
      )}

      {/* Chart Type moved to Chart Options (demoted) */}
      <CollapsibleSection title="Chart options" defaultOpen={false}>
        <div className="space-y-3">
          {activeViz.visualizationType === "table" && (
            <div className="bg-muted/30 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Info className="text-muted-foreground h-4 w-4" />
                <p className="text-foreground text-xs font-medium">
                  Table View
                </p>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                Showing raw data from the DataFrame.
              </p>
            </div>
          )}
          {!hasNumericColumns && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-950/30">
              <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
                Charts require numeric data
              </p>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                Your data doesn&apos;t contain any numeric columns. Only table
                view is available.
              </p>
            </div>
          )}
          <SelectField
            label="Chart type"
            value={activeViz.visualizationType}
            onChange={handleTypeChange}
            options={visualizationTypeOptions}
          />
        </div>
      </CollapsibleSection>
    </Panel>
  );
}
