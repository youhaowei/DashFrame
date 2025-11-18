"use client";

import { useState, useEffect } from "react";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import type { VisualizationType } from "@/lib/stores/types";
import { Select } from "../fields";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc/Provider";
import { toast } from "sonner";
import { RefreshCw, Trash2 } from "lucide-react";

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
      <div className="flex h-full w-full items-center justify-center p-6">
        <p className="text-center text-sm text-muted-foreground">
          Loading...
        </p>
      </div>
    );
  }

  if (!activeViz) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <p className="text-center text-sm text-muted-foreground">
          No visualization selected.
          <br />
          Select or create one to see controls.
        </p>
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
        <p className="text-center text-sm text-destructive">Error: DataFrame not found</p>
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
    <div className="flex flex-col gap-6 p-6">
      {/* Section 1: Visualization Type Picker */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">
          Visualization Type
        </h3>
        <Select
          label=""
          value={activeViz.visualizationType}
          onChange={handleTypeChange}
          options={visualizationTypeOptions}
        />
      </div>

      {/* Section 2: Column/Encoding Config (only for chart types) */}
      {activeViz.visualizationType !== "table" && (
        <>
          <Separator />
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">
              Chart Configuration
            </h3>

          {/* X Axis */}
          <Select
            label="X Axis"
            value={activeViz.encoding?.x || ""}
            onChange={(value) => handleEncodingChange("x", value)}
            options={columnOptions}
            placeholder="Select column..."
          />

          {/* Y Axis */}
          <Select
            label="Y Axis"
            value={activeViz.encoding?.y || ""}
            onChange={(value) => handleEncodingChange("y", value)}
            options={numericColumnOptions}
            placeholder="Select column..."
          />

          {/* Color */}
          <Select
            label="Color (optional)"
            value={activeViz.encoding?.color || ""}
            onChange={(value) => handleEncodingChange("color", value)}
            options={columnOptions}
            placeholder="None"
          />

          {/* Size (for scatter plots) */}
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
        </>
      )}

      {/* Section 3: Metadata */}
      <Separator />
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Metadata</h3>

        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="viz-name">Name</Label>
          <Input
            id="viz-name"
            value={activeViz.name}
            onChange={(e) => update(activeViz.id, { name: e.target.value })}
          />
        </div>

        {/* Source */}
        <div className="space-y-2">
          <Label>Data Source</Label>
          <p className="text-sm text-muted-foreground">
            {dataSource?.name || "Unknown"}
          </p>
        </div>

        {/* DataFrame Info */}
        <div className="space-y-2">
          <Label>DataFrame</Label>
          <p className="text-sm text-muted-foreground">
            {dataFrame.metadata.rowCount} rows ×{" "}
            {dataFrame.metadata.columnCount} columns
          </p>
        </div>

        {/* Created At */}
        <div className="space-y-2">
          <Label>Created</Label>
          <p className="text-sm text-muted-foreground">
            {new Date(activeViz.createdAt).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Section 4: Actions */}
      <Separator />
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Actions</h3>

        {/* Refresh (only for Notion insights) */}
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

        {/* Delete */}
        <Button
          variant="destructive"
          className="w-full"
          onClick={handleDelete}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Visualization
        </Button>
      </div>
    </div>
  );
}
