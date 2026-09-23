import { formatReportValue, metricIdToColumnAlias } from "@dashframe/engine";
import type { Insight } from "@dashframe/types";

/** Summaries consume the canonical grand total; never sum displayed groups. */
export function ReportKpis({
  insight,
  rows,
}: {
  insight: Insight;
  rows: readonly Record<string, unknown>[];
}) {
  if (!insight.reporting?.totals) return null;
  const mask = (1 << insight.selectedFields.length) - 1;
  const total =
    insight.selectedFields.length === 0
      ? rows[0]
      : rows.find((row) => Number(row.__report_grouping) === mask);
  if (!total) return null;
  const metrics = insight.metrics.filter(
    (metric) =>
      !insight.reporting?.measureIds ||
      insight.reporting.measureIds.includes(metric.id),
  );
  return (
    <dl
      aria-label="Report totals"
      className="grid shrink-0 grid-cols-1 gap-4 border-b border-neutral-border px-3 py-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {metrics.map((metric) => {
        const alias = metricIdToColumnAlias(metric.id);
        const format = metric.format;
        return (
          <div key={metric.id} className="min-w-0">
            <dt className="truncate text-xs text-neutral-fg-subtle">
              {metric.name}
            </dt>
            <dd className="mt-1 text-2xl font-medium tabular-nums">
              {formatReportValue(total[alias], { format })}
            </dd>
            {insight.reporting?.comparison && (
              <>
                <dd className="mt-1 text-xs tabular-nums text-neutral-fg-subtle">
                  Previous:{" "}
                  {formatReportValue(total[alias + "_previous"], { format })}
                </dd>
                <dd className="mt-1 text-xs tabular-nums text-neutral-fg-subtle">
                  Change:{" "}
                  {formatReportValue(total[alias + "_change"], {
                    format,
                    comparison: "change",
                  })}{" "}
                  ·{" "}
                  {formatReportValue(total[alias + "_change_percent"], {
                    format,
                    comparison: "change_percent",
                  })}
                </dd>
              </>
            )}
          </div>
        );
      })}
    </dl>
  );
}
