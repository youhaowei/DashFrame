"use client";

import { useState, useEffect } from "react";
import { RefreshCw, Trash2, ChevronDown } from "@/components/icons";
import { toast } from "sonner";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useInsightsStore } from "@/lib/stores/insights-store";
import type {
  Visualization,
  VisualizationType,
  VisualizationEncoding,
  AxisType,
} from "@/lib/stores/types";
import { trpc } from "@/lib/trpc/Provider";
import { Select } from "../fields";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { SidePanel } from "@/components/shared/SidePanel";
import { Toggle } from "@/components/shared/Toggle";
import { autoSelectEncoding } from "@/lib/visualizations/auto-select";
import { analyzeDataFrame, type ColumnAnalysis } from "@dashframe/dataframe";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select as SelectPrimitive,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldLabel } from "@/components/ui/field";
import { LuInfo, LuHash, LuCalendar, LuType } from "react-icons/lu";
import * as RadixSelect from "@radix-ui/react-select";
import { CheckIcon, ArrowUpDown } from "@/components/icons";

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
        <div className="px-4 pb-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Get a warning message for a column selection based on analysis and context
 */
/**
 * Get a warning message for a column selection based on analysis and context
 */
function getColumnWarning(
  columnName: string | undefined,
  axis: "x" | "y",
  chartType: VisualizationType,
  analysis: ColumnAnalysis[],
  otherAxisColumn?: string
): { message: string; reason: string } | null {
  if (!columnName) return null;

  const col = analysis.find(a => a.columnName === columnName);
  if (!col) return null;

  // Helper: check if a column name looks like an identifier
  const looksLikeId = (name: string) => {
    const lower = name.toLowerCase();
    return lower === "id" ||
      lower === "_rowindex" ||
      lower.endsWith("_id") ||
      lower.endsWith("id") ||
      lower.startsWith("_row");
  };

  const isIdentifier = col.category === "identifier" || looksLikeId(columnName) || col.category === "uuid";
  const isReference = col.category === "reference" || col.category === "url" || col.category === "email";
  const isNumerical = col.category === "numerical";
  const isTemporal = col.category === "temporal";
  const isCategorical = col.category === "categorical";

  // 1. General Warnings (Apply to all charts)

  // Warn if X and Y are the same column
  if (otherAxisColumn && columnName === otherAxisColumn) {
    return {
      message: "Same column on both axes",
      reason: "Comparing a column to itself usually doesn't show meaningful insights."
    };
  }

  // 2. Y-Axis Specific Logic (Vertical Axis - usually the "Measure")
  if (axis === "y") {
    // Identifiers and References are almost never good Y-axis candidates
    if (isIdentifier || isReference) {
      return {
        message: "Not a measurable value",
        reason: "This column contains unique labels or IDs, which cannot be aggregated (sum/avg) meaningfully."
      };
    }

    // Most charts (Bar, Line, Area, Scatter) require a numerical Y-axis
    if (["bar", "line", "area", "scatter"].includes(chartType)) {
      if (!isNumerical) {
        return {
          message: "Numerical column recommended",
          reason: `${chartType.charAt(0).toUpperCase() + chartType.slice(1)} charts need numerical values on the Y-axis to show height, trends, or position.`
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
          reason: "Scatter plots need numerical values on both axes to show correlations between two measures."
        };
      }
    }

    // Line/Area charts prefer Temporal or Numerical (continuous)
    if (chartType === "line" || chartType === "area") {
      if (isCategorical && col.cardinality > 20) {
        return {
          message: "Too many categories",
          reason: "Line charts with many categories can look cluttered. Consider a Bar chart or filtering."
        };
      }
      if (!isTemporal && !isNumerical && !isCategorical) {
        return {
          message: "Ordered column recommended",
          reason: "Line charts work best with time-series or continuous data."
        };
      }
    }

    // Bar charts prefer Categorical or Temporal (discrete buckets)
    if (chartType === "bar") {
      if (isNumerical && col.cardinality > 20) {
        return {
          message: "Many unique values",
          reason: "A numerical X-axis with many values might be better suited for a Histogram or Scatter plot."
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
  otherAxisColumn?: string
): Array<{
  label: string;
  value: string;
  score: number;
  warning?: { message: string; reason: string };
}> {
  return columns
    .map((col) => {
      const warning = getColumnWarning(col, axis, chartType, analysis, otherAxisColumn);
      const colAnalysis = analysis.find(a => a.columnName === col);

      if (!colAnalysis) return { label: col, value: col, score: 0, warning: warning || undefined };

      const isNumerical = colAnalysis.category === "numerical";
      const isTemporal = colAnalysis.category === "temporal";
      const isCategorical = colAnalysis.category === "categorical";
      const isIdentifier = colAnalysis.category === "identifier" || colAnalysis.category === "uuid";

      // Base Score
      let score = 50;

      // --- Y-AXIS SCORING ---
      if (axis === "y") {
        // Y-axis is almost always the "Measure" (Numerical)
        if (isNumerical) score += 100;

        // Penalize non-numericals heavily for standard charts
        if (!isNumerical && ["bar", "line", "area", "scatter"].includes(chartType)) {
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
    })
    .sort((a, b) => b.score - a.score); // Sort by score descending
}

export function VisualizationControls() {
  const [isRefreshing, setIsRefreshing] = useState(false);
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

  const updateVisualizationType = useVisualizationsStore(
    (state) => state.updateVisualizationType,
  );
  const updateEncoding = useVisualizationsStore(
    (state) => state.updateEncoding,
  );
  const update = useVisualizationsStore((state) => state.update);
  const remove = useVisualizationsStore((state) => state.remove);
  const getDataFrame = useDataFramesStore((state) => state.get);
  const updateFromInsight = useDataFramesStore(
    (state) => state.updateFromInsight,
  );
  const getInsight = useInsightsStore((state) => state.getInsight);

  const queryNotionDatabase = trpc.notion.queryDatabase.useMutation();

  // Don't render anything until hydrated to avoid hydration mismatch
  if (!isHydrated) {
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

  const dataFrame = getDataFrame(activeViz.source.dataFrameId);

  // Get data source through insight if it exists
  const insight = activeViz.source.insightId
    ? getInsight(activeViz.source.insightId)
    : null;

  if (!dataFrame) {
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

  const columns = (dataFrame.data.columns || []).map((col) => col.name);
  const numericColumns = (dataFrame.data.columns || [])
    .filter((col) => col.type === "number")
    .map((col) => col.name);

  // Analyze columns for warnings
  const columnAnalysis = analyzeDataFrame(dataFrame);

  const hasNumericColumns = numericColumns.length > 0;

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

  const columnOptions = columns.map((col) => ({ label: col, value: col }));

  // Get ranked options for X and Y axes with inline warnings
  const xAxisOptions = getRankedColumnOptions(
    columns,
    "x",
    activeViz.visualizationType,
    columnAnalysis,
    activeViz.encoding?.y
  );

  const yAxisOptions = getRankedColumnOptions(
    columns,
    "y",
    activeViz.visualizationType,
    columnAnalysis,
    activeViz.encoding?.x
  );

  const handleTypeChange = (type: string) => {
    const newType = type as VisualizationType;

    // Auto-select axes using shared utility
    const newEncoding = autoSelectEncoding(
      newType,
      dataFrame,
      undefined, // fields - not available in this context yet
      activeViz.encoding
    );

    // Update both type and encoding
    update(activeViz.id, {
      visualizationType: newType,
      encoding: newEncoding
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
        let axisType: "quantitative" | "nominal" | "ordinal" | "temporal" = "nominal";

        if (colAnalysis.category === "numerical") {
          axisType = "quantitative";
        } else if (colAnalysis.category === "temporal") {
          axisType = "temporal";
        }

        // Override: Identifiers should default to categorical (nominal) even if numeric
        if (colAnalysis.category === "identifier" || colAnalysis.category === "uuid") {
          axisType = "nominal";
        }

        newEncoding[typeField] = axisType;
      }
    }

    updateEncoding(activeViz.id, newEncoding);
  };

  const toggleAxisType = (axis: "x" | "y") => {
    if (!activeViz?.encoding) return;
    const typeField = axis === "x" ? "xType" : "yType";
    const currentType = activeViz.encoding[typeField];

    // Only toggle between quantitative and nominal/ordinal
    // Temporal usually stays temporal, but we can allow treating it as nominal
    let newType = currentType;

    if (currentType === "quantitative") {
      newType = "nominal";
    } else if (currentType === "nominal" || currentType === "ordinal") {
      newType = "quantitative";
    } else if (currentType === "temporal") {
      newType = "nominal";
    }

    updateEncoding(activeViz.id, { ...activeViz.encoding, [typeField]: newType });
  };

  // Helper to check if type toggle should be shown (mainly for numerical columns)
  const canToggleType = (columnName?: string) => {
    if (!columnName) return false;
    const col = columnAnalysis.find(c => c.columnName === columnName);
    // Only allow toggling for numerical or temporal columns
    // Strings are always categorical, so no toggle needed
    return col?.category === "numerical" || col?.category === "temporal" || col?.category === "identifier";
  };

  // Helper to determine the effective axis type (defaulting intelligently if not set)
  const getEffectiveAxisType = (columnName: string | undefined, currentType: AxisType | undefined): string => {
    if (currentType) return currentType;
    if (!columnName) return "nominal";

    const col = columnAnalysis.find(c => c.columnName === columnName);
    if (!col) return "nominal";

    if (col.category === "numerical") return "quantitative";
    if (col.category === "temporal") return "temporal";
    return "nominal";
  };

  // Helper to build toggle options for axis type based on column analysis
  const getAxisTypeToggleOptions = (columnName: string | undefined, currentType: AxisType | undefined) => {
    const effectiveType = getEffectiveAxisType(columnName, currentType);
    const col = columnAnalysis.find(c => c.columnName === columnName);
    const isTemporalColumn = col?.category === "temporal";
    const showTemporal = effectiveType === "temporal" || (effectiveType === "nominal" && isTemporalColumn);

    const options = [];
    
    if (showTemporal) {
      options.push({
        value: "temporal" as const,
        icon: <LuCalendar className="h-3 w-3" />,
        tooltip: "Temporal",
        ariaLabel: "Temporal",
      });
    } else {
      options.push({
        value: "quantitative" as const,
        icon: <LuHash className="h-3 w-3" />,
        tooltip: "Continuous",
        ariaLabel: "Continuous",
      });
    }
    
    options.push({
      value: "nominal" as const,
      icon: <LuType className="h-3 w-3" />,
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

  const handleRefresh = async () => {
    if (!activeViz.source.insightId) return;

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

      // Fetch fresh data from Notion (returns DataFrame directly)
      const newDataFrame = await queryNotionDatabase.mutateAsync({
        apiKey: foundDataSource.apiKey, // From NotionDataSource
        databaseId: foundDataTable.table, // From DataTable
        selectedPropertyIds: foundDataTable.fields.map(f => f.id), // Use field IDs
      });

      // Update the DataFrame with fresh data
      updateFromInsight(activeViz.source.insightId, newDataFrame);

      toast.success("Data refreshed successfully!", { id: toastId });
    } catch (error) {
      console.error("Failed to refresh data:", error);
      toast.error(
        `Failed to refresh: ${error instanceof Error ? error.message : "Unknown error"}`,
        {
          id: toastId,
          description: "Please check your Notion API key and try again.",
        },
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const actionsFooter = (
    <CollapsibleSection title="Actions" defaultOpen={false} isFooter={true}>
      <div className="space-y-2">
        {activeViz.source.insightId && (
          <Button
            variant="outline"
            className="w-full"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
            {isRefreshing ? "Refreshing..." : "Refresh Data"}
          </Button>
        )}
        <Button variant="destructive" className="w-full" onClick={handleDelete}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Visualization
        </Button>
      </div>
    </CollapsibleSection>
  );

  return (
    <SidePanel footer={actionsFooter}>
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
        {insight && (
          <p className="text-muted-foreground mt-2 text-xs">
            Source: {insight.name}
          </p>
        )}
      </div>

      {/* Collapsible: Visualization Type */}
      <CollapsibleSection title="Visualization Type" defaultOpen={true}>
        <div className="space-y-3">
          {activeViz.visualizationType === "table" && (
            <div className="bg-muted/30 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <LuInfo className="text-muted-foreground h-4 w-4" />
                <p className="text-foreground text-xs font-medium">
                  Table View
                </p>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                Showing raw data from{" "}
                <span className="font-medium">the DataFrame</span>.
              </p>
              <details className="mt-2">
                <summary className="text-muted-foreground cursor-pointer text-xs hover:underline">
                  View Schema
                </summary>
                <ul className="mt-1.5 space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
                  {(dataFrame.data.columns || []).map((col) => (
                    <li key={col.name}>
                      <strong>{col.name}</strong>: {col.type}
                    </li>
                  ))}
                </ul>
              </details>
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
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-amber-800 hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-100">
                  Show column types
                </summary>
                <ul className="mt-1.5 space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
                  {(dataFrame.data.columns || []).map((col) => (
                    <li key={col.name}>
                      <strong>{col.name}</strong>: {col.type}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
          <Select
            label=""
            value={activeViz.visualizationType}
            onChange={handleTypeChange}
            options={visualizationTypeOptions}
          />
        </div>
      </CollapsibleSection>

      {/* Collapsible: Chart Configuration */}
      {activeViz.visualizationType !== "table" && (
        <CollapsibleSection title="Chart Configuration" defaultOpen={true}>
          <div className="space-y-3">


              {/* X Axis with warning icon next to label */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <FieldLabel>X Axis</FieldLabel>
                    {(() => {
                      const selectedOption = xAxisOptions.find(opt => opt.value === activeViz.encoding?.x);
                      return selectedOption?.warning ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <LuInfo className="h-3.5 w-3.5 cursor-help text-amber-500" />
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs z-[100]">
                            <p className="font-semibold text-xs">{selectedOption.warning.message}</p>
                            <p className="text-xs mt-0.5 opacity-90">{selectedOption.warning.reason}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : null;
                    })()}
                  </div>

                  {/* Axis Type Toggle */}
                  {canToggleType(activeViz.encoding?.x) && (
                    <Toggle
                      value={getEffectiveAxisType(activeViz.encoding?.x, activeViz.encoding?.xType) as "quantitative" | "nominal" | "temporal"}
                      options={getAxisTypeToggleOptions(activeViz.encoding?.x, activeViz.encoding?.xType)}
                      onValueChange={(val) => {
                        if (!activeViz.encoding) return;
                        updateEncoding(activeViz.id, { ...activeViz.encoding, xType: val as any });
                      }}
                      size="sm"
                    />
                  )}
                </div>
                <SelectPrimitive value={activeViz.encoding?.x || undefined} onValueChange={(value) => handleEncodingChange("x", value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select column..." />
                  </SelectTrigger>
                  <SelectContent>
                    {xAxisOptions.map((option) => (
                      <RadixSelect.Item
                        key={option.value}
                        value={option.value}
                        className={cn(
                          "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                          option.warning ? "text-amber-600 dark:text-amber-400 focus:text-amber-600 dark:focus:text-amber-400 data-[highlighted]:text-amber-600 dark:data-[highlighted]:text-amber-400" : ""
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
                            <span className="text-[10px] text-muted-foreground font-normal">
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
              <div className="flex justify-center -my-1 relative z-10">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-full border bg-background shadow-xs hover:bg-muted text-muted-foreground"
                  onClick={() => {
                    if (!activeViz.encoding) return;
                    updateEncoding(activeViz.id, {
                      ...activeViz.encoding,
                      x: activeViz.encoding.y,
                      y: activeViz.encoding.x,
                      // Also swap types
                      xType: activeViz.encoding.yType,
                      yType: activeViz.encoding.xType
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
                      const selectedOption = yAxisOptions.find(opt => opt.value === activeViz.encoding?.y);
                      return selectedOption?.warning ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <LuInfo className="h-3.5 w-3.5 cursor-help text-amber-500" />
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs z-[100]">
                            <p className="font-semibold text-xs">{selectedOption.warning.message}</p>
                            <p className="text-xs mt-0.5 opacity-90">{selectedOption.warning.reason}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : null;
                    })()}
                  </div>

                  {/* Axis Type Toggle */}
                  {canToggleType(activeViz.encoding?.y) && (
                    <Toggle
                      value={getEffectiveAxisType(activeViz.encoding?.y, activeViz.encoding?.yType) as "quantitative" | "nominal" | "temporal"}
                      options={getAxisTypeToggleOptions(activeViz.encoding?.y, activeViz.encoding?.yType)}
                      onValueChange={(val) => {
                        if (!activeViz.encoding) return;
                        updateEncoding(activeViz.id, { ...activeViz.encoding, yType: val as any });
                      }}
                      size="sm"
                    />
                  )}
                </div>
                <SelectPrimitive value={activeViz.encoding?.y || undefined} onValueChange={(value) => handleEncodingChange("y", value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select column..." />
                  </SelectTrigger>
                  <SelectContent>
                    {yAxisOptions.map((option) => (
                      <RadixSelect.Item
                        key={option.value}
                        value={option.value}
                        className={cn(
                          "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                          option.warning ? "text-amber-600 dark:text-amber-400 focus:text-amber-600 dark:focus:text-amber-400 data-[highlighted]:text-amber-600 dark:data-[highlighted]:text-amber-400" : ""
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
                            <span className="text-[10px] text-muted-foreground font-normal">
                              {option.warning.message}
                            </span>
                          )}
                        </div>
                      </RadixSelect.Item>
                    ))}
                  </SelectContent>
                </SelectPrimitive>
              </div>

              <Select
                label="Color (optional)"
                value={activeViz.encoding?.color || ""}
                onChange={(value) => handleEncodingChange("color", value)}
                options={columnOptions}
                placeholder="None"
              />
              {activeViz.visualizationType === "scatter" && (
                <Select
                  label="Size (optional)"
                  value={activeViz.encoding?.size || ""}
                  onChange={(value) => handleEncodingChange("size", value)}
                  options={columnOptions}
                  placeholder="None"
                />
              )}
            </div>
        </CollapsibleSection>
      )}
    </SidePanel>
  );
}
