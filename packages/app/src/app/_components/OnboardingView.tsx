import { StartFromData } from "@/components/data-sources/StartFromData";
import { useCreateInsight } from "@/hooks/useCreateInsight";

/**
 * First-run view for an empty project.
 *
 * The layout is `StartFromData`; what this view owns is the welcome copy and
 * the terminal action — a first insight, opened as soon as it exists.
 */
export function OnboardingView({
  onActivityChange,
}: {
  onActivityChange?: (active: boolean) => void;
}) {
  const { createInsightFromTable, createInsightFromInsight } =
    useCreateInsight();

  return (
    <StartFromData
      title="Welcome to DashFrame"
      description="Connect a data source to build your first insight."
      onTableSelect={createInsightFromTable}
      onInsightSelect={(id, name) => createInsightFromInsight(id, name)}
      onActivityChange={onActivityChange}
    />
  );
}
