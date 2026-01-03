"use client";

import { Card, CardContent, ChartIcon } from "@dashframe/ui";
import { DataPickerContent } from "@/components/data-sources/DataPickerContent";
import { useCreateInsight } from "@/hooks/useCreateInsight";

const WelcomeHeader = () => (
  <div className="mb-8 text-center">
    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
      <ChartIcon className="h-6 w-6 text-primary" />
    </div>
    <h2 className="mb-2 text-2xl font-bold">Welcome to DashFrame</h2>
    <p className="text-base text-muted-foreground">
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
