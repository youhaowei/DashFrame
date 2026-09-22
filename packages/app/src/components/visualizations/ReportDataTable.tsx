import { ReportKpis } from "./ReportKpis";
import {
  buildReportGrid,
  fieldIdToColumnAlias,
  formatReportValue,
} from "@dashframe/engine";
import type { Insight } from "@dashframe/types";
import {
  VirtualTable,
  type FetchDataParams,
  type FetchDataResult,
} from "@dashframe/ui";
import { ErrorState, Spinner } from "@wystack/ui-react";
import { useEffect, useMemo, useState } from "react";

interface ReportDataTableProps {
  insight: Insight;
  fetchData: (params: FetchDataParams) => Promise<FetchDataResult>;
  totalCount: number;
  columnDisplayNames: Record<string, string>;
}

function dimensionLabel(value: unknown): string {
  if (value === null || value === undefined) return "(empty)";
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
  const [state, setState] = useState<{
    fetch: typeof fetchData;
    rows?: Record<string, unknown>[];
    error?: string;
  }>();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (totalCount > 250000)
          throw new Error(
            "Set a report limit before opening this pivot; it exceeds 250,000 result rows.",
          );
        const rows: Record<string, unknown>[] = [];
        while (rows.length < totalCount) {
          const page = await fetchData({
            offset: rows.length,
            limit: Math.min(500, totalCount - rows.length),
          });
          if (cancelled) return;
          if (page.totalCount !== totalCount || page.rows.length === 0)
            throw new Error(
              "The report changed or could not be fully loaded. Refresh it to retry.",
            );
          rows.push(...page.rows);
        }
        if (!cancelled) setState({ fetch: fetchData, rows });
      } catch (cause) {
        if (!cancelled)
          setState({
            fetch: fetchData,
            error:
              cause instanceof Error
                ? cause.message
                : "Could not load the report.",
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchData, totalCount]);
  const table = useMemo(() => {
    if (state?.fetch !== fetchData || !state.rows) return null;
    const grid = buildReportGrid(state.rows, insight);
    const dimensionColumns = grid.rowDimensions.map((id) => ({
      id: fieldIdToColumnAlias(id),
      label: columnDisplayNames[fieldIdToColumnAlias(id)] ?? id,
      format: dimensionLabel,
    }));
    if (!dimensionColumns.length)
      dimensionColumns.push({
        id: "report_label",
        label: "Report",
        format: dimensionLabel,
      });
    const measureColumns = grid.columns.map((column) => ({
      id: column.key,
      label: [
        ...(column.total ? ["Total"] : column.values.map(dimensionLabel)),
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
