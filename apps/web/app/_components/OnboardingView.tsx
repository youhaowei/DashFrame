import { DataPickerContent } from "@/components/data-sources/DataPickerContent";
import { useCreateInsight } from "@/hooks/useCreateInsight";
import { ChartIcon } from "@stdui/icons";
import { Card, CardContent } from "@stdui/react";

const WelcomeHeader = () => (
  <div className="mb-8 text-center">
    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-palette-primary/10">
      <ChartIcon className="h-6 w-6 text-palette-primary" />
    </div>
    <h2 className="mb-2 text-2xl font-bold">Welcome to DashFrame</h2>
    <p className="text-base text-neutral-fg-subtle">
      Create beautiful visualizations from your data.
    </p>
  </div>
);

export function OnboardingView() {
  const { createInsightFromTable, createInsightFromInsight } =
    useCreateInsight();

  return (
    <>
      <WelcomeHeader />
      <Card>
        <CardContent className="p-6">
          <DataPickerContent
            onTableSelect={createInsightFromTable}
            onInsightSelect={(id, name) => createInsightFromInsight(id, name)}
            showInsights={true}
            showNotion={true}
          />
        </CardContent>
      </Card>
    </>
  );
}
