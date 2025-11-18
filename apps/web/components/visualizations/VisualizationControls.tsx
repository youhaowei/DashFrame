"use client";

import { useState, useEffect } from "react";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import type { VisualizationType } from "@/lib/stores/types";
import { Select } from "../fields";
import { Input, Label } from "../ui";
import { trpc } from "@/lib/trpc/Provider";
import { toast } from "sonner";

export function VisualizationControls() {
  const [isMounted, setIsMounted] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const activeViz = useVisualizationsStore((state) => state.getActive());
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


  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Prevent hydration mismatch by showing placeholder until mounted
  if (!isMounted || !activeViz) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-gray-500">
        <p className="text-center text-sm">
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
      <div className="flex h-full w-full items-center justify-center p-6 text-red-500">
        <p className="text-center text-sm">Error: DataFrame not found</p>
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
      updateDataFrame(activeViz.source.dataFrameId, {
        data: newDataFrame,
        metadata: {
          ...newDataFrame.metadata,
          lastRefreshed: new Date(),
        },
      });

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
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      {/* Section 1: Visualization Type Picker */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">
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
        <div className="space-y-3 border-t border-gray-200 pt-6">
          <h3 className="text-sm font-semibold text-gray-900">
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
      )}

      {/* Section 3: Metadata */}
      <div className="space-y-3 border-t border-gray-200 pt-6">
        <h3 className="text-sm font-semibold text-gray-900">Metadata</h3>

        {/* Name */}
        <div>
          <Label className="mb-1 block text-xs font-medium text-gray-700">
            Name
          </Label>
          <Input
            value={activeViz.name}
            onChange={(e) => update(activeViz.id, { name: e.target.value })}
          />
        </div>

        {/* Source */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Data Source
          </label>
          <div className="text-sm text-gray-600">
            {dataSource?.name || "Unknown"}
          </div>
        </div>

        {/* DataFrame Info */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            DataFrame
          </label>
          <div className="text-sm text-gray-600">
            {dataFrame.metadata.rowCount} rows ×{" "}
            {dataFrame.metadata.columnCount} columns
          </div>
        </div>

        {/* Created At */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            Created
          </label>
          <div className="text-sm text-gray-600">
            {new Date(activeViz.createdAt).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Section 4: Actions */}
      <div className="space-y-3 border-t border-gray-200 pt-6">
        <h3 className="text-sm font-semibold text-gray-900">Actions</h3>

        {/* Refresh (only for Notion insights) */}
        {activeViz.source.insightId && (
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRefreshing ? "Refreshing..." : "Refresh Data"}
          </button>
        )}

        {/* Delete */}
        <button
          onClick={handleDelete}
          className="w-full rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          Delete Visualization
        </button>
      </div>
    </div>
  );
}
