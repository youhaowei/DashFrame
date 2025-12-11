"use client";

import { Card, CardContent } from "@dashframe/ui";
import { Chart } from "@dashframe/ui/icons";
import { DataPickerContent } from "@/components/data-sources/DataPickerContent";
import { useCreateInsight } from "@/hooks/useCreateInsight";

export function OnboardingView() {
    const { createInsightFromTable, createInsightFromInsight } =
        useCreateInsight();

    return (
        <>
            {/* Welcome Header */}
            <div className="mb-8 text-center">
                <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
                    <Chart className="text-primary h-6 w-6" />
                </div>
                <h2 className="mb-2 text-2xl font-bold">Welcome to DashFrame</h2>
                <p className="text-muted-foreground text-base">
                    Create beautiful visualizations from your data.
                </p>
            </div>

            {/* Data Selection Workflow */}
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
