import type { InsightMetric, Metric } from "@dashframe/types";
import { ReportSelectionMenu } from "@/components/visualizations/ReportSwitchers";

/** Uses the workbench's existing anchored choice editor. */
export function MeasureLibraryControls({
  metrics,
  saved,
  onSave,
  onReuse,
}: {
  metrics: InsightMetric[];
  saved: Metric[];
  onSave: (id: string) => Promise<void>;
  onReuse: (id: string) => Promise<void>;
}) {
  return (
    <div className="space-y-2 pt-2">
      <div className="flex flex-wrap gap-2">
        {saved.length > 0 && (
          <ReportSelectionMenu
            label="Reuse measure"
            options={saved.map((metric) => ({
              id: metric.id,
              label: metric.name,
            }))}
            selected={[]}
            minimum={1}
            maximum={1}
            onApply={(ids) => onReuse(ids[0]!)}
          />
        )}
        {metrics.length > 0 && (
          <ReportSelectionMenu
            label="Save measure to source"
            options={metrics.map((metric) => ({
              id: metric.id,
              label: metric.name,
            }))}
            selected={[]}
            minimum={1}
            maximum={1}
            onApply={(ids) => onSave(ids[0]!)}
          />
        )}
      </div>
      <p className="text-xs text-neutral-fg-subtle">
        Reuse a saved definition and its dependencies. Changes in this report
        stay in this report.
      </p>
    </div>
  );
}
