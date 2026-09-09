import { DataPickerContent } from "@/components/data-sources/DataPickerContent";
import { useCreateInsight } from "@/hooks/useCreateInsight";

/**
 * First-run view for an empty project: the identity line, the one next step,
 * and the data picker itself.
 *
 * Deliberately unadorned. The Stage is already the elevated surface this page
 * sits on, so the view adds no panel or card of its own, and no decorative
 * badge — per DESIGN.md the app is a working instrument, and an element that
 * answers no question earns no place here.
 */
export function OnboardingView({
  onActivityChange,
}: {
  onActivityChange?: (active: boolean) => void;
}) {
  const { createInsightFromTable, createInsightFromInsight } =
    useCreateInsight();

  return (
    <section aria-labelledby="onboarding-heading">
      <h1
        id="onboarding-heading"
        className="text-xl font-semibold text-neutral-fg"
      >
        Welcome to DashFrame
      </h1>
      <p className="mt-1 text-sm text-neutral-fg-subtle">
        Connect a data source to build your first insight.
      </p>

      <div className="mt-8">
        <DataPickerContent
          onTableSelect={createInsightFromTable}
          onInsightSelect={(id, name) => createInsightFromInsight(id, name)}
          showInsights={true}
          onActivityChange={onActivityChange}
        />
      </div>
    </section>
  );
}
