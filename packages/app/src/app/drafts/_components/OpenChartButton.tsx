import { ReportPickerDialog } from "@/components/dashboards/ReportPickerDialog";
import { queryStatus } from "@/data/query-status";
import { useOpenChartInReport } from "@/hooks/useOpenChartInReport";
import { api } from "@dashframe/convex-backend/api";
import { Button } from "@wystack/ui-react";
import { useQuery_experimental as useQuery } from "convex/react";
import { useState } from "react";

/**
 * Opens a chart a draft changes. A chart is edited inside a report: one on a
 * report opens there; one on no report asks which report to place it on. A
 * chart the draft creates does not exist until the draft is published, so
 * there is nothing to open yet.
 *
 * Nothing shows until both the charts and the reports have loaded: before
 * then a chart already on a report would read as on no report, and a pick
 * would put it on a second one.
 */
export function OpenChartButton({
  visualizationId,
}: {
  visualizationId: string;
}) {
  const reportsQuery = queryStatus(
    useQuery({ query: api.app.listDashboards, args: {} }),
  );
  const visualizationsQuery = queryStatus(
    useQuery({ query: api.app.listVisualizations, args: {} }),
  );
  const { openChart } = useOpenChartInReport();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isOpening, setIsOpening] = useState(false);

  const reports = reportsQuery.data;
  const chart = visualizationsQuery.data?.find(
    (visualization) => visualization.id === visualizationId,
  );
  if (!reports || !chart) return null;

  const home = reports.find((report) =>
    report.items.some(
      (item) =>
        item.type === "visualization" &&
        item.visualizationId === visualizationId,
    ),
  );

  const open = async (
    target: Parameters<typeof openChart>[0],
  ): Promise<void> => {
    if (isOpening) return;
    setIsOpening(true);
    try {
      if (await openChart(target, visualizationId, reports))
        setIsPickerOpen(false);
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        label="Open chart"
        loading={isOpening && !isPickerOpen}
        onClick={() =>
          home
            ? void open({ kind: "existing", reportId: home.id })
            : setIsPickerOpen(true)
        }
      />
      <ReportPickerDialog
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        title={`Place ${chart.name || "this chart"} on a report`}
        description="This chart is on no report yet. Pick one to open it there, or start a new report."
        busy={isOpening}
        onPick={(target) => void open(target)}
      />
    </>
  );
}
