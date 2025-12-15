"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Toggle } from "@dashframe/ui";
import { ArrowLeft, Settings, Eye } from "@dashframe/ui/icons";
import { InsightConfigureTab } from "@/components/insights/InsightConfigureTab";
import { InsightPreviewTab } from "@/components/insights/InsightPreviewTab";
import { WorkbenchLayout } from "@/components/layouts/WorkbenchLayout";
import type { DataTableInfo } from "../_hooks/useInsightPageData";
import type { PreviewResult } from "@/lib/insights/compute-preview";
import type { Field, Insight, Visualization } from "@dashframe/types";

interface InsightViewProps {
  insightId: string;
  insight: Insight;
  dataTableInfo: DataTableInfo;
  visualizations: Visualization[];
  isConfigured: boolean;
  selectedFields: Field[];
  aggregatedPreview: PreviewResult | null;
  onNameChange: (name: string) => void;
}

/**
 * InsightView - Main view for the insight page
 *
 * Displays the workbench layout with configure and preview tabs.
 * Handles tab switching and insight name editing.
 */
export function InsightView({
  insightId,
  insight,
  dataTableInfo,
  visualizations,
  isConfigured,
  selectedFields,
  aggregatedPreview,
  onNameChange,
}: InsightViewProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("configure");

  const { dataSource, dataTable, fields, metrics } = dataTableInfo;

  return (
    <WorkbenchLayout
      header={
        <div className="container mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/insights")}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <div className="min-w-[220px] flex-1">
              <Input
                value={insight.name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Insight name"
                className="w-full"
              />
            </div>
            <Toggle
              value={activeTab}
              onValueChange={setActiveTab}
              options={[
                {
                  value: "configure",
                  icon: <Settings />,
                  label: "Configure",
                },
                {
                  value: "preview",
                  icon: <Eye />,
                  label: "Preview",
                  badge:
                    visualizations.length > 0
                      ? visualizations.length
                      : undefined,
                  disabled: !isConfigured && visualizations.length === 0,
                },
              ]}
            />
          </div>
        </div>
      }
      childrenClassName="overflow-hidden flex flex-col"
    >
      {/* Tab Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {activeTab === "configure" && (
          <div className="flex-1 overflow-y-auto">
            <InsightConfigureTab
              insightId={insightId}
              insight={insight}
              dataTable={dataTable}
              fields={fields}
              tableMetrics={metrics}
              insightMetrics={insight.metrics ?? []}
              dataSource={dataSource}
              isConfigured={isConfigured}
            />
          </div>
        )}

        {activeTab === "preview" && (
          <div className="flex-1 overflow-y-auto">
            <InsightPreviewTab
              insightId={insightId}
              insight={insight}
              visualizations={visualizations}
              aggregatedPreview={aggregatedPreview}
              selectedFields={selectedFields}
              metrics={insight.metrics ?? []}
            />
          </div>
        )}
      </div>
    </WorkbenchLayout>
  );
}
