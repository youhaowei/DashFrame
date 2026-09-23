import type { Insight, MeasureFormat } from "@dashframe/types";
import { fieldIdToColumnAlias, metricIdToColumnAlias } from "./sql/insight-sql";

export function formatMeasureValue(
  value: unknown,
  format?: MeasureFormat,
): string {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "number" && typeof value !== "bigint") return "—";
  if (typeof value === "number" && !Number.isFinite(value)) return "—";
  const style = format?.style ?? "number";
  const currency = /^[A-Za-z]{3}$/.test(format?.currency ?? "")
    ? format!.currency
    : "USD";
  return new Intl.NumberFormat("en-US", {
    style: style === "number" ? "decimal" : style,
    ...(style === "currency" ? { currency } : {}),
    minimumFractionDigits: format?.decimals ?? (style === "number" ? 0 : 2),
    maximumFractionDigits: format?.decimals ?? 2,
  }).format(value);
}

/** Result-column formats travel with the canonical measure definitions. */
export function reportMeasureFormats(
  insight?: Insight | null,
): Record<string, MeasureFormat> {
  return Object.fromEntries(
    (insight?.metrics ?? []).map((metric) => [
      metricIdToColumnAlias(metric.id),
      metric.format ?? { style: "number" },
    ]),
  );
}

export interface ReportGrid {
  rowDimensions: string[];
  columns: Array<{
    key: string;
    values: unknown[];
    total: boolean;
    measureId: string;
    label: string;
    format?: MeasureFormat;
    comparison?: "previous" | "change" | "change_percent";
  }>;
  rows: Array<{
    key: string;
    values: unknown[];
    total: boolean;
    cells: Record<string, unknown>;
  }>;
}

function dimensionKey(values: unknown[]) {
  return values.map((value) => [
    typeof value,
    typeof value === "bigint" ? value.toString() : value,
  ]);
}

/** Presentation only: consume canonical aggregate cells; never sum/average them. */
export function buildReportGrid(
  data: readonly Record<string, unknown>[],
  insight: Insight,
): ReportGrid {
  const pivot = new Set(insight.reporting?.pivotFields ?? []);
  const dimensions = insight.selectedFields;
  const rowDimensions = dimensions.filter((id) => !pivot.has(id));
  const columnDimensions = dimensions.filter((id) => pivot.has(id));
  const rowMask = dimensions.reduce(
    (mask, id, index) =>
      pivot.has(id) ? mask : mask | (1 << (dimensions.length - index - 1)),
    0,
  );
  const columnMask = dimensions.reduce(
    (mask, id, index) =>
      pivot.has(id) ? mask | (1 << (dimensions.length - index - 1)) : mask,
    0,
  );
  const columns = new Map<string, ReportGrid["columns"][number]>();
  const rows = new Map<string, ReportGrid["rows"][number]>();
  for (const record of data) {
    const grouping = Number(record.__report_grouping ?? 0);
    const rowTotal = rowMask !== 0 && (grouping & rowMask) === rowMask;
    const columnTotal =
      columnMask !== 0 && (grouping & columnMask) === columnMask;
    const rowValues = rowDimensions.map(
      (id) => record[fieldIdToColumnAlias(id)],
    );
    const columnValues = columnDimensions.map(
      (id) => record[fieldIdToColumnAlias(id)],
    );
    const rowKey = JSON.stringify([rowTotal, dimensionKey(rowValues)]);
    let row = rows.get(rowKey);
    if (!row) {
      row = { key: rowKey, values: rowValues, total: rowTotal, cells: {} };
      rows.set(rowKey, row);
    }
    appendReportCells(columns, row, record, insight, columnValues, columnTotal);
  }
  return {
    rowDimensions,
    columns: [...columns.values()].sort(
      (a, b) => Number(a.total) - Number(b.total),
    ),
    rows: [...rows.values()].sort((a, b) => Number(a.total) - Number(b.total)),
  };
}

function appendReportCells(
  columns: Map<string, ReportGrid["columns"][number]>,
  row: ReportGrid["rows"][number],
  record: Record<string, unknown>,
  insight: Insight,
  columnValues: unknown[],
  columnTotal: boolean,
): void {
  const variants = insight.reporting?.comparison
    ? ([undefined, "previous", "change", "change_percent"] as const)
    : ([undefined] as const);
  const metrics = insight.metrics.filter(
    (metric) =>
      !insight.reporting?.measureIds ||
      insight.reporting.measureIds.includes(metric.id),
  );
  for (const metric of metrics) {
    for (const comparison of variants) {
      const key = JSON.stringify([
        columnTotal,
        dimensionKey(columnValues),
        metric.id,
        comparison,
      ]);
      const suffix = comparison ? `_${comparison}` : "";
      const labels = {
        previous: "previous",
        change: "change",
        change_percent: "change %",
      };
      if (!columns.has(key))
        columns.set(key, {
          key,
          values: columnValues,
          total: columnTotal,
          measureId: metric.id,
          label: comparison
            ? `${metric.name} · ${labels[comparison]}`
            : metric.name,
          format: metric.format,
          comparison,
        });
      row.cells[key] = record[metricIdToColumnAlias(metric.id) + suffix];
    }
  }
}

/** Format canonical comparison values without recomputing the comparison. */
export function formatReportValue(
  value: unknown,
  column: Pick<ReportGrid["columns"][number], "format" | "comparison">,
): string {
  if (column.comparison === "change_percent") {
    return formatMeasureValue(typeof value === "number" ? value / 100 : value, {
      style: "percent",
      decimals: column.format?.decimals ?? 1,
    });
  }
  if (column.comparison === "change" && column.format?.style === "percent") {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return `${formatMeasureValue(value * 100, { style: "number", decimals: column.format.decimals ?? 2 })} pp`;
  }
  return formatMeasureValue(value, column.format);
}
