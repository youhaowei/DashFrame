import { StartFromData } from "@/components/data-sources/StartFromData";
import { useOpenChartInReport } from "@/hooks/useOpenChartInReport";

/**
 * First-run view for an empty project.
 *
 * The layout is `StartFromData`; what this view owns is the welcome copy and
 * the terminal action — a first report, opened on a new chart of the picked
 * table.
 */
export function OnboardingView({
  onActivityChange,
}: {
  onActivityChange?: (active: boolean) => void;
}) {
  const { startChart } = useOpenChartInReport();

  return (
    <StartFromData
      title="Welcome to DashFrame"
      description="Connect a data source to build your first report."
      // `null` tells the picker the start failed (already reported).
      onTableSelect={async (id, name) =>
        (await startChart({ kind: "new" }, { id, name })) ? true : null
      }
      onActivityChange={onActivityChange}
    />
  );
}
