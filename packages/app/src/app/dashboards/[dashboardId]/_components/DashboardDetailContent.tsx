import { ArtifactPageHeader } from "@/components/artifacts/ArtifactPageHeader";
import {
  ArtifactCard,
  ArtifactGrid,
} from "@/components/artifacts/ArtifactCollection";
import { queryStatus } from "@/data/query-status";
import { Breadcrumb } from "@dashframe/ui";
import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { useBindArtifact } from "@/components/assistant/artifact-context";
import { DashboardControlBar } from "@/components/dashboards/DashboardControlBar";
import { DashboardGrid } from "@/components/dashboards/DashboardGrid";
import {
  resolveInsightAvailableFields,
  type CombinedField,
} from "@/lib/insights/compute-combined-fields";
import { resolveReportContents } from "@/lib/reports/report-contents";
import { api } from "@dashframe/convex-backend/api";
import {
  cmd,
  CHART_TYPE_METADATA,
  type DashboardItemType,
  type InsightFilter,
  type UUID,
} from "@dashframe/types";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wystack/ui-react";
import {
  ChartIcon,
  CheckIcon,
  EditIcon,
  FileIcon,
  PlusIcon,
} from "@wystack/ui-react/icons";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

interface DashboardDetailContentProps {
  dashboardId: string;
}

export function formatReportContentsCount(
  questionCount: number,
  savedViewCount: number,
): string {
  return `${questionCount} question${questionCount === 1 ? "" : "s"} · ${savedViewCount} saved view${savedViewCount === 1 ? "" : "s"}`;
}

