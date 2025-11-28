"use client";

import { use, useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  join as joinDataFrames,
  analyzeDataFrame,
  suggestJoinColumns,
  type JoinSuggestion,
  type EnhancedDataFrame,
} from "@dashframe/dataframe";
import type { DataFrame, Field } from "@dashframe/dataframe";
import {
  Button,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Alert,
  AlertDescription,
  Surface,
  DataFrameTable,
  Badge,
  type ColumnConfig,
  ArrowLeft,
  Merge,
  Loader2,
  AlertCircle,
  Sparkles,
} from "@dashframe/ui";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { useStoreQuery } from "@/hooks/useStoreQuery";
import type { DataTable } from "@/lib/stores/types";

interface PageProps {
  params: Promise<{ insightId: string; tableId: string }>;
}

const PREVIEW_ROW_LIMIT = 50;

/**
 * Join Configuration Page
 *
 * Provides a full-page experience for configuring joins between two tables:
 * - Side-by-side table previews (responsive: stacked on narrow screens)
 * - Column selection for join keys
 * - Join type selection
 * - Live preview of join result
 */
export default function JoinConfigurePage({ params }: PageProps) {
  const { insightId, tableId: joinTableId } = use(params);
  const router = useRouter();

  // Helper to get badge variant based on confidence level
  const getConfidenceBadgeVariant = (
    confidence: "high" | "medium" | "low",
  ): "default" | "secondary" | "outline" => {
    switch (confidence) {
      case "high":
        return "default";
      case "medium":
        return "secondary";
      default:
        return "outline";
    }
  };

  // Store hooks with hydration awareness
  const { data: insight, isLoading: isInsightLoading } = useStoreQuery(
    useInsightsStore,
    (s) => s.getInsight(insightId),
  );
  const updateInsight = useInsightsStore((state) => state.updateInsight);

  const { data: dataSources, isLoading: isSourcesLoading } = useStoreQuery(
    useDataSourcesStore,
    (s) => s.getAll(),
  );

  const { data: dataFrameGetter, isLoading: isDataFramesLoading } =
    useStoreQuery(useDataFramesStore, (s) => s.get);

  const isLoading = isInsightLoading || isSourcesLoading || isDataFramesLoading;

  // Join configuration state
  const [leftFieldId, setLeftFieldId] = useState<string | null>(null);
  const [rightFieldId, setRightFieldId] = useState<string | null>(null);
  const [joinType, setJoinType] = useState<
    "inner" | "left" | "right" | "outer"
  >("inner");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewResult, setPreviewResult] = useState<DataFrame | null>(null);
  const [isComputingPreview, setIsComputingPreview] = useState(false);

  // Resolve base table (from insight)
  const baseTableInfo = useMemo(() => {
    if (!insight) return null;

    for (const source of dataSources) {
      const table = source.dataTables.get(insight.baseTable.tableId);
      if (table) {
        const dataFrame = table.dataFrameId
          ? dataFrameGetter(table.dataFrameId)
          : null;
        return { table, dataFrame, source };
      }
    }
    return null;
  }, [insight, dataSources, dataFrameGetter]);

  // Resolve join table (from tableId param)
  const joinTableInfo = useMemo(() => {
    for (const source of dataSources) {
      const table = source.dataTables.get(joinTableId);
      if (table) {
        const dataFrame = table.dataFrameId
          ? dataFrameGetter(table.dataFrameId)
          : null;
        return { table, dataFrame, source };
      }
    }
    return null;
  }, [dataSources, joinTableId, dataFrameGetter]);

  // Filter out internal fields (those starting with _)
  const baseFields = useMemo(
    () =>
      baseTableInfo?.table.fields.filter((f) => !f.name.startsWith("_")) ?? [],
    [baseTableInfo],
  );

  const joinFields = useMemo(
    () =>
      joinTableInfo?.table.fields.filter((f) => !f.name.startsWith("_")) ?? [],
    [joinTableInfo],
  );

  // Column configs for highlighting selected columns
  const baseColumnConfigs = useMemo((): ColumnConfig[] => {
    const leftField = baseFields.find((f) => f.id === leftFieldId);
    if (!leftField) return [];
    return [{ id: leftField.columnName ?? leftField.name, highlight: true }];
  }, [baseFields, leftFieldId]);

  const joinColumnConfigs = useMemo((): ColumnConfig[] => {
    const rightField = joinFields.find((f) => f.id === rightFieldId);
    if (!rightField) return [];
    return [{ id: rightField.columnName ?? rightField.name, highlight: true }];
  }, [joinFields, rightFieldId]);

  // Column configs for the preview result - highlight base vs join columns
  const previewColumnConfigs = useMemo((): ColumnConfig[] => {
    if (!previewResult?.columns || !baseTableInfo || !joinTableInfo) return [];

    // Get column names from each source table
    const baseColumnNames = new Set(
      baseFields.map((f) => f.columnName ?? f.name),
    );
    const joinColumnNames = new Set(
      joinFields.map((f) => f.columnName ?? f.name),
    );

    return previewResult.columns
      .filter((col) => !col.name.startsWith("_"))
      .map((col) => {
        // Check if this column came from base or join table
        // Handle suffix naming from join operation (_base, _join)
        const baseName = col.name.replace(/_base$/, "").replace(/_join$/, "");
        const isFromBase =
          baseColumnNames.has(col.name) ||
          baseColumnNames.has(baseName) ||
          col.name.endsWith("_base");
        const isFromJoin =
          joinColumnNames.has(col.name) ||
          joinColumnNames.has(baseName) ||
          col.name.endsWith("_join");

        // Determine highlight variant
        let highlight: "base" | "join" | undefined;
        if (isFromBase && !isFromJoin) {
          highlight = "base";
        } else if (isFromJoin && !isFromBase) {
          highlight = "join";
        }
        // Columns present in both (like the join key) get no highlight

        return {
          id: col.name,
          highlight,
        };
      })
      .filter((config) => config.highlight !== undefined) as ColumnConfig[];
  }, [previewResult, baseTableInfo, joinTableInfo, baseFields, joinFields]);

  // Compute join column suggestions based on column analysis
  const joinSuggestions = useMemo((): JoinSuggestion[] => {
    if (!baseTableInfo?.dataFrame || !joinTableInfo?.dataFrame) return [];

    try {
      // Analyze both tables
      const baseAnalysis = analyzeDataFrame(
        baseTableInfo.dataFrame as EnhancedDataFrame,
      );
      const joinAnalysis = analyzeDataFrame(
        joinTableInfo.dataFrame as EnhancedDataFrame,
      );

      // Get suggestions with table name for foreign key pattern matching
      return suggestJoinColumns(
        baseAnalysis,
        joinAnalysis,
        baseTableInfo.table.name,
        joinTableInfo.table.name,
      );
    } catch (err) {
      console.error("Failed to compute join suggestions:", err);
      return [];
    }
  }, [baseTableInfo, joinTableInfo]);

  // Apply a join suggestion by setting both field selections
  const applyJoinSuggestion = useCallback(
    (suggestion: JoinSuggestion) => {
      // Find matching fields by column name
      const leftField = baseFields.find(
        (f) => (f.columnName ?? f.name) === suggestion.leftColumn,
      );
      const rightField = joinFields.find(
        (f) => (f.columnName ?? f.name) === suggestion.rightColumn,
      );

      if (leftField) setLeftFieldId(leftField.id);
      if (rightField) setRightFieldId(rightField.id);
    },
    [baseFields, joinFields],
  );

  // Helper to build columns from fields (since DataFrame.columns may be missing)
  const buildColumnsFromFields = useCallback(
    (
      fields: Field[],
    ): {
      name: string;
      type: "string" | "number" | "boolean" | "date" | "unknown";
    }[] => {
      return fields.map((field) => ({
        name: field.columnName ?? field.name,
        type: field.type,
      }));
    },
    [],
  );

  // Compute preview when join config changes
  useEffect(() => {
    if (!leftFieldId || !rightFieldId) {
      setPreviewResult(null);
      return;
    }

    if (!baseTableInfo?.dataFrame || !joinTableInfo?.dataFrame) {
      setPreviewResult(null);
      return;
    }

    const leftField = baseFields.find((f) => f.id === leftFieldId);
    const rightField = joinFields.find((f) => f.id === rightFieldId);

    if (!leftField || !rightField) {
      setPreviewResult(null);
      return;
    }

    const leftColumnName = leftField.columnName ?? leftField.name;
    const rightColumnName = rightField.columnName ?? rightField.name;

    setIsComputingPreview(true);
    setError(null);

    // Use setTimeout to allow UI to update before heavy computation
    const timeoutId = setTimeout(() => {
      try {
        const baseData = baseTableInfo.dataFrame!.data;
        const joinData = joinTableInfo.dataFrame!.data;

        // Build columns from fields if not present in DataFrame
        // (DataFrames may not have columns property populated)
        const baseColumns =
          baseData.columns ?? buildColumnsFromFields(baseFields);
        const joinColumns =
          joinData.columns ?? buildColumnsFromFields(joinFields);

        // Slice data for preview to avoid expensive full joins
        const previewBaseData: DataFrame = {
          ...baseData,
          columns: baseColumns,
          rows: baseData.rows.slice(0, PREVIEW_ROW_LIMIT),
        };
        const previewJoinData: DataFrame = {
          ...joinData,
          columns: joinColumns,
          rows: joinData.rows.slice(0, PREVIEW_ROW_LIMIT),
        };

        const result = joinDataFrames(previewBaseData, previewJoinData, {
          on: { left: leftColumnName, right: rightColumnName },
          how: joinType,
          suffixes: { left: "_base", right: "_join" },
        });

        setPreviewResult(result);
      } catch (err) {
        console.error("Preview join failed:", err);
        setPreviewResult(null);
        // Show the actual error message for debugging
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        setError(`Join preview failed: ${errorMessage}`);
      } finally {
        setIsComputingPreview(false);
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [
    leftFieldId,
    rightFieldId,
    joinType,
    baseTableInfo?.dataFrame,
    joinTableInfo?.dataFrame,
    baseFields,
    joinFields,
    buildColumnsFromFields,
  ]);

  // Execute full join and add to existing insight
  // Note: We only store the join configuration here. The actual join is computed
  // on-demand when displaying the preview in InsightConfigureTab.
  const handleExecuteJoin = useCallback(async () => {
    if (!leftFieldId || !rightFieldId) {
      setError("Select both join columns.");
      return;
    }

    if (!baseTableInfo || !joinTableInfo || !insight) {
      setError("Unable to load table data.");
      return;
    }

    const leftField = baseFields.find((f) => f.id === leftFieldId);
    const rightField = joinFields.find((f) => f.id === rightFieldId);

    if (!leftField || !rightField) {
      setError("Selected columns are no longer available.");
      return;
    }

    if (!baseTableInfo.dataFrame || !joinTableInfo.dataFrame) {
      setError("Unable to access data. Please refresh and try again.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    // Validate the join works by testing it (using preview result)
    // The preview is already computed, so we just check if it succeeded
    if (!previewResult || previewResult.rows.length === 0) {
      // Still allow the join even with 0 rows - user may want to keep the config
      // Just warn them in the UI (handled by the existing Alert component)
    }

    // Create join metadata - this is all we need to store
    // The actual join is computed on-demand in InsightConfigureTab
    const joinMeta = {
      id: crypto.randomUUID(),
      tableId: joinTableInfo.table.id,
      selectedFields: joinFields.map((f) => f.id), // Include all fields from join table
      joinOn: { baseField: leftField.id, joinedField: rightField.id },
      joinType,
    };

    // Add join to existing insight (append to existing joins if any)
    const existingJoins = insight.joins ?? [];
    updateInsight(insightId, {
      joins: [...existingJoins, joinMeta],
    });

    // Note: We intentionally do NOT store a pre-computed joined DataFrame here.
    // The join preview in InsightConfigureTab computes the join on-demand,
    // which ensures we always show raw joined data (not aggregated data).

    setIsSubmitting(false);
    // Navigate back to the same insight
    router.push(`/insights/${insightId}`);
  }, [
    leftFieldId,
    rightFieldId,
    joinType,
    baseTableInfo,
    joinTableInfo,
    baseFields,
    joinFields,
    insight,
    insightId,
    updateInsight,
    previewResult,
    router,
  ]);

  // Loading state - wait for all stores to hydrate before rendering
  if (isLoading) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
          <p className="text-muted-foreground text-sm">
            Loading join configuration...
          </p>
        </div>
      </div>
    );
  }

  // Error states
  if (!insight) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <Surface elevation="raised" className="p-8 text-center">
          <AlertCircle className="text-muted-foreground mx-auto mb-4 h-10 w-10" />
          <h2 className="text-xl font-semibold">Insight not found</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            The insight you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button onClick={() => router.push("/insights")} className="mt-4">
            Go to Insights
          </Button>
        </Surface>
      </div>
    );
  }

  if (!baseTableInfo) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <Surface elevation="raised" className="p-8 text-center">
          <AlertCircle className="text-muted-foreground mx-auto mb-4 h-10 w-10" />
          <h2 className="text-xl font-semibold">Base table not found</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            The data table for this insight no longer exists.
          </p>
          <Button onClick={() => router.push("/insights")} className="mt-4">
            Go to Insights
          </Button>
        </Surface>
      </div>
    );
  }

  if (!joinTableInfo) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <Surface elevation="raised" className="p-8 text-center">
          <AlertCircle className="text-muted-foreground mx-auto mb-4 h-10 w-10" />
          <h2 className="text-xl font-semibold">Join table not found</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            The table you&apos;re trying to join with doesn&apos;t exist.
          </p>
          <Button
            onClick={() => router.push(`/insights/${insightId}`)}
            className="mt-4"
          >
            Back to Insight
          </Button>
        </Surface>
      </div>
    );
  }

  const canJoin = leftFieldId && rightFieldId;

  return (
    <div className="bg-background flex h-screen flex-col">
      {/* Header */}
      <header className="bg-card/90 sticky top-0 z-10 border-b backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push(`/insights/${insightId}`)}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Cancel
              </Button>
              <div>
                <h1 className="text-xl font-semibold">
                  Join: {baseTableInfo.table.name} + {joinTableInfo.table.name}
                </h1>
                <p className="text-muted-foreground text-sm">
                  Configure how to combine these datasets
                </p>
              </div>
            </div>
            <Button
              onClick={handleExecuteJoin}
              disabled={!canJoin || isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Merge className="mr-2 h-4 w-4" />
              )}
              {isSubmitting ? "Joining..." : "Join Tables"}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="container mx-auto space-y-6 px-6 py-6">
          {/* Dual Table Previews */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Base Table Preview */}
            <TablePreviewSection
              title="Base Table"
              table={baseTableInfo.table}
              dataFrame={baseTableInfo.dataFrame?.data ?? null}
              fields={baseTableInfo.table.fields}
              columnConfigs={baseColumnConfigs}
              onHeaderClick={(colName) => {
                const field = baseFields.find(
                  (f) => (f.columnName ?? f.name) === colName,
                );
                if (field) setLeftFieldId(field.id);
              }}
            />

            {/* Join Table Preview */}
            <TablePreviewSection
              title="Join Table"
              table={joinTableInfo.table}
              dataFrame={joinTableInfo.dataFrame?.data ?? null}
              fields={joinTableInfo.table.fields}
              columnConfigs={joinColumnConfigs}
              onHeaderClick={(colName) => {
                const field = joinFields.find(
                  (f) => (f.columnName ?? f.name) === colName,
                );
                if (field) setRightFieldId(field.id);
              }}
            />
          </div>

          {/* Join Configuration */}
          <Surface elevation="raised" className="rounded-2xl p-6">
            <h2 className="mb-4 text-lg font-semibold">Join Configuration</h2>

            {/* Join Suggestions */}
            {joinSuggestions.length > 0 && (
              <div className="bg-muted/50 border-border/60 mb-6 rounded-xl border p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles className="text-primary h-4 w-4" />
                  <span className="text-sm font-medium">
                    Suggested join columns
                  </span>
                  <span className="text-muted-foreground text-xs">
                    – click to apply
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {joinSuggestions.slice(0, 3).map((suggestion, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="border-border bg-card hover:bg-primary/10 hover:border-primary/50 group flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
                      onClick={() => applyJoinSuggestion(suggestion)}
                    >
                      <span className="text-foreground group-hover:text-primary font-medium">
                        {suggestion.leftColumn}
                      </span>
                      <span className="text-muted-foreground">↔</span>
                      <span className="text-foreground group-hover:text-primary font-medium">
                        {suggestion.rightColumn}
                      </span>
                      <Badge
                        variant={getConfidenceBadgeVariant(
                          suggestion.confidence,
                        )}
                        className="ml-1 px-1.5 text-[10px]"
                      >
                        {suggestion.confidence}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="left-column">Base table column</Label>
                <Select
                  value={leftFieldId ?? ""}
                  onValueChange={(value) => setLeftFieldId(value || null)}
                >
                  <SelectTrigger id="left-column">
                    <SelectValue placeholder="Select column..." />
                  </SelectTrigger>
                  <SelectContent>
                    {baseFields.map((field) => (
                      <SelectItem key={field.id} value={field.id}>
                        {field.name}
                        <span className="text-muted-foreground ml-2 text-xs">
                          ({field.type})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="right-column">Join table column</Label>
                <Select
                  value={rightFieldId ?? ""}
                  onValueChange={(value) => setRightFieldId(value || null)}
                >
                  <SelectTrigger id="right-column">
                    <SelectValue placeholder="Select column..." />
                  </SelectTrigger>
                  <SelectContent>
                    {joinFields.map((field) => (
                      <SelectItem key={field.id} value={field.id}>
                        {field.name}
                        <span className="text-muted-foreground ml-2 text-xs">
                          ({field.type})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="join-type">Join type</Label>
                <Select
                  value={joinType}
                  onValueChange={(value) =>
                    setJoinType(value as "inner" | "left" | "right" | "outer")
                  }
                >
                  <SelectTrigger id="join-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inner">
                      Inner
                      <span className="text-muted-foreground ml-2 text-xs">
                        (only matching rows)
                      </span>
                    </SelectItem>
                    <SelectItem value="left">
                      Left
                      <span className="text-muted-foreground ml-2 text-xs">
                        (all base + matching)
                      </span>
                    </SelectItem>
                    <SelectItem value="right">
                      Right
                      <span className="text-muted-foreground ml-2 text-xs">
                        (matching + all join)
                      </span>
                    </SelectItem>
                    <SelectItem value="outer">
                      Outer
                      <span className="text-muted-foreground ml-2 text-xs">
                        (all rows from both)
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Surface>

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Preview Result */}
          {canJoin && (
            <Surface elevation="raised" className="rounded-2xl p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Preview Result</h2>
                {isComputingPreview && (
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Computing preview...
                  </div>
                )}
                {!isComputingPreview && previewResult && (
                  <p className="text-muted-foreground text-sm">
                    {previewResult.rows.length} rows
                    {previewResult.rows.length >= PREVIEW_ROW_LIMIT &&
                      ` (showing first ${PREVIEW_ROW_LIMIT})`}
                    {" · "}
                    {previewResult.columns?.length ?? 0} columns
                  </p>
                )}
              </div>

              {/* Preview result or placeholder */}
              {!isComputingPreview && previewResult && (
                <>
                  {/* Legend for column colors */}
                  <div className="mb-3 flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="h-3 w-3 rounded bg-blue-600" />
                      <span className="text-muted-foreground">
                        From {baseTableInfo?.table.name ?? "base table"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="h-3 w-3 rounded bg-emerald-600" />
                      <span className="text-muted-foreground">
                        From {joinTableInfo?.table.name ?? "join table"}
                      </span>
                    </div>
                  </div>
                  <div
                    className="border-border/60 overflow-hidden rounded-xl border"
                    style={{ maxHeight: 300 }}
                  >
                    <DataFrameTable
                      dataFrame={previewResult}
                      columns={previewColumnConfigs}
                      compact
                    />
                  </div>
                </>
              )}
              {!isComputingPreview && !previewResult && (
                <div className="text-muted-foreground flex h-40 items-center justify-center">
                  {error
                    ? "Unable to generate preview"
                    : "Select join columns to see preview"}
                </div>
              )}

              {!isComputingPreview &&
                previewResult &&
                previewResult.rows.length === 0 && (
                  <Alert className="mt-4">
                    <AlertDescription>
                      This join produces 0 rows. Consider using a different join
                      type or checking that the columns have matching values.
                    </AlertDescription>
                  </Alert>
                )}
            </Surface>
          )}
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// Table Preview Section Component
// ============================================================================

interface TablePreviewSectionProps {
  title: string;
  table: DataTable;
  dataFrame: DataFrame | null;
  fields: Field[];
  columnConfigs?: ColumnConfig[];
  onHeaderClick?: (columnName: string) => void;
}

function TablePreviewSection({
  title,
  table,
  dataFrame,
  fields,
  columnConfigs,
  onHeaderClick,
}: TablePreviewSectionProps) {
  const rowCount = dataFrame?.rows.length ?? 0;
  const colCount = dataFrame?.columns?.length ?? fields.length;

  // Slice data for preview
  const previewData = useMemo(() => {
    if (!dataFrame) return null;
    if (dataFrame.rows.length <= PREVIEW_ROW_LIMIT) return dataFrame;
    return {
      ...dataFrame,
      rows: dataFrame.rows.slice(0, PREVIEW_ROW_LIMIT),
    };
  }, [dataFrame]);

  return (
    <Surface elevation="raised" className="overflow-hidden rounded-2xl">
      <div className="border-border/60 border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              {title}
            </p>
            <p className="font-semibold">{table.name}</p>
          </div>
          <p className="text-muted-foreground text-xs">
            {rowCount.toLocaleString()} rows · {colCount} columns
          </p>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          Click a column header to select it for joining
        </p>
      </div>
      <div style={{ maxHeight: 260 }} className="overflow-hidden">
        {previewData ? (
          <DataFrameTable
            dataFrame={previewData}
            fields={fields}
            columns={columnConfigs}
            onHeaderClick={onHeaderClick}
            compact
          />
        ) : (
          <div className="text-muted-foreground flex h-40 items-center justify-center">
            No data available
          </div>
        )}
      </div>
    </Surface>
  );
}
