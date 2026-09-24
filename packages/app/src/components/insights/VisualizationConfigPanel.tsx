import { AxisSelectField } from "@/components/visualizations/AxisSelectField";
import { ShelfAxisDropZone } from "@/components/shelf/ShelfAxisDropZone";
import { useVisualizationEncodingChange } from "@/components/visualizations/useVisualizationEncodingChange";
import {
  extractColumnAliasComponents,
  fieldIdToColumnAlias,
  getMetricDisplayLabel,
} from "@dashframe/engine";
import type {
  ColumnAnalysis,
  CompiledInsight,
  DataFrameColumn,
  DataTable,
  Field,
  UUID,
  Visualization,
  VisualizationType,
} from "@dashframe/types";
import {
  CHART_TYPE_METADATA,
  fieldEncoding,
  metricEncoding,
} from "@dashframe/types";
import {
  CHART_ICONS,
  OverlayScrollArea,
  SelectField,
  WorkbenchJumpBar,
  WorkbenchPaneHeader,
  WorkbenchPaneSection,
  useWorkbenchPaneSections,
} from "@dashframe/ui";
import { Button, Tooltip, cn } from "@wystack/ui-react";
import { BarChart3, Crosshair } from "lucide-react";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";

const VISUALIZATION_SECTION_IDS = ["chart-type", "encodings"] as const;
type VisualizationSection = (typeof VISUALIZATION_SECTION_IDS)[number];

const VISUALIZATION_SECTIONS = [
  { id: "chart-type", label: "Chart type", icon: BarChart3 },
  { id: "encodings", label: "Encodings", icon: Crosshair },
] as const;

export const INSIGHT_CANVAS_CHART_TYPES: VisualizationType[] = [
  "barY",
  "barX",
  "line",
  "areaY",
  "dot",
  "hexbin",
  "heatmap",
  "raster",
];

interface VisualizationConfigPanelProps {
  activeChartType: VisualizationType;
  availableChartTypes: ReadonlySet<VisualizationType>;
  /** Validates a type change against the visualization's pending state. */
  canChangeChartType?: (
    visualization: Pick<Visualization, "visualizationType" | "encoding">,
    chartType: VisualizationType,
  ) => boolean;
  activeVisualization?: Visualization;
  compiledInsight: CompiledInsight;
  /** Color the chart takes from a pivoted field while its own color is unset. */
  pivotColor?: string;
  dataTable: DataTable;
  availableFields: Field[];
  metricLabelFields?: Field[];
  availableColumns: DataFrameColumn[];
  columnDisplayNames: Record<string, string>;
  columnAnalysis: ColumnAnalysis[];
  encodingsError?: boolean;
  onRetryEncodings?: () => void;
  onPendingVisualizationChange?: (pending: boolean) => void;
  updateVisualization: (args: {
    id: UUID;
    updates: Partial<
      Pick<Visualization, "visualizationType" | "encoding" | "spec">
    >;
  }) => Promise<unknown>;
}

/**
 * Encodings laid out where they land on the chart: legend channels on top,
 * Y at the head of the vertical axis, X under the baseline. Every control
 * keeps its label above it, so no position depends on the pane's width.
 */
function EncodingMap({
  legend,
  y,
  x,
}: {
  legend: React.ReactNode;
  y: React.ReactNode;
  x: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="grid grid-cols-2 gap-1.5 [&>*]:min-w-0">{legend}</div>
      <div className="ml-1 border-b border-l border-neutral-border pb-8 pl-2">
        <div className="w-4/5 min-w-0">{y}</div>
      </div>
      <div className="ml-auto w-4/5 min-w-0">{x}</div>
    </div>
  );
}

