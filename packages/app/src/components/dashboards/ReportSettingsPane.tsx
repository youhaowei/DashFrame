/**
 * Report pane — the workbench's left pane for settings that apply to the whole
 * report rather than one item. Today that is the report's filters.
 */

import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import type { DashboardControl, InsightFilter } from "@dashframe/types";
import {
  OverlayScrollArea,
  WorkbenchPaneHeader,
  WorkbenchPaneSection,
} from "@dashframe/ui";
import { ListFilter } from "lucide-react";
import { useState } from "react";
import { DashboardControlBar } from "./DashboardControlBar";

export function ReportSettingsPane({
  controls,
  fieldsByName,
  transientValues,
  onTransientChange,
}: {
  /** `null` while field types load, so the pane doesn't claim there are none. */
  controls: DashboardControl[] | null;
  fieldsByName: Map<string, CombinedField>;
  transientValues: Map<string, InsightFilter["value"]>;
  onTransientChange: (next: Map<string, InsightFilter["value"]>) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(true);

  return (
    <div className="flex h-full flex-col bg-neutral-bg text-xs">
      <WorkbenchPaneHeader title="Report">{null}</WorkbenchPaneHeader>
      <OverlayScrollArea className="min-h-0 flex-1">
        <div className="px-3 pb-3">
          <WorkbenchPaneSection
            title="Filters"
            icon={ListFilter}
            open={filtersOpen}
            summary={controlsSummary(controls)}
            onOpenChange={setFiltersOpen}
          >
            {controls?.length === 0 && (
              <p className="px-1.5 text-neutral-fg-subtle">
                This report has no filters.
              </p>
            )}
            {controls && controls.length > 0 && (
              <div className="flex flex-col gap-2 px-1.5">
                <DashboardControlBar
                  orientation="vertical"
                  controls={controls}
                  fieldsByName={fieldsByName}
                  transientValues={transientValues}
                  onTransientChange={onTransientChange}
                />
                <p className="text-neutral-fg-subtle">
                  Readers can change these. Values set here aren&apos;t saved.
                </p>
              </div>
            )}
          </WorkbenchPaneSection>
        </div>
      </OverlayScrollArea>
    </div>
  );
}

function controlsSummary(controls: DashboardControl[] | null) {
  if (controls === null) return "";
  return controls.length === 0 ? "None" : String(controls.length);
}
