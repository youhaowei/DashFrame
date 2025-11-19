"use client";

import { useState, useEffect } from "react";
import { RefreshCw, Trash2, ChevronDown } from "lucide-react";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { SidePanel } from "@/components/shared/SidePanel";

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
      className={cn(!isFooter && "border-b border-border/40", className)}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            // Footer collapses upward, so flip the logic
            isFooter ? (!isOpen && "rotate-180") : (isOpen && "rotate-180")
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 pb-4">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
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

  const actionsFooter = (
    <CollapsibleSection
      title="Actions"
      defaultOpen={false}
      isFooter={true}
    >
      <div className="space-y-2">
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
    </CollapsibleSection>
  );

  return (
    <SidePanel footer={actionsFooter}>
      {/* Name field at top */}
      <div className="px-4 pt-4 pb-3 border-b border-border/40">
        <Label htmlFor="viz-name" className="text-xs font-medium text-muted-foreground">
          Name
        </Label>
        <Input
          id="viz-name"
          value={activeViz.name}
          onChange={(e) => update(activeViz.id, { name: e.target.value })}
          className="mt-1.5"
        />
        {dataSource && (
          <p className="mt-2 text-xs text-muted-foreground">
            Source: {dataSource.name}
          </p>
        )}
      </div>

      {/* Collapsible: Visualization Type */}
      <CollapsibleSection
        title="Visualization Type"
        defaultOpen={true}
      >
        <div className="space-y-3">
          {!hasNumericColumns && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-950/30">
              <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
                Charts require numeric data
              </p>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                Your data doesn't contain any numeric columns. Only table view is available.
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-amber-800 hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-100">
                  Show column types
                </summary>
                <ul className="mt-1.5 space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
                  {dataFrame.data.columns.map((col) => (
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
        <CollapsibleSection
          title="Chart Configuration"
          defaultOpen={true}
        >
          <div className="space-y-3">
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
        </CollapsibleSection>
      )}
    </SidePanel>
  );
}
