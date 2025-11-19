"use client";

import { useCallback, useMemo, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import type { EnhancedDataFrame } from "@dash-frame/dataframe";
import { useShallow } from "zustand/react/shallow";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import {
  isCSVDataSource,
  isNotionDataSource,
  type DataSource,
  type Insight,
} from "@/lib/stores/types";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CollapsibleSection } from "@/components/shared/CollapsibleSection";
import {
  ItemSelector,
  type SelectableItem,
  type ItemAction,
} from "@/components/shared/ItemSelector";
import { TableView } from "@/components/visualizations/TableView";
import { NewDataSourcePanel } from "./NewDataSourcePanel";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Layers,
  Plus,
  Trash2,
} from "lucide-react";
import { SiNotion } from "react-icons/si";

type ButtonProps = ComponentProps<typeof Button>;

interface AddSourceButtonProps {
  onClick: () => void;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}

function AddSourceButton({
  onClick,
  label = "Add source",
  variant = "default",
  size = "sm",
  className,
}: AddSourceButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      onClick={onClick}
      className={cn("flex items-center justify-center gap-2", className)}
    >
      <Plus className="h-4 w-4" />
      {label}
    </Button>
  );
}

// eslint-disable-next-line sonarjs/cognitive-complexity
export function DataSourcesWorkbench() {
  const dataSources = useDataSourcesStore(
    useShallow((state) =>
      Array.from(state.dataSources.values()).sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    ),
  );
  const removeSource = useDataSourcesStore((state) => state.remove);

  const [manualSourceId, setManualSourceId] = useState<string | null>(null);
  const [insightSelection, setInsightSelection] = useState<
    Record<string, string>
  >({});
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [previewCollapsedState, setPreviewCollapsedState] = useState(false);

  const resolvedSourceId = useMemo(
    () => pickResolvedSourceId(dataSources, manualSourceId),
    [dataSources, manualSourceId],
  );

  const selectedSource = useMemo(
    () => dataSources.find((source) => source.id === resolvedSourceId) ?? null,
    [dataSources, resolvedSourceId],
  );

  const insightsForSelected = useMemo<Insight[]>(
    () => buildInsightsList(selectedSource),
    [selectedSource],
  );

  const activeInsightId = resolveInsightSelection(
    selectedSource,
    insightSelection,
    insightsForSelected,
  );

  const activeInsight =
    activeInsightId && selectedSource
      ? insightsForSelected.find((insight) => insight.id === activeInsightId) ??
      null
      : null;

  const notionSource =
    selectedSource && isNotionDataSource(selectedSource)
      ? selectedSource
      : null;
  const showInsightEditor = Boolean(notionSource && activeInsight);

  const previewCollapsible = Boolean(showInsightEditor);
  const isPreviewCollapsed = previewCollapsible ? previewCollapsedState : false;

  const previewFrame = useDataFramesStore(
    useShallow((state) =>
      getPreviewFrameForSource(state.dataFrames, selectedSource, activeInsight),
    ),
  );

  const openDialog = useCallback(() => {
    setIsDialogOpen(true);
  }, []);

  const handleDelete = useCallback(
    (source: DataSource) => {
      if (
        confirm(
          `Delete "${source.name}"? Insights and downstream frames will be removed.`,
        )
      ) {
        removeSource(source.id);
      }
    },
    [removeSource],
  );

  const handleSelectInsight = useCallback((sourceId: string, id: string) => {
    setInsightSelection((prev) => ({ ...prev, [sourceId]: id }));
  }, []);

  const hasSources = dataSources.length > 0;

  const dialogUI = (
    <Dialog open={isDialogOpen} onOpenChange={(open) => setIsDialogOpen(open)}>
      <DialogContent className="max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Add data source</DialogTitle>
        </DialogHeader>
        <NewDataSourcePanel />
      </DialogContent>
    </Dialog>
  );

  if (!hasSources) {
    return (
      <div className="flex w-full h-full flex-1 flex-col gap-4 overflow-auto">
        <div className="flex w-full flex-col gap-4 px-2 sm:px-4">
          <EmptySourcesState onAddSource={() => openDialog()} />
        </div>
        {dialogUI}
      </div>
    );
  }

  return (
    <div className="flex w-full h-full flex-1 flex-col gap-4 overflow-auto">
      <div className="flex w-full flex-col gap-4 px-2 sm:px-4">
        <SourcesRail
          sources={dataSources}
          selectedSourceId={resolvedSourceId}
          onSelectSource={setManualSourceId}
          onAddSource={openDialog}
        />
      </div>

      <div className="w-full px-2 sm:px-4 flex-1 min-h-0">
        <div className="grid min-h-0 h-full gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="min-h-0 overflow-y-auto">
            <WorkbenchLeftColumn
              source={selectedSource}
              insights={insightsForSelected}
              activeInsightId={activeInsightId}
              onSelectInsight={
                selectedSource
                  ? (insightId) => handleSelectInsight(selectedSource.id, insightId)
                  : undefined
              }
              onDeleteSource={
                selectedSource ? () => handleDelete(selectedSource) : undefined
              }
              onAddInsight={
                selectedSource && isNotionDataSource(selectedSource)
                  ? openDialog
                  : undefined
              }
            />
          </div>
          <div className="min-h-0 overflow-y-auto">
            <WorkbenchRightColumn
              source={selectedSource}
              insight={activeInsight}
              dataFrame={previewFrame}
              collapsible={previewCollapsible}
              collapsed={isPreviewCollapsed}
              onToggleCollapse={() => setPreviewCollapsedState((prev) => !prev)}
              onAddInsight={
                selectedSource && isNotionDataSource(selectedSource)
                  ? openDialog
                  : undefined
              }
              showInsightEditor={showInsightEditor}
            />
          </div>
        </div>
      </div>
      {dialogUI}
    </div>
  );
}

