import { formatCellValue } from "@/lib/cell-formatter";
import {
  CHART_STARTER_RULE_LABELS,
  MAX_CHART_STARTER_SUGGESTIONS,
  starterColumnFieldId,
  type ChartStarterSuggestion,
} from "@/lib/visualizations/chart-starter";
import {
  useChartStarterPoints,
  type ChartStarterPoint,
} from "@/lib/visualizations/chart-starter-data";
import { api } from "@dashframe/convex-backend/api";
import { metricIdToColumnAlias } from "@dashframe/engine";
import {
  buildInsightUpdateCommands,
  type ColumnAnalysis,
  type ColumnType,
  type Command,
  type DataTable,
  type Field,
  type Insight,
  type VisualizationType,
} from "@dashframe/types";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@wystack/ui-react";
import { ChevronDownIcon } from "@wystack/ui-react/icons";
import { useMutation } from "convex/react";
import { Hash, Rows3, Sigma } from "lucide-react";
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { FieldTypeIcon } from "./config-panel/FieldsSection";
import { buildDefaultMetric } from "./config-panel/MetricsSection";

/** The empty chart's table: the rows it was opened on, before any pick. */
export interface ChartStarterSample {
  schema: readonly { id: string; name: string; type: string }[];
  rows: readonly Record<string, unknown>[];
  totalCount: number;
  analysis: readonly ColumnAnalysis[];
}

type StarterInsight = Pick<
  Insight,
  | "id"
  | "source"
  | "selectedFields"
  | "metrics"
  | "filters"
  | "sorts"
  | "joins"
  | "runtimeControls"
  | "reporting"
>;

/** "Total Sales by Date": the name the chart lands with. */
export function chartStarterTitle(
  dataTable: DataTable,
  suggestion: ChartStarterSuggestion,
): string {
  const metric = buildDefaultMetric(
    dataTable,
    suggestion.aggregation,
    suggestion.measure?.columnName,
  );
  return `${metric.name} by ${suggestion.group.name}`;
}

/**
 * A suggestion's writes: its grouping field and metric (and, for a sorted
 * bar, a largest-first sort), as one insight update — the same commands the
 * left pane's pickers send.
 */
export function buildChartStarterCommands(
  insight: StarterInsight,
  dataTable: DataTable,
  suggestion: ChartStarterSuggestion,
): Command[] {
  const metric = buildDefaultMetric(
    dataTable,
    suggestion.aggregation,
    suggestion.measure?.columnName,
  );
  return buildInsightUpdateCommands(insight.id, insight, {
    selectedFields: [suggestion.group.id],
    metrics: [metric],
    ...(suggestion.sortByValue
      ? {
          sorts: [
            { field: metricIdToColumnAlias(metric.id), direction: "desc" },
          ],
        }
      : {}),
  });
}

export type ChartStarterColumnAction = "group" | "metric" | "count";

/** A column-header action: adds a grouping field or a metric, like the pickers. */
export function buildColumnActionCommands(
  insight: StarterInsight,
  dataTable: DataTable,
  field: Field,
  action: ChartStarterColumnAction,
): Command[] {
  if (action === "group") {
    if (insight.selectedFields.includes(field.id)) return [];
    return buildInsightUpdateCommands(insight.id, insight, {
      selectedFields: [...insight.selectedFields, field.id],
    });
  }
  const metric =
    action === "count"
      ? buildDefaultMetric(dataTable, "count")
      : buildDefaultMetric(dataTable, "sum", field.columnName);
  return buildInsightUpdateCommands(insight.id, insight, {
    metrics: [...(insight.metrics ?? []), metric],
  });
}

function isNumberType(type: string): boolean {
  return ["number", "integer", "float", "decimal", "int", "bigint"].includes(
    type.toLowerCase(),
  );
}

// ---------------------------------------------------------------------------
// Thumbnails: drawn from the card's own aggregate, never illustrated.
// ---------------------------------------------------------------------------

const THUMB_WIDTH = 180;
const THUMB_HEIGHT = 62;

function summary(points: readonly ChartStarterPoint[]): string {
  const shown = points
    .slice(0, 4)
    .map((point) => `${point.label} ${point.value.toLocaleString()}`);
  return points.length > 4 ? `${shown.join(", ")}, …` : shown.join(", ");
}

