import { AxisSelectField } from "@/components/visualizations/AxisSelectField";
import { useVisualizationEncodingChange } from "@/components/visualizations/useVisualizationEncodingChange";
import { getVisualizationTypeChange } from "@/components/visualizations/visualization-type-change";
import {
  extractColumnAliasComponents,
  fieldIdToColumnAlias,
  formatAggregationLabel,
  getMetricDisplayLabel,
} from "@dashframe/engine";
import type {
  ChartEncoding,
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
  SelectField,
  WorkbenchJumpBar,
  WorkbenchPaneSection,
  useWorkbenchPaneSections,
} from "@dashframe/ui";
import { Button, Tooltip, cn } from "@wystack/ui-react";
import { BarChart3, Bookmark, Crosshair } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

const VISUALIZATION_SECTION_IDS = [
  "chart-type",
  "encodings",
  "saved-charts",
] as const;
type VisualizationSection = (typeof VISUALIZATION_SECTION_IDS)[number];

const VISUALIZATION_SECTIONS = [
  { id: "chart-type", label: "Chart type", icon: BarChart3 },
  { id: "encodings", label: "Encodings", icon: Crosshair },
  { id: "saved-charts", label: "Saved charts", icon: Bookmark },
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
  activeSuggestionEncoding?: ChartEncoding;
  activeVisualization?: Visualization;
  visualizations: Visualization[];
  compiledInsight: CompiledInsight;
  dataTable: DataTable;
  availableFields: Field[];
  availableColumns: DataFrameColumn[];
  columnDisplayNames: Record<string, string>;
  columnAnalysis: ColumnAnalysis[];
  onSelectChartType: (chartType: VisualizationType) => void;
  onSelectVisualization: (visualizationId: UUID) => void;
  updateVisualization: (args: {
    id: UUID;
    updates: Partial<
      Pick<Visualization, "visualizationType" | "encoding" | "spec">
    >;
  }) => Promise<unknown>;
}

function ReadOnlySlot({
  label,
  value,
  className,
}: {
  label: string;
  value?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      {label && (
        <span className="mb-1 block text-[11px] text-neutral-fg-subtle">
          {label}
        </span>
      )}
      <div
        className={cn(
          "truncate rounded-md border border-neutral-border bg-neutral-bg-subtle px-2 py-1.5 text-xs",
          !value && "border-dashed text-neutral-fg-subtle",
        )}
      >
        {value || "None"}
      </div>
    </div>
  );
}