interface SourcesRailProps {
  sources: DataSource[];
  selectedSourceId: string | null;
  onSelectSource: (id: string) => void;
  onAddSource: () => void;
}

function SourcesRail({
  sources,
  selectedSourceId,
  onSelectSource,
  onAddSource,
}: SourcesRailProps) {
  const sourceItems: SelectableItem[] = sources.map((source) => {
    const isActive = selectedSourceId === source.id;
    const icon = source.type === "csv" ? FileSpreadsheet : SiNotion;
    let badge = "";
    let metadata = "";

    if (isCSVDataSource(source)) {
      badge = source.dataFrameId ? "Data ready" : "Needs upload";
      metadata = `${source.fileName} • ${formatBytes(source.fileSize)}`;
    } else {
      badge = `${source.insights?.size ?? 0} insights`;
    }

    return {
      id: source.id,
      label: source.name,
      active: isActive,
      badge,
      metadata,
      icon,
    };
  });

  const actions: ItemAction[] = [
    {
      label: "Add source",
      onClick: onAddSource,
      icon: Plus,
    },
  ];

  return (
    <CollapsibleSection>
      <ItemSelector
        title="Data sources"
        description="CSV files and Notion databases"
        items={sourceItems}
        onItemSelect={onSelectSource}
        actions={actions}
      />
    </CollapsibleSection>
  );
}

interface WorkbenchLeftColumnProps {
  source: DataSource | null;
  insights: Insight[];
  activeInsightId: string | null;
  onSelectInsight?: (insightId: string) => void;
  onDeleteSource?: () => void;
  onAddInsight?: () => void;
}

function WorkbenchLeftColumn({
  source,
  insights,
  activeInsightId,
  onSelectInsight,
  onDeleteSource,
  onAddInsight,
}: WorkbenchLeftColumnProps) {
  const handleSelectInsight = onSelectInsight ?? (() => { });
  const handleDelete = onDeleteSource ?? (() => { });

  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm">
      <div className="flex flex-col gap-4 pr-2">
        {source ? (
          <>
            <SourceDetailsCard
              source={source}
              onDelete={handleDelete}
              onAddInsight={onAddInsight}
            />
            <InsightPanel
              source={source}
              insights={insights}
              selectedInsightId={activeInsightId}
              onSelectInsight={handleSelectInsight}
              onAddInsight={onAddInsight}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Select a data source above to see details.
          </p>
        )}
      </div>
    </div>
  );
}

interface WorkbenchRightColumnProps {
  source: DataSource | null;
  insight: Insight | null;
  dataFrame: EnhancedDataFrame | null;
  collapsible: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onAddInsight?: () => void;
  showInsightEditor: boolean;
}

function WorkbenchRightColumn({
  source,
  insight,
  dataFrame,
  collapsible,
  collapsed,
  onToggleCollapse,
  onAddInsight,
  showInsightEditor,
}: WorkbenchRightColumnProps) {
  if (!source) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/70 p-6 text-sm text-muted-foreground">
        Select a data source to view its insights.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {showInsightEditor && insight && (
        <InsightEditorPanel source={source} insight={insight} />
      )}
      <DataPreviewPanel
        source={source}
        insight={insight}
        dataFrame={dataFrame}
        onAddInsight={onAddInsight}
        collapsible={collapsible}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
      />
    </div>
  );
}

interface EmptySourcesStateProps {
  onAddSource: () => void;
}

function EmptySourcesState({ onAddSource }: EmptySourcesStateProps) {
  return (
    <Card className="border-dashed border-border/70 bg-card/80 text-center">
      <CardHeader>
        <CardTitle>Connect your first source</CardTitle>
        <CardDescription>
          Upload a CSV or connect Notion to start inspecting your data.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <AddSourceButton
          onClick={onAddSource}
          label="Add source"
          className="flex-1 sm:flex-none"
        />
      </CardContent>
    </Card>
  );
}

