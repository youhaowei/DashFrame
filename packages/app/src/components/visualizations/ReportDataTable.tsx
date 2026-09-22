import { ReportKpis } from "./ReportKpis";
import {
  buildReportGrid,
  fieldIdToColumnAlias,
  formatReportValue,
} from "@dashframe/engine";
import type { DateGrain, Insight } from "@dashframe/types";
import {
  VirtualTable,
  type FetchDataParams,
  type FetchDataResult,
} from "@dashframe/ui";
import { ErrorState, Spinner } from "@wystack/ui-react";
import { useMemo } from "react";
import { useReportRows } from "@/hooks/useReportRows";

interface ReportDataTableProps {
  insight: Insight;
  fetchData: (params: FetchDataParams) => Promise<FetchDataResult>;
  totalCount: number;
  columnDisplayNames: Record<string, string>;
}

function dimensionLabel(value: unknown, grain?: DateGrain): string {
  if (value === null || value === undefined) return "(empty)";
  if (
    grain &&
    (typeof value === "number" ||
      typeof value === "string" ||
      value instanceof Date)
  ) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) {
      const iso = date.toISOString();
      if (grain === "year") return iso.slice(0, 4);
      if (grain === "quarter")
        return `${iso.slice(0, 4)} Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
      if (grain === "month") return iso.slice(0, 7);
      return iso.slice(0, 10);
    }
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

export function hasReportTable(
  insight: Insight | undefined,
): insight is Insight {
  return Boolean(
    insight?.metrics.length &&
    (insight.reporting || insight.metrics.some((metric) => metric.format)),
  );
}

/** Render the shared result frame; never aggregate cells in the browser. */
export function ReportDataTable({
  insight,
  fetchData,
  totalCount,
  columnDisplayNames,
}: ReportDataTableProps) {
  const state = useReportRows(fetchData, totalCount);
  const table = useMemo(() => {
    if (state?.fetch !== fetchData || !state.rows) return null;
    const grid = buildReportGrid(state.rows, insight);
    const dimensionColumns = grid.rowDimensions.map((id) => ({
      id: fieldIdToColumnAlias(id),
      label: columnDisplayNames[fieldIdToColumnAlias(id)] ?? id,
      format: (value: unknown) =>
        dimensionLabel(value, insight.reporting?.dateGrains?.[id]),
    }));
    if (!dimensionColumns.length)
      dimensionColumns.push({
        id: "report_label",
        label: "Report",
        format: dimensionLabel,
      });
    const pivotDimensions = insight.selectedFields.filter((id) =>
      insight.reporting?.pivotFields?.includes(id),
    );
    const measureColumns = grid.columns.map((column) => ({
      id: column.key,
      label: [
        ...(column.total
          ? ["Total"]
          : column.values.map((value, index) =>
              dimensionLabel(
                value,
                insight.reporting?.dateGrains?.[pivotDimensions[index]!],
              ),
            )),
        column.label,
      ].join(" · "),
      align: "right" as const,
      format: (value: unknown) => formatReportValue(value, column),
    }));
    const configs = [...dimensionColumns, ...measureColumns];
    return {
      configs,
      columns: configs.map(({ id }) => ({ name: id })),
      rows: grid.rows.map((row) => ({
        ...row.cells,
        ...Object.fromEntries(
          dimensionColumns.map((column, index) => {
            let value: unknown = "All records";
            if (row.total) value = index === 0 ? "Total" : "";
            else if (grid.rowDimensions.length) value = row.values[index];
            return [column.id, value];
          }),
        ),
      })),
    };
  }, [state, fetchData, insight, columnDisplayNames]);
  if (state?.fetch === fetchData && state.error)
    return (
      <ErrorState
        title="Couldn't load report"
        description={state.error}
        retryAction={{ label: "Retry", onClick: state.retry }}
        size="sm"
      />
    );
  if (!table)
    return (
      <div
        className="flex h-full items-center justify-center"
        role="status"
        aria-label="Loading report"
      >
        <Spinner />
      </div>
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReportKpis insight={insight} rows={state?.rows ?? []} />
      <div className="min-h-0 flex-1">
        <VirtualTable
          rows={table.rows}
          columns={table.columns}
          columnConfigs={table.configs}
          height="100%"
          compact
        />
      </div>
    </div>
  );
}