function Thumbnail({
  chartType,
  points,
}: {
  chartType: ChartStarterSuggestion["chartType"];
  points: readonly ChartStarterPoint[];
}) {
  const max = Math.max(0, ...points.map((point) => point.value));
  if (points.length === 0 || max <= 0) return null;
  const scale = (value: number) => Math.max(0, value) / max;
  let marks: ReactNode;
  if (chartType === "line") {
    const step =
      points.length > 1 ? (THUMB_WIDTH - 8) / (points.length - 1) : 0;
    const coordinates = points.map((point, index) => {
      const x = points.length > 1 ? 4 + index * step : THUMB_WIDTH / 2;
      const y = THUMB_HEIGHT - 4 - scale(point.value) * (THUMB_HEIGHT - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    marks = (
      <polyline
        points={coordinates.join(" ")}
        fill="none"
        className="stroke-chart-1"
        strokeWidth={1.75}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    );
  } else if (chartType === "barX") {
    const shown = points.slice(0, 6);
    const band = THUMB_HEIGHT / shown.length;
    marks = shown.map((point, index) => (
      <rect
        key={index}
        x={0}
        y={index * band + band * 0.12}
        width={Math.max(2, scale(point.value) * THUMB_WIDTH)}
        height={band * 0.76}
        rx={1.5}
        className="fill-chart-1"
      />
    ));
  } else {
    const band = THUMB_WIDTH / points.length;
    marks = points.map((point, index) => {
      const height = Math.max(2, scale(point.value) * (THUMB_HEIGHT - 3));
      return (
        <rect
          key={index}
          x={index * band + band * 0.18}
          y={THUMB_HEIGHT - height}
          width={band * 0.64}
          height={height}
          rx={1.5}
          className="fill-chart-1"
        />
      );
    });
  }
  return (
    <svg
      viewBox={`0 0 ${THUMB_WIDTH} ${THUMB_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={summary(points)}
      className="block h-full w-full"
    >
      {marks}
    </svg>
  );
}

function SuggestionCard({
  insight,
  suggestion,
  title,
  revision,
  exact,
  disabled,
  onPick,
  onUnfit,
}: {
  insight: StarterInsight;
  suggestion: ChartStarterSuggestion;
  title: string;
  revision: string;
  /** The rules saw every row, so their distinct counts are the table's. */
  exact: boolean;
  disabled: boolean;
  onPick: () => void;
  /** The table has more groups than the sampled rule saw. */
  onUnfit: (key: string) => void;
}) {
  const points = useChartStarterPoints(insight, suggestion, revision);
  const ruleId = useId();
  const unfit = points.status === "unfit";
  useEffect(() => {
    if (unfit) onUnfit(suggestion.key);
  }, [onUnfit, suggestion.key, unfit]);
  if (unfit) return null;
  // Pickable once its aggregate has confirmed the fit, or when it could not be
  // measured but the rules saw every row.
  const confirmed =
    points.status === "ready" || (points.status === "failed" && exact);
  return (
    <button
      type="button"
      disabled={disabled || !confirmed}
      onClick={onPick}
      aria-label={title}
      aria-describedby={ruleId}
      className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-neutral-bg-muted p-1.5 pb-2 text-left transition-[background-color,box-shadow] duration-200 hover:bg-neutral-bg-emphasis hover:shadow-[var(--surface-shadow)] focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none"
    >
      <span className="block h-[74px] rounded-md bg-neutral-bg px-2 py-1.5">
        {points.status === "ready" && (
          <Thumbnail chartType={suggestion.chartType} points={points.points} />
        )}
        {points.status === "failed" && (
          <span className="flex h-full items-center justify-center text-xs text-neutral-fg-subtle">
            Preview unavailable
          </span>
        )}
      </span>
      <span className="block px-1 text-xs leading-snug font-medium text-neutral-fg">
        {title}
      </span>
      <span
        id={ruleId}
        className="block px-1 text-xs leading-snug text-neutral-fg-subtle"
      >
        {CHART_STARTER_RULE_LABELS[suggestion.rule]}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Data preview with column-header actions.
// ---------------------------------------------------------------------------

function ColumnHeader({
  label,
  type,
  field,
  analysis,
  exact,
  insight,
  onAction,
}: {
  label: string;
  type: string;
  field: Field | undefined;
  analysis: ColumnAnalysis | undefined;
  /** The sample holds every row, so its distinct count is the table's. */
  exact: boolean;
  insight: StarterInsight;
  onAction: (field: Field, action: ChartStarterColumnAction) => void;
}) {
  const numeric = isNumberType(type);
  const content = (
    <>
      <FieldTypeIcon type={type} />
      <span className="truncate">{label}</span>
    </>
  );
  if (!field) {
    return (
      <span className="flex h-7 items-center gap-1.5 px-1.5 font-medium">
        {content}
      </span>
    );
  }
  const grouped = insight.selectedFields.includes(field.id);
  const counted = (insight.metrics ?? []).some(
    (metric) => metric.aggregation === "count" && !metric.columnName,
  );
  let distinct = label;
  if (exact && analysis && !numeric) {
    const count = analysis.cardinality;
    distinct = `${label} · ${count.toLocaleString()} distinct value${count === 1 ? "" : "s"}`;
  }
  const groupItem = (
    <DropdownMenuItem
      disabled={grouped}
      onClick={() => onAction(field, "group")}
    >
      <Rows3 />
      <span className="flex flex-col">
        <span className="font-medium">Group by {label}</span>
        <span className="text-xs text-neutral-fg-subtle">
          Adds {label} as a grouping
        </span>
      </span>
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${label} column actions`}
        className="group/header flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 font-medium text-neutral-fg-subtle transition-colors duration-150 hover:bg-neutral-bg-emphasis hover:text-neutral-fg focus-visible:bg-neutral-bg-emphasis focus-visible:text-neutral-fg focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none data-[popup-open]:bg-neutral-bg-emphasis data-[popup-open]:text-neutral-fg motion-reduce:transition-none"
      >
        {content}
        <ChevronDownIcon
          aria-hidden
          className="ml-auto size-3 shrink-0 opacity-0 transition-opacity duration-150 group-hover/header:opacity-100 group-focus-visible/header:opacity-100 group-data-[popup-open]/header:opacity-100 motion-reduce:transition-none"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-normal text-neutral-fg-subtle">
            {distinct}
          </DropdownMenuLabel>
          {numeric ? (
            <>
              <DropdownMenuItem onClick={() => onAction(field, "metric")}>
                <Sigma />
                <span className="flex flex-col">
                  <span className="font-medium">Use as metric</span>
                  <span className="text-xs text-neutral-fg-subtle">
                    Adds the total of {label}
                  </span>
                </span>
              </DropdownMenuItem>
              {groupItem}
            </>
          ) : (
            groupItem
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={counted}
          onClick={() => onAction(field, "count")}
        >
          <Hash />
          <span className="flex flex-col">
            <span className="font-medium">Count rows</span>
            <span className="text-xs text-neutral-fg-subtle">
              Uses the row count as the metric
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function rowCountLine(tableName: string, shown: number, total: number) {
  if (total <= shown)
    return `${tableName} · all ${total.toLocaleString()} row${total === 1 ? "" : "s"}`;
  return `${tableName} · first ${shown.toLocaleString()} of ${total.toLocaleString()} rows`;
}

export interface ChartStarterProps {
  insight: StarterInsight;
  /** The table the chart is authored on: its fields and saved metrics. */
  dataTable: DataTable;
  sample: ChartStarterSample;
  /**
   * Candidates in order; the first four that fit show. Empty once anything is
   * picked: then only the preview shows.
   */
  suggestions: readonly ChartStarterSuggestion[];
  /** The table generation the thumbnails are cached under. */
  sourceRevision: string;
  columnDisplayNames: Readonly<Record<string, string>>;
  /**
   * Called with the chart type of a picked suggestion before it is written,
   * and with `undefined` if that write fails, so the type does not linger.
   */
  onPickChartType?: (chartType: VisualizationType | undefined) => void;
}

/**
 * An empty chart's canvas: rule-based suggested charts above a preview of the
 * table's rows, whose column headers can add a grouping or a metric.
 */
export function ChartStarter({
  insight,
  dataTable,
  sample,
  suggestions,
  sourceRevision,
  columnDisplayNames,
  onPickChartType,
}: ChartStarterProps) {
  const commitBatch = useMutation(api.app.commitBatch);
  const [writing, setWriting] = useState(false);
  const fieldsById = new Map(
    (dataTable.fields ?? []).map((field) => [field.id as string, field]),
  );
  const analysisById = new Map(
    sample.analysis.map((column) => [column.columnName, column]),
  );
  const exact = sample.totalCount <= sample.rows.length;

  const write = (
    commands: Command[],
    failure: string,
    onFailed?: () => void,
  ) => {
    if (commands.length === 0) return;
    setWriting(true);
    commitBatch({ commands })
      .catch((error: unknown) => {
        console.error("[ChartStarter] write failed:", error);
        onFailed?.();
        toast.error(failure);
      })
      .finally(() => setWriting(false));
  };

  const pick = (suggestion: ChartStarterSuggestion) => {
    if (writing) return;
    onPickChartType?.(suggestion.chartType);
    write(
      buildChartStarterCommands(insight, dataTable, suggestion),
      "Couldn't start the chart",
      () => onPickChartType?.(undefined),
    );
  };

  const act = (field: Field, action: ChartStarterColumnAction) =>
    write(
      buildColumnActionCommands(insight, dataTable, field, action),
      action === "group" ? "Couldn't add the field" : "Couldn't add the metric",
    );

  // Cards that turned out not to fit drop out; the next candidates move up.
  const [unfitKeys, setUnfitKeys] = useState<ReadonlySet<string>>(new Set());
  const markUnfit = useCallback(
    (key: string) =>
      setUnfitKeys((keys) => (keys.has(key) ? keys : new Set(keys).add(key))),
    [],
  );
  const shown = suggestions
    .filter((suggestion) => !unfitKeys.has(suggestion.key))
    .slice(0, MAX_CHART_STARTER_SUGGESTIONS);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-1 pb-1">
      {shown.length > 0 && (
        <>
          <section aria-labelledby="chart-starter-suggested">
            <div className="flex flex-wrap items-baseline gap-x-2.5">
              <h2
                id="chart-starter-suggested"
                className="text-sm font-semibold text-neutral-fg"
              >
                Suggested charts
              </h2>
              <span className="text-xs text-neutral-fg-subtle">
                Built from {dataTable.name}. Pick one to start; change anything
                afterwards.
              </span>
            </div>
            <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
              {shown.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.key}
                  insight={insight}
                  suggestion={suggestion}
                  title={chartStarterTitle(dataTable, suggestion)}
                  revision={sourceRevision}
                  exact={exact}
                  disabled={writing}
                  onPick={() => pick(suggestion)}
                  onUnfit={markUnfit}
                />
              ))}
            </div>
          </section>
          <div aria-hidden className="h-px shrink-0 bg-neutral-border-subtle" />
        </>
      )}
      <section
        aria-labelledby="chart-starter-preview"
        className="flex min-h-48 flex-1 flex-col"
      >
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <h2
            id="chart-starter-preview"
            className="text-sm font-semibold text-neutral-fg"
          >
            Data preview
          </h2>
          <span className="text-xs text-neutral-fg-subtle">
            {rowCountLine(
              dataTable.name,
              sample.rows.length,
              sample.totalCount,
            )}
          </span>
        </div>
        <div className="mt-2 min-h-0 flex-1 overflow-auto rounded-lg bg-neutral-bg-subtle p-1 shadow-inner dark:bg-neutral-bg">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10 bg-neutral-bg-subtle dark:bg-neutral-bg">
              <tr>
                {sample.schema.map((column) => (
                  <th
                    key={column.id}
                    scope="col"
                    className="min-w-28 px-1 py-0.5 text-left align-middle text-xs font-normal whitespace-nowrap"
                  >
                    <ColumnHeader
                      label={columnDisplayNames[column.id] ?? column.name}
                      type={column.type}
                      field={fieldsById.get(starterColumnFieldId(column.id))}
                      analysis={analysisById.get(column.id)}
                      exact={exact}
                      insight={insight}
                      onAction={act}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sample.rows.map((row, index) => (
                <tr key={index}>
                  {sample.schema.map((column) => (
                    <td
                      key={column.id}
                      className={cn(
                        "border-t border-neutral-border-subtle px-2.5 py-1.5 whitespace-nowrap text-neutral-fg",
                        isNumberType(column.type) && "text-right tabular-nums",
                      )}
                    >
                      {formatCellValue(
                        row[column.id],
                        column.type as ColumnType,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