interface SourceDetailsCardProps {
  source: DataSource;
  onDelete: () => void;
  onAddInsight?: () => void;
}

function SourceDetailsCard({
  source,
  onDelete,
  onAddInsight,
}: SourceDetailsCardProps) {
  const isCsv = isCSVDataSource(source);
  let statusText = "Awaiting insight";
  if (isCsv) {
    statusText = source.dataFrameId ? "Data ready" : "Needs upload";
  } else if ((source.insights?.size ?? 0) > 0) {
    statusText = "Configured";
  }
  const HeaderIcon = isCsv ? FileSpreadsheet : SiNotion;

  return (
    <Card className="border border-border/60 bg-card/80 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <HeaderIcon className="h-5 w-5" />
          {source.name}
        </CardTitle>
        <CardDescription className="flex items-center gap-2 text-sm">
          {isCsv ? "CSV upload" : "Notion workspace"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-3">
          <DetailRow label="Created" value={formatLongDate(source.createdAt)} />
          {isCsv ? (
            <>
              <DetailRow label="File name" value={source.fileName} />
              <DetailRow
                label="File size"
                value={formatBytes(source.fileSize)}
              />
            </>
          ) : (
            <>
              <DetailRow
                label="Stored API key"
                value={maskApiKey(source.apiKey)}
              />
              <DetailRow
                label="Insights"
                value={`${source.insights?.size ?? 0} configured`}
              />
            </>
          )}
          <DetailRow
            label="Status"
            value={statusText}
          />
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {onAddInsight && (
          <Button variant="outline" size="sm" onClick={onAddInsight}>
            <Layers className="h-4 w-4" />
            Manage Insights
          </Button>
        )}
        <Button
          variant="destructive"
          size="sm"
          onClick={onDelete}
          className="ml-auto"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </CardFooter>
    </Card>
  );
}

interface InsightEditorPanelProps {
  source: DataSource;
  insight: Insight;
}

function InsightEditorPanel({
  source,
  insight,
}: InsightEditorPanelProps) {
  if (!isNotionDataSource(source)) return null;

  return (
    <Card className="border border-border/60 bg-card/80 shadow-sm">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="text-lg font-semibold text-foreground">
            {insight.name}
          </CardTitle>
          <CardDescription>
            Editing insight for database <span className="font-medium">{insight.table}</span>
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" disabled>
          Updates sync automatically
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-sm font-medium text-foreground">Fields selected</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {insight.dimensions.map((dimension) => (
              <span
                key={dimension}
                className="rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground"
              >
                {dimension}
              </span>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Created {formatLongDate(insight.createdAt)} • adjust your Notion insight settings to pull different fields.
        </p>
      </CardContent>
    </Card>
  );
}

interface InsightPanelProps {
  source: DataSource;
  insights: Insight[];
  selectedInsightId: string | null;
  onSelectInsight: (insightId: string) => void;
  onAddInsight?: () => void;
}

function InsightPanel({
  source,
  insights,
  selectedInsightId,
  onSelectInsight,
  onAddInsight,
}: InsightPanelProps) {
  const isCSV = isCSVDataSource(source);
  let insightContent: ReactNode;

  if (isCSV) {
    insightContent = (
      <p className="text-sm text-muted-foreground">
        Raw CSV data is available instantly. Create optional insights when you
        want to focus on specific slices.
      </p>
    );
  } else if (insights.length === 0) {
    insightContent = (
      <div className="rounded-lg border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
        No insights yet. Add one to choose a Notion database and fields to sync.
      </div>
    );
  } else {
    insightContent = (
      <div className="space-y-2">
        {insights.map((insight) => (
          <button
            key={insight.id}
            type="button"
            onClick={() => onSelectInsight(insight.id)}
            className={cn(
              "w-full rounded-lg border px-4 py-3 text-left text-sm transition hover:border-primary/40",
              selectedInsightId === insight.id
                ? "border-primary/60 bg-primary/5"
                : "border-border/60 bg-card",
            )}
          >
            <div className="flex items-center justify-between">
              <p className="font-medium text-foreground">{insight.name}</p>
              <span className="text-xs text-muted-foreground">
                {formatDate(insight.createdAt)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {insight.dimensions.length} fields • {insight.table}
            </p>
          </button>
        ))}
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-border/50 bg-background/40 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-base font-medium text-foreground">Insights</p>

        </div>
        {!isCSV && (
          <Button variant="outline" size="sm" onClick={onAddInsight}>
            <Plus className="h-4 w-4" />
            Add Insight
          </Button>
        )}
      </div>
      {insightContent}
    </section>
  );
}

interface DataPreviewPanelProps {
  source: DataSource;
  insight: Insight | null;
  dataFrame: EnhancedDataFrame | null;
  onAddInsight?: () => void;
  collapsible: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function DataPreviewPanel({
  source,
  insight,
  dataFrame,
  onAddInsight,
  collapsible,
  collapsed,
  onToggleCollapse,
}: DataPreviewPanelProps) {
  const isCSV = isCSVDataSource(source);
  const needsInsight =
    !isCSV && (!source.insights || source.insights.size === 0);

  let helperText = "";
  if (isCSV) {
    helperText = dataFrame
      ? "Showing the first 50 rows from the uploaded file."
      : "Upload finished data to preview rows.";
  } else if (needsInsight) {
    helperText = "Create an insight to pull Notion rows into DashFrame.";
  } else if (!insight) {
    helperText = "Select an insight to preview the synced data.";
  } else if (!dataFrame) {
    helperText =
      "This insight has no preview yet. Import data to populate the table.";
  } else {
    helperText = `Data generated from "${insight.name}". Showing first 50 rows.`;
  }

  return (
    <Card className="flex min-h-[420px] flex-col border border-border/60 bg-card/80 shadow-sm">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="text-lg">Data preview</CardTitle>
          <CardDescription>{helperText}</CardDescription>
        </div>
        {collapsible && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand preview" : "Collapse preview"}
          >
            {collapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </Button>
        )}
      </CardHeader>
      {collapsible && collapsed ? (
        <CardContent className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">
            Preview collapsed while you adjust the insight.
          </p>
          <Button variant="outline" size="sm" onClick={onToggleCollapse}>
            Expand preview
          </Button>
        </CardContent>
      ) : (
        <CardContent className="flex min-h-0 flex-col overflow-hidden">
          {isCSV && !source.dataFrameId && (
            <EmptyPreview message="This CSV does not have an associated data frame yet." />
          )}
          {needsInsight && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">
                Add an insight to start syncing rows from Notion.
              </p>
              {onAddInsight && (
                <Button size="sm" onClick={onAddInsight}>
                  <Plus className="h-4 w-4" />
                  Create Insight
                </Button>
              )}
            </div>
          )}
          {!needsInsight && !isCSV && !insight && (
            <EmptyPreview message="Select an insight to preview its rows." />
          )}
          {((isCSV && source.dataFrameId) || (!isCSV && insight)) &&
            !dataFrame && !needsInsight && (
              <EmptyPreview message="No rows available yet. Run an import to populate this insight." />
            )}
          {dataFrame && <DataPreviewTable dataFrame={dataFrame} />}
        </CardContent>
      )}
    </Card>
  );
}

interface DataPreviewTableProps {
  dataFrame: EnhancedDataFrame;
}

function DataPreviewTable({ dataFrame }: DataPreviewTableProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TableView dataFrame={dataFrame.data} />
    </div>
  );
}

function EmptyPreview({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
      <Layers className="h-6 w-6 text-muted-foreground/70" />
      <p>{message}</p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, exponent);
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]
    }`;
};

const formatDate = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

const formatLongDate = (timestamp: number) =>
  new Date(timestamp).toLocaleString();

const maskApiKey = (key: string) => {
  if (!key) return "Not set";
  if (key.length <= 6) return "•••";
  return `${key.slice(0, 6)}••••`;
};

function resolveInsightSelection(
  source: DataSource | null,
  selections: Record<string, string>,
  insights: Insight[],
) {
  if (!source || !isNotionDataSource(source)) return null;
  const manual = selections[source.id];
  if (manual && insights.some((insight) => insight.id === manual)) {
    return manual;
  }
  return insights[0]?.id ?? null;
}

function pickResolvedSourceId(
  sources: DataSource[],
  manualSourceId: string | null,
) {
  if (!sources.length) return null;
  if (!manualSourceId) return sources[0].id;
  return sources.some((source) => source.id === manualSourceId)
    ? manualSourceId
    : sources[0].id;
}

function buildInsightsList(source: DataSource | null) {
  if (!source || !source.insights) return [];
  return Array.from(source.insights.values()).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
}

function getPreviewFrameForSource(
  dataFrames: Map<string, EnhancedDataFrame>,
  source: DataSource | null,
  insight: Insight | null,
) {
  if (!source) return null;
  if (isCSVDataSource(source) && source.dataFrameId) {
    return dataFrames.get(source.dataFrameId) ?? null;
  }
  if (isNotionDataSource(source) && insight?.id) {
    const frames = Array.from(dataFrames.values());
    return (
      frames.find(
        (frame) =>
          frame.metadata.source.dataSourceId === source.id &&
          frame.metadata.source.insightId === insight.id,
      ) ?? null
    );
  }
  return null;
}
