"use client";

import { useState, useEffect } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import type { VisualizationType } from "@/lib/stores/types";
import { trpc } from "@/lib/trpc/Provider";
import { Select } from "../fields";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function VisualizationControls() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const activeViz = useVisualizationsStore((state) => state.getActive());

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
  const updateFromInsight = useDataFramesStore((state) => state.updateFromInsight);
  const getDataSource = useDataSourcesStore((state) => state.get);
  const getInsight = useDataSourcesStore((state) => state.getInsight);

  const queryNotionDatabase = trpc.notion.queryDatabase.useMutation();

  // Don't render anything until hydrated to avoid hydration mismatch
  if (!isHydrated) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-sm text-muted-foreground">
        Loading controls…
      </div>
    );
  }

  if (!activeViz) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="w-full rounded-2xl border border-dashed border-border/70 bg-background/40 p-8 text-center">
          <p className="text-base font-medium text-foreground">No visualization selected</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose an existing visualization or create a new one to configure settings.
          </p>
        </div>
      </div>
    );
  }

  const dataFrame = getDataFrame(activeViz.source.dataFrameId);
  const dataSource = activeViz.source.dataSourceId
    ? getDataSource(activeViz.source.dataSourceId)
    : null;

  if (!dataFrame) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-6 text-center">
          <p className="text-sm font-medium text-destructive">Unable to load DataFrame</p>
          <p className="mt-2 text-xs text-destructive/80">
            Please refresh your data source or recreate this visualization.
          </p>
        </div>
      </div>
    );
  }

  const columns = dataFrame.data.columns.map((col) => col.name);
  const numericColumns = dataFrame.data.columns
    .filter((col) => col.type === "number")
    .map((col) => col.name);

  const visualizationTypeOptions = [
    { label: "Table", value: "table" },
    { label: "Bar Chart", value: "bar" },
    { label: "Line Chart", value: "line" },
    { label: "Scatter Plot", value: "scatter" },
    { label: "Area Chart", value: "area" },
  ];

  const columnOptions = columns.map((col) => ({ label: col, value: col }));
  const numericColumnOptions = numericColumns.map((col) => ({
    label: col,
    value: col,
  }));

  const handleTypeChange = (type: string) => {
    updateVisualizationType(activeViz.id, type as VisualizationType);
  };

  const handleEncodingChange = (
    field: "x" | "y" | "color" | "size",
    value: string,
  ) => {
    updateEncoding(activeViz.id, {
      ...activeViz.encoding,
      [field]: value || undefined,
    });
  };

  const handleDelete = () => {
    if (confirm(`Are you sure you want to delete "${activeViz.name}"?`)) {
      remove(activeViz.id);
    }
  };

  const handleRefresh = async () => {
    if (!activeViz.source.insightId || !activeViz.source.dataSourceId) return;

    const toastId = toast.loading("Refreshing data from Notion...");
    setIsRefreshing(true);

    try {
      // Get the Notion data source (has apiKey)
      const dataSource = getDataSource(activeViz.source.dataSourceId);
      if (!dataSource || dataSource.type !== "notion") {
        throw new Error("Notion data source not found");
      }

      // Get the insight (has databaseId and properties)
      const insight = getInsight(activeViz.source.dataSourceId, activeViz.source.insightId);
      if (!insight) throw new Error("Insight not found");

      // Fetch fresh data from Notion (returns DataFrame directly)
      const newDataFrame = await queryNotionDatabase.mutateAsync({
        apiKey: dataSource.apiKey,              // From NotionDataSource
        databaseId: insight.table,               // From Insight (table = databaseId)
        selectedPropertyIds: insight.dimensions, // From Insight (dimensions = properties)
      });

      // Update the DataFrame with fresh data
      updateFromInsight(
        activeViz.source.dataSourceId!,
        activeViz.source.insightId!,
        newDataFrame
      );

      toast.success("Data refreshed successfully!", { id: toastId });
    } catch (error) {
      console.error("Failed to refresh data:", error);
      toast.error(`Failed to refresh: ${error instanceof Error ? error.message : "Unknown error"}`, {
        id: toastId,
        description: "Please check your Notion API key and try again."
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-6">
      <div className="rounded-2xl border border-border/60 bg-background/50 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Active visualization
            </p>
            <p className="text-lg font-semibold text-foreground">{activeViz.name}</p>
            <p className="text-sm text-muted-foreground">{dataSource?.name ?? "Unlinked source"}</p>
          </div>
          <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
            {visualizationTypeOptions.find((o) => o.value === activeViz.visualizationType)?.label ??
              activeViz.visualizationType}
          </span>
        </div>

        <div className="mt-4 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-2">
            <p className="text-xs uppercase">Rows</p>
            <p className="text-base font-semibold text-foreground">
              {dataFrame.metadata.rowCount.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-2">
            <p className="text-xs uppercase">Columns</p>
            <p className="text-base font-semibold text-foreground">
              {dataFrame.metadata.columnCount}
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-2 sm:col-span-1">
            <p className="text-xs uppercase">Created</p>
            <p className="text-sm text-foreground">
              {new Date(activeViz.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-background/60 p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground">Visualization type</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how you want DashFrame to render this dataset.
        </p>
        <div className="mt-4">
          <Select
            label=""
            value={activeViz.visualizationType}
            onChange={handleTypeChange}
            options={visualizationTypeOptions}
          />
        </div>
      </div>

      {activeViz.visualizationType !== "table" && (
        <div className="rounded-2xl border border-border/60 bg-background/60 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Chart configuration</h3>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Encodings
            </p>
          </div>
          <div className="mt-4 space-y-4">
            <Select
              label="X Axis"
              value={activeViz.encoding?.x || ""}
              onChange={(value) => handleEncodingChange("x", value)}
              options={columnOptions}
              placeholder="Select column..."
            />
            <Select
              label="Y Axis"
              value={activeViz.encoding?.y || ""}
              onChange={(value) => handleEncodingChange("y", value)}
              options={numericColumnOptions}
              placeholder="Select column..."
            />
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
                options={numericColumnOptions}
                placeholder="None"
              />
            )}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border/60 bg-background/60 p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground">Metadata</h3>
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="viz-name">Name</Label>
            <Input
              id="viz-name"
              value={activeViz.name}
              onChange={(e) => update(activeViz.id, { name: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label>Data Source</Label>
            <p className="text-sm text-muted-foreground">{dataSource?.name || "Unknown"}</p>
          </div>

          <div className="space-y-1">
            <Label>DataFrame</Label>
            <p className="text-sm text-muted-foreground">
              {dataFrame.metadata.rowCount.toLocaleString()} rows ·{" "}
              {dataFrame.metadata.columnCount} columns
            </p>
          </div>
        </div>
      </div>

      <div className="mt-auto rounded-2xl border border-border/60 bg-background/60 p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground">Actions</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Keep your visualization up to date or remove it when you are done exploring.
        </p>
        <div className="mt-4 space-y-3">
          {activeViz.source.insightId && (
            <Button
              variant="outline"
              className="w-full"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "Refreshing..." : "Refresh Data"}
            </Button>
          )}
          <Button variant="destructive" className="w-full" onClick={handleDelete}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Visualization
          </Button>
        </div>
      </div>
    </div>
  );
}