function unwrapSuggestionValue(value: string): string {
  const aggregate = value.match(
    /^(?:sum|avg|count|min|max|count_distinct)\(([^)]+)\)$/i,
  );
  if (aggregate?.[1]) return aggregate[1];
  const legacyDate = value.match(
    /^(?:dateMonth|dateYear|dateDay|monthname|dayname|quarter)\(([^)]+)\)$/i,
  );
  if (legacyDate?.[1]) return legacyDate[1];
  const dateTrunc = value.match(/^date_trunc\('[^']+',\s*"([^"]+)"\)$/i);
  return (dateTrunc?.[1] ?? value).replace(/(?:^["'])|(?:["']$)/g, "");
}

export function getUnsavedEncodingLabel(
  value: string | undefined,
  fields: Field[],
  metrics: CompiledInsight["metrics"],
  columnDisplayNames: Record<string, string>,
): string | undefined {
  if (!value) return undefined;
  const rawColumn = unwrapSuggestionValue(value);
  const field = fields.find(
    (candidate) =>
      fieldIdToColumnAlias(candidate.id) === rawColumn ||
      candidate.columnName === rawColumn ||
      candidate.name === rawColumn,
  );
  const fieldLabel =
    columnDisplayNames[rawColumn] ?? field?.name ?? "Unavailable field";
  const aggregate = value.match(
    /^(sum|avg|count|min|max|count_distinct)\(([^)]+)\)$/i,
  );
  if (!aggregate?.[1]) return fieldLabel;

  const aggregation =
    aggregate[1].toLowerCase() as (typeof metrics)[number]["aggregation"];
  const metric = metrics.find(
    (candidate) =>
      candidate.aggregation === aggregation &&
      (candidate.columnName === rawColumn ||
        fields.some(
          (candidateField) =>
            candidateField.columnName === candidate.columnName &&
            fieldIdToColumnAlias(candidateField.id) === rawColumn,
        )),
  );
  return metric
    ? getMetricDisplayLabel(metric, fields)
    : `${formatAggregationLabel(aggregation)} of ${fieldLabel}`;
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

function UnsavedEncodings({
  encoding,
  fields,
  metrics,
  columnDisplayNames,
}: {
  encoding?: ChartEncoding;
  fields: Field[];
  metrics: CompiledInsight["metrics"];
  columnDisplayNames: Record<string, string>;
}) {
  const label = (value: string | undefined) =>
    getUnsavedEncodingLabel(value, fields, metrics, columnDisplayNames);
  return (
    <>
      <EncodingMap
        legend={
          <>
            <ReadOnlySlot label="Color" value={label(encoding?.color)} />
            <ReadOnlySlot label="Size" value={label(encoding?.size)} />
          </>
        }
        y={<ReadOnlySlot label="Y" value={label(encoding?.y)} />}
        x={<ReadOnlySlot label="X" value={label(encoding?.x)} />}
      />
      <p className="mt-2 text-[11px] leading-4 text-neutral-fg-subtle">
        Save this chart to edit its encodings.
      </p>
    </>
  );
}

function SavedEncodings({
  visualization,
  compiledInsight,
  dataTable,
  availableFields,
  availableColumns,
  columnDisplayNames,
  columnAnalysis,
  updateVisualization,
}: Pick<
  VisualizationConfigPanelProps,
  | "compiledInsight"
  | "dataTable"
  | "availableFields"
  | "availableColumns"
  | "columnDisplayNames"
  | "columnAnalysis"
  | "updateVisualization"
> & { visualization: Visualization }) {
  const handleEncodingChange = useVisualizationEncodingChange({
    visualization,
    dataTable,
    columnAnalysis,
    updateVisualization,
  });
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
        label: getMetricDisplayLabel(metric, availableFields),
        value: metricEncoding(metric.id),
      })),
    );
    return result;
  }, [
    availableFields,
    columnDisplayNames,
    compiledInsight.dimensions,
    compiledInsight.metrics,
  ]);

  return (
    <>
      <EncodingMap
        legend={
          <>
            <SelectField
              label="Color"
              value={visualization.encoding?.color || ""}
              onChange={(value) => handleEncodingChange("color", value)}
              options={options}
              placeholder="None"
              emptyDashed
              disabled={!encodingsReady}
            />
            <SelectField
              label="Size"
              value={visualization.encoding?.size || ""}
              onChange={(value) => handleEncodingChange("size", value)}
              options={options}
              placeholder="None"
              emptyDashed
              disabled={!encodingsReady}
            />
          </>
        }
        y={
          <AxisSelectField
            label="Y"
            value={visualization.encoding?.y || ""}
            onChange={(value) => handleEncodingChange("y", value)}
            placeholder="None"
            emptyDashed
            disabled={!encodingsReady}
            axis="y"
            chartType={visualization.visualizationType}
            columnAnalysis={columnAnalysis}
            compiledInsight={compiledInsight}
            availableFields={availableFields}
            availableColumns={availableColumns}
            columnDisplayNames={columnDisplayNames}
            otherAxisColumn={visualization.encoding?.x}
          />
        }
        x={
          <AxisSelectField
            label="X"
            value={visualization.encoding?.x || ""}
            onChange={(value) => handleEncodingChange("x", value)}
            placeholder="None"
            emptyDashed
            disabled={!encodingsReady}
            axis="x"
            chartType={visualization.visualizationType}
            columnAnalysis={columnAnalysis}
            compiledInsight={compiledInsight}
            availableFields={availableFields}
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
  activeSuggestionEncoding,
  activeVisualization,
  visualizations,
  compiledInsight,
  dataTable,
  availableFields,
  availableColumns,
  columnDisplayNames,
  columnAnalysis,
  onSelectChartType,
  onSelectVisualization,
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
  const selectedMetadata = CHART_TYPE_METADATA[activeChartType];
  const handleChartTypeChange = (chartType: VisualizationType) => {
    if (!availableChartTypes.has(chartType)) return;
    if (!activeVisualization) {
      onSelectChartType(chartType);
      return;
    }
    const updates = getVisualizationTypeChange(activeVisualization, chartType);
    if (!updates) return;
    updateVisualization({ id: activeVisualization.id, updates }).catch(() =>
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

  return (
    <div className="min-h-full min-w-0 overflow-x-hidden bg-neutral-bg px-3 py-3 text-xs">
      <h2 className="px-0.5 pb-2 text-sm font-semibold">Visualization</h2>
      <WorkbenchJumpBar
        items={VISUALIZATION_SECTIONS}
        onJump={(id) => jumpToSection(id as VisualizationSection)}
        allCollapsed={allCollapsed}
        onToggleAll={toggleAll}
      />
      <div className="mt-2">
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
                      // aria-disabled keeps the tooltip explaining why.
                      aria-disabled={!available}
                      onClick={() => handleChartTypeChange(chartType)}
                      className={cn(
                        "aspect-square h-auto w-full",
                        selected
                          ? "bg-neutral-bg-emphasis text-neutral-fg hover:bg-neutral-bg-emphasis"
                          : "bg-neutral-bg-subtle text-neutral-fg-subtle hover:bg-neutral-bg-muted hover:text-neutral-fg",
                        !available &&
                          "cursor-not-allowed opacity-40 hover:bg-neutral-bg-subtle hover:text-neutral-fg-subtle",
                      )}
                    >
                      <Icon size={20} aria-hidden />
                      <span className="sr-only">
                        {CHART_TYPE_METADATA[chartType].displayName}
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
          activeVisualization ? (
            <SavedEncodings
              visualization={activeVisualization}
              compiledInsight={compiledInsight}
              dataTable={dataTable}
              availableFields={availableFields}
              availableColumns={availableColumns}
              columnDisplayNames={columnDisplayNames}
              columnAnalysis={columnAnalysis}
              updateVisualization={updateVisualization}
            />
          ) : (
            <UnsavedEncodings
              encoding={activeSuggestionEncoding}
              fields={availableFields}
              metrics={compiledInsight.metrics}
              columnDisplayNames={columnDisplayNames}
            />
          ),
        )}
        {renderSection(
          "saved-charts",
          `${visualizations.length} saved`,
          visualizations.length > 0 ? (
            <div className="space-y-1">
              {visualizations.map((visualization) => {
                const Icon = CHART_ICONS[visualization.visualizationType];
                const selected = activeVisualization?.id === visualization.id;
                return (
                  <Button
                    key={visualization.id}
                    size="sm"
                    variant="ghost"
                    active={selected}
                    aria-pressed={selected}
                    label={visualization.name}
                    onClick={() => onSelectVisualization(visualization.id)}
                    className={cn(
                      "w-full justify-start",
                      selected &&
                        "bg-neutral-bg-emphasis hover:bg-neutral-bg-emphasis",
                    )}
                  >
                    <Icon size={14} aria-hidden />
                    <span className="truncate">{visualization.name}</span>
                  </Button>
                );
              })}
            </div>
          ) : (
            <p className="px-1 py-2 text-neutral-fg-subtle">
              Save a chart to reuse it in reports.
            </p>
          ),
        )}
      </div>
    </div>
  );
}
