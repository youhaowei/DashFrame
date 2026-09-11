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

function AxesFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-56 pt-1">
      <div
        aria-hidden
        className="absolute top-14 right-2 bottom-12 left-14 border-b border-l border-neutral-border"
      />
      {children}
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
      <AxesFrame>
        <div className="absolute top-0 right-0 grid w-40 min-w-0 grid-cols-2 gap-1.5 [&>*]:min-w-0">
          <ReadOnlySlot label="Color" value={label(encoding?.color)} />
          <ReadOnlySlot label="Size" value={label(encoding?.size)} />
        </div>
        <span
          aria-hidden
          className="absolute top-28 -left-1 -rotate-90 text-[11px] text-neutral-fg-subtle"
        >
          Y
        </span>
        <ReadOnlySlot
          label=""
          value={label(encoding?.y)}
          className="absolute top-20 left-3 w-28"
        />
        <ReadOnlySlot
          label="X"
          value={label(encoding?.x)}
          className="absolute right-2 bottom-0 left-14"
        />
      </AxesFrame>
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
      <AxesFrame>
        <div className="absolute top-0 right-0 grid w-40 min-w-0 grid-cols-2 gap-1.5 [&>*]:min-w-0">
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
        </div>
        <span
          aria-hidden
          className="absolute top-28 -left-1 -rotate-90 text-[11px] text-neutral-fg-subtle"
        >
          Y
        </span>
        <div className="absolute top-20 left-3 w-28">
          <AxisSelectField
            label="Y"
            showLabel={false}
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
        </div>
        <AxisSelectField
          label="X"
          value={visualization.encoding?.x || ""}
          onChange={(value) => handleEncodingChange("x", value)}
          placeholder="None"
          emptyDashed
          disabled={!encodingsReady}
          className="absolute right-2 bottom-0 left-14"
          axis="x"
          chartType={visualization.visualizationType}
          columnAnalysis={columnAnalysis}
          compiledInsight={compiledInsight}
          availableFields={availableFields}
          availableColumns={availableColumns}
          columnDisplayNames={columnDisplayNames}
          otherAxisColumn={visualization.encoding?.y}
        />
      </AxesFrame>
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
                      variant={selected ? "solid" : "ghost"}
                      label={CHART_TYPE_METADATA[chartType].displayName}
                      active={selected}
                      onClick={() => handleChartTypeChange(chartType)}
                      className={cn(
                        "aspect-square h-auto w-full",
                        !available && !selected && "opacity-40",
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
                    variant={selected ? "solid" : "ghost"}
                    active={selected}
                    aria-pressed={selected}
                    label={visualization.name}
                    onClick={() => onSelectVisualization(visualization.id)}
                    className="w-full justify-start"
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