function SavedEncodings({
  visualization,
  compiledInsight,
  pivotColor,
  availableFields,
  metricLabelFields,
  availableColumns,
  columnDisplayNames,
  columnAnalysis,
  onEncodingChange,
  tableId,
}: Pick<
  VisualizationConfigPanelProps,
  | "compiledInsight"
  | "pivotColor"
  | "availableFields"
  | "metricLabelFields"
  | "availableColumns"
  | "columnDisplayNames"
  | "columnAnalysis"
> & {
  visualization: Visualization;
  onEncodingChange: (
    field: "x" | "y" | "color" | "size",
    value: string,
  ) => void;
  tableId: string | undefined;
}) {
  const encodingsReady = columnAnalysis.length > 0;
  const options = useMemo(() => {
    const result: Array<{ label: string; value: string }> =
      compiledInsight.dimensions.map((field) => ({
        label: columnDisplayNames[fieldIdToColumnAlias(field.id)] ?? field.name,
        value: fieldEncoding(field.id as UUID),
      }));
    const added = new Set(result.map((option) => option.value));
    for (const field of availableFields) {
      const value = fieldEncoding(field.id as UUID);
      if (added.has(value)) continue;
      const components = extractColumnAliasComponents(
        fieldIdToColumnAlias(field.id),
      );
      if (!components || components.instanceIndex === 0) continue;
      result.push({
        label: columnDisplayNames[fieldIdToColumnAlias(field.id)] ?? field.name,
        value,
      });
      added.add(value);
    }
    result.push(
      ...compiledInsight.metrics.map((metric) => ({
        label: getMetricDisplayLabel(
          metric,
          metricLabelFields ?? availableFields,
          columnDisplayNames,
        ),
        value: metricEncoding(metric.id),
      })),
    );
    return result;
  }, [
    availableFields,
    metricLabelFields,
    columnDisplayNames,
    compiledInsight.dimensions,
    compiledInsight.metrics,
  ]);

  const pivotLabel = options.find(
    (option) => option.value === pivotColor,
  )?.label;

  return (
    <>
      <EncodingMap
        legend={
          <>
            <SelectField
              label="Color"
              value={visualization.encoding?.color || ""}
              onChange={(value) => onEncodingChange("color", value)}
              onClear={() => onEncodingChange("color", "")}
              options={options}
              placeholder={pivotLabel ?? "None"}
              emptyDashed
              disabled={!encodingsReady}
            />
            {visualization.visualizationType === "dot" && (
              <SelectField
                label="Size"
                value={visualization.encoding?.size || ""}
                onChange={(value) => onEncodingChange("size", value)}
                onClear={() => onEncodingChange("size", "")}
                options={options}
                placeholder="None"
                emptyDashed
                disabled={!encodingsReady}
              />
            )}
            {pivotLabel && !visualization.encoding?.color && (
              <p className="col-span-2 text-xs text-neutral-fg-subtle">
                Color follows the {pivotLabel} pivot.
              </p>
            )}
          </>
        }
        y={
          <ShelfAxisDropZone
            axis="y"
            insightId={compiledInsight.id}
            tableId={tableId}
            metrics={compiledInsight.metrics}
            columnAnalysis={columnAnalysis}
            onSet={(value) => onEncodingChange("y", value)}
          >
            <AxisSelectField
              label="Y"
              value={visualization.encoding?.y || ""}
              onChange={(value) => onEncodingChange("y", value)}
              placeholder="None"
              emptyDashed
              disabled={!encodingsReady}
              axis="y"
              chartType={visualization.visualizationType}
              columnAnalysis={columnAnalysis}
              compiledInsight={compiledInsight}
              availableFields={availableFields}
              metricLabelFields={metricLabelFields}
              availableColumns={availableColumns}
              columnDisplayNames={columnDisplayNames}
              otherAxisColumn={visualization.encoding?.x}
            />
          </ShelfAxisDropZone>
        }
        x={
          <AxisSelectField
            label="X"
            value={visualization.encoding?.x || ""}
            onChange={(value) => onEncodingChange("x", value)}
            placeholder="None"
            emptyDashed
            disabled={!encodingsReady}
            axis="x"
            chartType={visualization.visualizationType}
            columnAnalysis={columnAnalysis}
            compiledInsight={compiledInsight}
            availableFields={availableFields}
            metricLabelFields={metricLabelFields}
            availableColumns={availableColumns}
            columnDisplayNames={columnDisplayNames}
            otherAxisColumn={visualization.encoding?.y}
          />
        }
      />
      {!encodingsReady && (
        <p className="mt-2 text-[11px] leading-4 text-neutral-fg-subtle">
          Loading encoding options…
        </p>
      )}
    </>
  );
}