export default function DashboardDetailContent({
  dashboardId,
}: DashboardDetailContentProps) {
  const navigate = useNavigate();

  const {
    data: dashboards = [],
    isLoading,
    isFetching,
  } = queryStatus(useQuery({ query: api.app.listDashboards, args: {} }));
  const {
    data: visualizations = [],
    isLoading: visualizationsLoading,
    isError: visualizationsLoadError,
  } = queryStatus(useQuery({ query: api.app.listVisualizations, args: {} }));
  const {
    data: insights = [],
    isLoading: insightsLoading,
    isError: insightsLoadError,
  } = queryStatus(useQuery({ query: api.app.listInsights, args: {} }));
  const { data: dataTables = [] } = queryStatus(
    useQuery({ query: api.app.listDataTables, args: {} }),
  );
  const commitBatch = useMutation(api.app.commitBatch);

  // Find the dashboard
  const dashboard = useMemo(
    () => dashboards.find((d) => d.id === dashboardId),
    [dashboards, dashboardId],
  );
  const reportContents = useMemo(
    () =>
      dashboard
        ? resolveReportContents(dashboard, visualizations, insights)
        : { savedViews: [], questionIds: [], questions: [] },
    [dashboard, insights, visualizations],
  );

  // Bind the assistant to this dashboard (cleared on unmount).
  useBindArtifact(
    useMemo(
      () =>
        dashboard
          ? {
              kind: "dashboard" as const,
              id: dashboardId,
              title: dashboard.name || "Untitled dashboard",
            }
          : null,
      [dashboard, dashboardId],
    ),
  );

  // ── Controls ─────────────────────────────────────────────────────────────
  // View-local transient values for dashboard controls.  A viewer (or author)
  // turning a control writes here, NOT back to the saved dashboard.  This is
  // the ephemeral overlay described in the spec; the full promote-to-saved UX
  // is deferred to a later ticket.  Reset when the dashboard changes.
  const [controlTransientValues, setControlTransientValues] = useState<
    Map<string, InsightFilter["value"]>
  >(new Map());

  // Build fieldsByName map from all data tables referenced by the dashboard's
  // visualizations/insights.  Used by DashboardControlBar to detect field type
  // so the correct input (text/number/date) is rendered per control.
  const fieldsByName = useMemo<Map<string, CombinedField>>(() => {
    const map = new Map<string, CombinedField>();
    if (!dashboard) return map;

    const vizIds = new Set(
      dashboard.items
        .filter((i) => i.type === "visualization")
        .map((i) => i.visualizationId)
        .filter(Boolean),
    );
    const insightIds = new Set(
      visualizations.filter((v) => vizIds.has(v.id)).map((v) => v.insightId),
    );
    for (const insight of insights.filter((candidate) =>
      insightIds.has(candidate.id),
    )) {
      const fields = resolveInsightAvailableFields(
        insight,
        dataTables,
        insights,
      );
      for (const field of fields) {
        const key = field.columnName ?? field.name;
        if (!map.has(key)) map.set(key, field);
      }
    }
    return map;
  }, [dashboard, visualizations, insights, dataTables]);

  // ── Local UI state ────────────────────────────────────────────────────────
  const [isEditable, setIsEditable] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAddPending, setIsAddPending] = useState(false);
  const [addType, setAddType] = useState<DashboardItemType>("visualization");
  const [selectedVizId, setSelectedVizId] = useState<string>("");

  // Redirect if not found — but only once any in-flight fetch has settled.
  // Guard on isFetching as well as isLoading: TanStack Query sets isLoading=false
  // when stale cached data exists even while a background refetch runs.  Without
  // the isFetching guard, navigating to /dashboards/<id> right after creation
  // sees stale cache → isLoading=false, dashboard=undefined → instant redirect
  // before the mutation invalidation re-fetch completes.
  useEffect(() => {
    if (!isLoading && !isFetching && !dashboard) {
      navigate({ to: "/dashboards" });
    }
  }, [isLoading, isFetching, dashboard, navigate]);

  // Show loading state until we have the dashboard (or any fetch is in progress)
  if (
    isLoading ||
    isFetching ||
    visualizationsLoading ||
    insightsLoading ||
    !dashboard
  ) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-neutral-fg-subtle">Loading report...</p>
      </div>
    );
  }

  if (visualizationsLoadError || insightsLoadError) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div>
          <h1 className="text-lg font-semibold text-neutral-fg">
            Couldn&apos;t load report contents
          </h1>
          <p className="mt-2 text-sm text-neutral-fg-subtle">
            Something went wrong. Check your connection and try again.
          </p>
        </div>
      </div>
    );
  }

  const handleAddItem = async () => {
    // Compute the bottom of the current layout so the new widget is appended
    // below all existing items. Using Infinity here would serialize to null in
    // JSON and cause the server-side position validator to reject the mutation.
    const bottomY = dashboard.items.reduce(
      (max, item) => Math.max(max, item.y + item.height),
      0,
    );

    setIsAddPending(true);
    try {
      await commitBatch({
        commands: [
          cmd("AddDashboardItem", {
            dashboardId: dashboardId as UUID,
            item: {
              id: crypto.randomUUID() as UUID,
              type: addType,
              x: 0,
              y: bottomY,
              width: addType === "visualization" ? 6 : 4,
              height: addType === "visualization" ? 6 : 4,
              visualizationId:
                addType === "visualization"
                  ? (selectedVizId as UUID)
                  : undefined,
              content:
                addType === "markdown"
                  ? "## New Text Widget\n\nEdit this text..."
                  : undefined,
            },
          }),
        ],
      });
    } catch (error) {
      // Keep the dialog open so the user's selection isn't lost.
      console.error("Failed to add report item", error);
      toast.error("Couldn't add report item");
      return;
    } finally {
      setIsAddPending(false);
    }

    setIsAddOpen(false);
    setAddType("visualization");
    setSelectedVizId("");
  };

  return (
    <div className="flex h-full flex-col">
      <ArtifactPageHeader
        title={dashboard.name}
        description={formatReportContentsCount(
          reportContents.questions.length,
          reportContents.savedViews.length,
        )}
        navigation={
          <Breadcrumb
            LinkComponent={Link}
            items={[
              { label: "Reports", to: "/dashboards" },
              { label: dashboard.name },
            ]}
          />
        }
        actions={
          <>
            {isEditable ? (
              <Button
                icon={CheckIcon}
                label="Done editing"
                onClick={() => setIsEditable(false)}
              />
            ) : (
              <Button
                variant="outline"
                icon={EditIcon}
                label="Edit report"
                onClick={() => setIsEditable(true)}
              />
            )}
            {isEditable && (
              <Button
                color="secondary"
                icon={PlusIcon}
                label="Add item"
                onClick={() => setIsAddOpen(true)}
              />
            )}
          </>
        }
      />

      <div className="max-h-[42vh] shrink-0 space-y-6 overflow-y-auto border-b border-neutral-border bg-neutral-bg px-4 py-5 sm:px-6">
        <section
          aria-labelledby="report-questions-heading"
          className="space-y-3"
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2
                id="report-questions-heading"
                className="text-sm font-semibold text-neutral-fg"
              >
                Questions ({reportContents.questions.length})
              </h2>
              <p className="mt-1 text-xs text-neutral-fg-subtle">
                Questions used by saved views on this report.
              </p>
            </div>
            <Link
              to="/insights"
              className="text-xs font-medium text-palette-primary hover:underline"
            >
              View all questions
            </Link>
          </div>
          {reportContents.questions.length > 0 ? (
            <ArtifactGrid>
              {reportContents.questions.map((question) => {
                const savedViewCount = reportContents.savedViews.filter(
                  (view) => view.insightId === question.id,
                ).length;
                return (
                  <ArtifactCard
                    key={question.id}
                    headingLevel={3}
                    to={`/insights/${question.id}`}
                    name={question.name}
                    icon={<FileIcon className="h-5 w-5" />}
                    metadata={`${savedViewCount} saved view${savedViewCount === 1 ? "" : "s"} in this report`}
                  />
                );
              })}
            </ArtifactGrid>
          ) : (
            <p className="text-sm text-neutral-fg-subtle">
              No questions are used by this report yet.
            </p>
          )}
        </section>

        <section aria-labelledby="report-views-heading" className="space-y-3">
          <h2
            id="report-views-heading"
            className="text-sm font-semibold text-neutral-fg"
          >
            Saved views ({reportContents.savedViews.length})
          </h2>
          {reportContents.savedViews.length > 0 ? (
            <ArtifactGrid>
              {reportContents.savedViews.map((view) => (
                <ArtifactCard
                  key={view.id}
                  headingLevel={3}
                  to={`/visualizations/${view.id}`}
                  name={view.name}
                  icon={<ChartIcon className="h-5 w-5" />}
                  metadata={
                    CHART_TYPE_METADATA[view.visualizationType].displayName
                  }
                />
              ))}
            </ArtifactGrid>
          ) : (
            <p className="text-sm text-neutral-fg-subtle">
              No saved views are on this report yet.
            </p>
          )}
        </section>
      </div>

      {/* Control Bar — only rendered when the dashboard has controls */}
      {(dashboard.controls ?? []).length > 0 && (
        <DashboardControlBar
          controls={dashboard.controls!}
          fieldsByName={fieldsByName}
          transientValues={controlTransientValues}
          onTransientChange={setControlTransientValues}
        />
      )}

      {/* Grid Content */}
      <div className="flex-1 overflow-y-auto bg-neutral-bg-muted/10 p-6">
        <DashboardGrid
          dashboard={dashboard}
          isEditable={isEditable}
          controlTransientValues={controlTransientValues}
        />
      </div>

      {/* Add Widget Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add report item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Item type</Label>
              <div className="grid grid-cols-2 gap-4">
                <div
                  className={`cursor-pointer rounded-lg border p-4 transition-all ${
                    addType === "visualization"
                      ? "border-palette-primary bg-palette-primary/5 ring-1 ring-palette-primary"
                      : "hover:border-palette-primary/50"
                  }`}
                  onClick={() => setAddType("visualization")}
                >
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    <ChartIcon className="h-4 w-4" />
                    Saved view
                  </div>
                  <p className="text-xs text-neutral-fg-subtle">
                    Add an existing saved chart
                  </p>
                </div>
                <div
                  className={`cursor-pointer rounded-lg border p-4 transition-all ${
                    addType === "markdown"
                      ? "border-palette-primary bg-palette-primary/5 ring-1 ring-palette-primary"
                      : "hover:border-palette-primary/50"
                  }`}
                  onClick={() => setAddType("markdown")}
                >
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    <FileIcon className="h-4 w-4" />
                    Text / Markdown
                  </div>
                  <p className="text-xs text-neutral-fg-subtle">
                    Add rich text, notes, or headers
                  </p>
                </div>
              </div>
            </div>

            {addType === "visualization" && (
              <div className="space-y-2">
                <Label>Select saved view</Label>
                <Select
                  value={selectedVizId}
                  onValueChange={(v) => setSelectedVizId(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a saved view..." />
                  </SelectTrigger>
                  <SelectContent>
                    {visualizations.map((viz) => (
                      <SelectItem key={viz.id} value={viz.id}>
                        {viz.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              label="Cancel"
              onClick={() => setIsAddOpen(false)}
            />
            <Button
              label="Add item"
              onClick={handleAddItem}
              disabled={
                isAddPending || (addType === "visualization" && !selectedVizId)
              }
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