export function VisualizationConfigPanel({
  activeChartType,
  availableChartTypes,
  canChangeChartType,
  activeVisualization,
  compiledInsight,
  pivotColor,
  dataTable,
  availableFields,
  metricLabelFields,
  availableColumns,
  columnDisplayNames,
  columnAnalysis,
  encodingsError = false,
  onRetryEncodings,
  onPendingVisualizationChange,
  updateVisualization,
}: VisualizationConfigPanelProps) {
  const {
    openSections,
    allCollapsed,
    setSectionOpen,
    jumpToSection,
    toggleAll,
    registerSection,
  } = useWorkbenchPaneSections(VISUALIZATION_SECTION_IDS);
  const handleEncodingUpdateError = useCallback(
    () => toast.error("Failed to update chart encodings"),
    [],
  );
  const { changeEncoding, changeType, effectiveVisualization } =
    useVisualizationEncodingChange({
      visualization: activeVisualization,
      dataTable,
      columnAnalysis,
      compiledInsight,
      updateVisualization,
      onUpdateError: handleEncodingUpdateError,
      onPendingChange: onPendingVisualizationChange,
      canChangeType: canChangeChartType,
    });
  const handleEncodingChange = (
    field: "x" | "y" | "color" | "size",
    value: string,
  ) => {
    changeEncoding(field, value).catch(() =>
      toast.error("Failed to update chart encodings"),
    );
  };
  const selectedMetadata = CHART_TYPE_METADATA[activeChartType];
  const handleChartTypeChange = (chartType: VisualizationType) => {
    if (!activeVisualization || !availableChartTypes.has(chartType)) return;
    changeType(chartType).catch(() =>
      toast.error("Failed to update chart type"),
    );
  };

  const renderSection = (
    id: VisualizationSection,
    summary: string,
    children: React.ReactNode,
  ) => {
    const section = VISUALIZATION_SECTIONS.find((item) => item.id === id)!;
    return (
      <WorkbenchPaneSection
        key={id}
        ref={registerSection(id)}
        title={section.label}
        icon={section.icon}
        open={openSections[id]}
        summary={summary}
        onOpenChange={(open) => setSectionOpen(id, open)}
      >
        {children}
      </WorkbenchPaneSection>
    );
  };
  let encodingContent: React.ReactNode;
  if (activeVisualization && encodingsError) {
    encodingContent = (
      <div className="space-y-2 text-[11px] leading-4 text-neutral-fg-subtle">
        <p>Couldn't load encoding options.</p>
        {onRetryEncodings && (
          <Button
            label="Retry"
            size="sm"
            variant="outline"
            onClick={onRetryEncodings}
          />
        )}
      </div>
    );
  } else if (activeVisualization && effectiveVisualization) {
    encodingContent = (
      <SavedEncodings
        visualization={{ ...activeVisualization, ...effectiveVisualization }}
        compiledInsight={compiledInsight}
        pivotColor={pivotColor}
        availableFields={availableFields}
        metricLabelFields={metricLabelFields}
        availableColumns={availableColumns}
        columnDisplayNames={columnDisplayNames}
        columnAnalysis={columnAnalysis}
        onEncodingChange={handleEncodingChange}
        tableId={dataTable.id}
      />
    );
  } else if (activeVisualization) {
    encodingContent = (
      <p className="text-[11px] leading-4 text-neutral-fg-subtle">
        Loading encoding options…
      </p>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-neutral-bg text-xs">
      <WorkbenchPaneHeader title="Visualization">
        <WorkbenchJumpBar
          items={VISUALIZATION_SECTIONS}
          onJump={(id) => jumpToSection(id as VisualizationSection)}
          allCollapsed={allCollapsed}
          onToggleAll={toggleAll}
        />
      </WorkbenchPaneHeader>
      <OverlayScrollArea className="min-h-0 flex-1">
        <div className="px-3 pb-3">
          {renderSection(
            "chart-type",
            selectedMetadata.displayName,
            <>
              <div className="grid grid-cols-4 gap-1.5">
                {INSIGHT_CANVAS_CHART_TYPES.map((chartType) => {
                  const Icon = CHART_ICONS[chartType];
                  const selected = chartType === activeChartType;
                  const available = availableChartTypes.has(chartType);
                  const tooltip = available
                    ? CHART_TYPE_METADATA[chartType].displayName
                    : "No suitable fields are available for this chart type.";
                  return (
                    <Tooltip key={chartType} content={tooltip}>
                      <Button
                        size="sm"
                        variant="ghost"
                        label={CHART_TYPE_METADATA[chartType].displayName}
                        active={selected}
                        aria-pressed={selected}
                        onClick={() => handleChartTypeChange(chartType)}
                        className={cn(
                          "aspect-square h-auto w-full",
                          selected
                            ? "bg-neutral-bg-emphasis text-neutral-fg hover:bg-neutral-bg-emphasis"
                            : "bg-neutral-bg-subtle text-neutral-fg-subtle hover:bg-neutral-bg-muted hover:text-neutral-fg",
                          !available &&
                            !selected &&
                            "cursor-not-allowed opacity-40 hover:bg-neutral-bg-subtle hover:text-neutral-fg-subtle",
                        )}
                      >
                        <Icon size={20} aria-hidden />
                        <span className="sr-only">
                          {CHART_TYPE_METADATA[chartType].displayName}
                          {!available && ", no suitable fields"}
                        </span>
                      </Button>
                    </Tooltip>
                  );
                })}
              </div>
              <div className="flex items-start justify-between gap-2 px-0.5 pt-2">
                <span className="font-medium text-neutral-fg">
                  {selectedMetadata.displayName}
                </span>
                <span className="text-right text-[11px] leading-4 text-neutral-fg-subtle">
                  {selectedMetadata.description}
                </span>
              </div>
            </>,
          )}
          {renderSection(
            "encodings",
            activeVisualization ? "Editable" : "Read-only",
            encodingContent,
          )}
        </div>
      </OverlayScrollArea>
    </div>
  );
}
