import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { queryStatus } from "@/data/query-status";
/**
 * Report item pane — the attached right pane for the item selected on a report.
 *
 * A chart item shows where it comes from and its per-cell filter, sort, and
 * limit overrides; a text item shows its markdown source. Self-fetches the
 * visualization → insight → data table needed to derive field state, mirroring
 * the self-fetch pattern used in VisualizationDisplay.
 *
 * Mutations:
 * - Filter / sort / limit overrides → server-applied intent patches
 * - Bind to control → `SetDashboardControls` through `commitBatch` (replace whole array)
 * - Unbind         → the same command, removing item.id from boundInstances
 * - Text           → `UpdateDashboardItem` on blur
 *
 * Filter fields shown = union of:
 *   • Fields with an insight-level filter (inherit or override)
 *   • Fields with a cell-level override
 *   • Fields on a bound control targeting this cell
 */

import { resolveInsightAvailableFields } from "@/lib/insights/compute-combined-fields";
import { formatSavedViewType } from "@/lib/reports/report-contents";
import { api } from "@dashframe/convex-backend/api";
import {
  type Dashboard,
  type DashboardControl,
  type DashboardItem,
  type DashboardItemOverridePatch,
  type InsightFilter,
  type InsightFilterOverride,
  type InsightSort,
  cmd,
  type UUID,
} from "@dashframe/types";
import {
  OverlayScrollArea,
  WorkbenchJumpBar,
  WorkbenchPaneHeader,
  WorkbenchPaneSection,
  useWorkbenchPaneSections,
} from "@dashframe/ui";
import { Link } from "@tanstack/react-router";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wystack/ui-react";
import { CloseIcon, DeleteIcon } from "@wystack/ui-react/icons";
import { ArrowUpDown, BarChart3, Filter, Hash, Type } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  computeNewOverridesOnClear,
  deriveFieldState,
  resolveDeclaredRuntimeFilterId,
  withDeclaredFilterId,
} from "./override-field-row-utils";
import { OverrideFieldRow } from "./OverrideFieldRow";

// ---------------------------------------------------------------------------
// Sort row
// ---------------------------------------------------------------------------

function SortOverrideRow({
  insightSorts,
  overrideSorts,
  availableFields,
  onChange,
}: {
  insightSorts?: InsightSort[];
  overrideSorts?: InsightSort[];
  availableFields: string[];
  onChange: (sorts: InsightSort[] | undefined) => void;
}) {
  const current: InsightSort | undefined =
    overrideSorts?.[0] ?? insightSorts?.[0];
  const isPinned = overrideSorts !== undefined;

  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-xs font-medium text-neutral-fg">Sort</span>
          {!isPinned && current && (
            <span className="text-xs text-neutral-fg-disabled">
              default: {current.field} {current.direction}
            </span>
          )}
        </div>

        {isPinned ? (
          <div className="flex items-center gap-1">
            {/* Field select */}
            <Select
              value={overrideSorts![0]?.field ?? ""}
              onValueChange={(field) => {
                if (!field) return;
                onChange([
                  { field, direction: overrideSorts![0]?.direction ?? "asc" },
                ]);
              }}
            >
              <SelectTrigger className="h-6 w-28 text-xs">
                <SelectValue placeholder="field" />
              </SelectTrigger>
              <SelectContent>
                {availableFields.map((f) => (
                  <SelectItem key={f} value={f} className="text-xs">
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Direction toggle */}
            <Select
              value={overrideSorts![0]?.direction ?? "asc"}
              onValueChange={(dir) =>
                onChange([
                  {
                    field: overrideSorts![0]?.field ?? availableFields[0] ?? "",
                    direction: dir as "asc" | "desc",
                  },
                ])
              }
            >
              <SelectTrigger className="h-6 w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asc" className="text-xs">
                  asc
                </SelectItem>
                <SelectItem value="desc" className="text-xs">
                  desc
                </SelectItem>
              </SelectContent>
            </Select>
            {/* Reset to inherit */}
            <Button
              label="Reset sort to inherit"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              onClick={() => onChange(undefined)}
            >
              ×
            </Button>
          </div>
        ) : (
          <Button
            label="Pin sort override"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={() =>
              onChange([
                {
                  field: current?.field ?? availableFields[0] ?? "",
                  direction: current?.direction ?? "asc",
                },
              ])
            }
            disabled={availableFields.length === 0}
          >
            Pin
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Limit row
// ---------------------------------------------------------------------------

function LimitOverrideRow({
  insightLimit,
  overrideLimit,
  onChange,
}: {
  insightLimit?: number;
  overrideLimit?: number;
  onChange: (limit: number | undefined) => void;
}) {
  const isPinned = overrideLimit !== undefined;
  // Local draft so that typing "100" doesn't fire three separate DB mutations.
  // The mutation only fires on blur / Enter.
  const [draft, setDraft] = useState(overrideLimit?.toString() ?? "");

  function commitDraft() {
    const n = parseInt(draft, 10);
    if (!isNaN(n) && n > 0) onChange(n);
    else if (overrideLimit !== undefined) setDraft(overrideLimit.toString());
  }

  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-xs font-medium text-neutral-fg">Limit</span>
          {!isPinned && insightLimit !== undefined && (
            <span className="text-xs text-neutral-fg-disabled">
              default: {insightLimit} rows
            </span>
          )}
        </div>

        {isPinned ? (
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitDraft();
              }}
              className="h-6 w-20 text-xs"
            />
            <Button
              label="Reset limit to inherit"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              onClick={() => onChange(undefined)}
            >
              ×
            </Button>
          </div>
        ) : (
          <Button
            label="Pin row limit"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={() => {
              const initial = insightLimit ?? 100;
              setDraft(initial.toString());
              onChange(initial);
            }}
          >
            Pin
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const CHART_SECTIONS = [
  { id: "source", label: "Source", icon: BarChart3 },
  { id: "filters", label: "Filters", icon: Filter },
  { id: "sort", label: "Sort", icon: ArrowUpDown },
  { id: "limit", label: "Limit", icon: Hash },
] as const;
type ChartSection = (typeof CHART_SECTIONS)[number]["id"];
const CHART_SECTION_IDS = CHART_SECTIONS.map((section) => section.id);

interface ReportItemPaneProps {
  item: DashboardItem;
  dashboard: Dashboard;
  onClose: () => void;
}

export function ReportItemPane({
  item,
  dashboard,
  onClose,
}: ReportItemPaneProps) {
  const commitBatch = useMutation(api.app.commitBatch);

  const handleRemove = async () => {
    try {
      await commitBatch({
        commands: [
          cmd("RemoveDashboardItem", {
            dashboardId: dashboard.id,
            itemId: item.id,
          }),
        ],
      });
      onClose();
    } catch {
      toast.error("Couldn't remove the item");
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-neutral-bg text-xs">
      {item.type === "markdown" ? (
        <TextItemPane
          item={item}
          dashboardId={dashboard.id}
          onClose={onClose}
        />
      ) : (
        <ChartItemPane item={item} dashboard={dashboard} onClose={onClose} />
      )}
      <div className="shrink-0 px-3 pt-1 pb-3">
        <Button
          size="sm"
          variant="ghost"
          label="Remove from report"
          className="w-full justify-start text-palette-danger hover:bg-palette-danger/10 hover:text-palette-danger"
          onClick={handleRemove}
        >
          <DeleteIcon className="h-3.5 w-3.5" aria-hidden />
          Remove from report
        </Button>
      </div>
    </div>
  );
}

function PaneTitle({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="relative">
      <WorkbenchPaneHeader title={title}>{children}</WorkbenchPaneHeader>
      <Button
        size="sm"
        variant="ghost"
        icon={CloseIcon}
        iconOnly
        label="Close pane"
        onClick={onClose}
        className="absolute top-2.5 right-2.5 h-7 w-7"
      />
    </div>
  );
}

function TextItemPane({
  item,
  dashboardId,
  onClose,
}: {
  item: DashboardItem;
  dashboardId: UUID;
  onClose: () => void;
}) {
  const commitBatch = useMutation(api.app.commitBatch);
  const content = item.content ?? "";
  // Local draft so typing doesn't fire a mutation per keystroke; commits on
  // blur. A saved change arriving from elsewhere replaces the draft.
  const [draft, setDraft] = useState(content);
  const [syncedContent, setSyncedContent] = useState(content);
  if (content !== syncedContent) {
    setSyncedContent(content);
    setDraft(content);
  }

  const commit = async () => {
    if (draft === content) return;
    try {
      await commitBatch({
        commands: [
          cmd("UpdateDashboardItem", {
            dashboardId,
            itemId: item.id,
            updates: { content: draft },
          }),
        ],
      });
    } catch {
      toast.error("Couldn't save the text");
    }
  };

  return (
    <>
      <PaneTitle title="Text" onClose={onClose} />
      <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 pb-2">
        <label
          htmlFor={`report-text-${item.id}`}
          className="flex items-center gap-1.5 px-0.5 text-[11px] text-neutral-fg-subtle"
        >
          <Type className="h-3.5 w-3.5" aria-hidden />
          Markdown
        </label>
        <textarea
          id={`report-text-${item.id}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          placeholder="Write a heading, a note, or a finding…"
          className="min-h-40 w-full flex-1 resize-none rounded-md bg-neutral-bg-subtle px-2.5 py-2 font-mono text-xs shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)] ring-[0.5px] ring-neutral-border/60 outline-none placeholder:text-neutral-fg-subtle focus-visible:ring-2 focus-visible:ring-palette-primary"
        />
      </div>
    </>
  );
}

function ChartItemPane({
  item,
  dashboard,
  onClose,
}: {
  item: DashboardItem;
  dashboard: Dashboard;
  onClose: () => void;
}) {
  const commitBatch = useMutation(api.app.commitBatch);
  const controls = useMemo(
    () => dashboard.controls ?? [],
    [dashboard.controls],
  );
  const {
    openSections,
    allCollapsed,
    setSectionOpen,
    jumpToSection,
    toggleAll,
    registerSection,
  } = useWorkbenchPaneSections(CHART_SECTION_IDS);

  const { data: visualizations = [] } = queryStatus(
    useQuery({ query: api.app.listVisualizations, args: {} }),
  );
  const { data: insights = [] } = queryStatus(
    useQuery({ query: api.app.listInsights, args: {} }),
  );
  const { data: dataTables = [] } = queryStatus(
    useQuery({ query: api.app.listDataTables, args: {} }),
  );
  const { data: dashboards = [] } = queryStatus(
    useQuery({ query: api.app.listDashboards, args: {} }),
  );

  const visualization = useMemo(
    () =>
      item.visualizationId
        ? (visualizations.find((v) => v.id === item.visualizationId) ?? null)
        : null,
    [item.visualizationId, visualizations],
  );

  const insight = useMemo(
    () =>
      visualization
        ? (insights.find((i) => i.id === visualization.insightId) ?? null)
        : null,
    [visualization, insights],
  );

  // Other reports that place the same saved chart — editing it in its insight
  // changes it on those reports too.
  const otherReportCount = useMemo(
    () =>
      dashboards.filter(
        (candidate) =>
          candidate.id !== dashboard.id &&
          candidate.items.some(
            (candidateItem) =>
              candidateItem.visualizationId === item.visualizationId,
          ),
      ).length,
    [dashboards, dashboard.id, item.visualizationId],
  );

  // Combined fields for type-aware value editors.
  const combinedFields = useMemo(
    () =>
      insight
        ? resolveInsightAvailableFields(insight, dataTables, insights)
        : [],
    [insight, dataTables, insights],
  );

  const combinedFieldByName = useMemo(() => {
    const map = new Map(combinedFields.map((f) => [f.columnName ?? f.name, f]));
    return map;
  }, [combinedFields]);

  // Controls that target this cell.
  const boundControls = useMemo(
    () => controls.filter((c) => c.boundInstances.includes(item.id)),
    [controls, item.id],
  );

  // Union of: insight filter fields + cell override filter fields + bound control fields.
  const fieldNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    function add(name: string) {
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
    for (const f of insight?.filters ?? []) add(f.field);
    for (const f of item.overrides?.filters ?? []) add(f.field);
    for (const c of boundControls) add(c.field);
    return names;
  }, [insight?.filters, item.overrides?.filters, boundControls]);

  // Insight filter lookup by field name (for inherit state display).
  const insightFilterByField = useMemo(() => {
    const map = new Map<string, InsightFilter>();
    for (const f of insight?.filters ?? []) map.set(f.field, f);
    return map;
  }, [insight?.filters]);

  // Eligible controls per field (controls whose field matches AND cell's source table has the field).
  function getEligibleControls(fieldName: string): DashboardControl[] {
    return controls.filter(
      (c) =>
        c.field === fieldName &&
        !c.boundInstances.includes(item.id) &&
        combinedFieldByName.has(fieldName),
    );
  }

  function persistOverride(patch: DashboardItemOverridePatch) {
    commitBatch({
      commands: [
        cmd("PatchDashboardItemOverride", {
          dashboardId: dashboard.id,
          itemId: item.id,
          patch,
        }),
      ],
    }).catch((error: unknown) => {
      console.error("Failed to save dashboard override:", error);
      toast.error("Failed to save dashboard override");
    });
  }

  function handlePin(fieldName: string, filter: InsightFilterOverride) {
    persistOverride({
      kind: "filter",
      field: fieldName,
      value: withDeclaredFilterId(
        fieldName,
        filter,
        insight?.filters,
        insight?.runtimeControls?.filters,
      ),
    });
  }

  function handleClear(fieldName: string) {
    const declaredFilterId = resolveDeclaredRuntimeFilterId(
      fieldName,
      insight?.filters,
      insight?.runtimeControls?.filters,
    );
    const next = computeNewOverridesOnClear(
      fieldName,
      item.overrides,
      declaredFilterId,
    );
    const value =
      next.filters?.find((filter) => filter.field === fieldName) ?? null;
    persistOverride({ kind: "filter", field: fieldName, value });
  }

  async function setControls(next: DashboardControl[], failure: string) {
    try {
      await commitBatch({
        commands: [
          cmd("SetDashboardControls", {
            dashboardId: dashboard.id,
            controls: next,
          }),
        ],
      });
    } catch {
      toast.error(failure);
    }
  }

  // Control→field routing is encoded in the control record, so bind and unbind
  // look up by controlId and replace the whole controls array.
  function handleBind(controlId: string) {
    return setControls(
      controls.map((c) =>
        c.id === controlId
          ? { ...c, boundInstances: [...c.boundInstances, item.id] }
          : c,
      ),
      "Couldn't bind the control",
    );
  }

  function handleUnbind(controlId: string) {
    return setControls(
      controls.map((c) =>
        c.id === controlId
          ? {
              ...c,
              boundInstances: c.boundInstances.filter((id) => id !== item.id),
            }
          : c,
      ),
      "Couldn't unbind the control",
    );
  }

  const availableFieldNames = useMemo(
    () => combinedFields.map((field) => field.columnName ?? field.name),
    [combinedFields],
  );

  const pinnedFilterCount = item.overrides?.filters?.length ?? 0;
  const pinnedSort = item.overrides?.sorts?.[0];
  const pinnedLimit = item.overrides?.limit;

  const renderSection = (
    id: ChartSection,
    summary: string,
    children: ReactNode,
  ) => {
    const section = CHART_SECTIONS.find((candidate) => candidate.id === id)!;
    return (
      <WorkbenchPaneSection
        key={id}
        ref={registerSection(id)}
        title={section.label}
        icon={section.icon}
        open={openSections[id]}
        summary={summary}
        onOpenChange={(open) => setSectionOpen(id, open)}
      >
        {children}
      </WorkbenchPaneSection>
    );
  };

  return (
    <>
      <PaneTitle title="Chart" onClose={onClose}>
        <WorkbenchJumpBar
          items={CHART_SECTIONS}
          onJump={(id) => jumpToSection(id as ChartSection)}
          allCollapsed={allCollapsed}
          onToggleAll={toggleAll}
        />
      </PaneTitle>
      <OverlayScrollArea className="min-h-0 flex-1">
        <div className="px-3 pb-2">
          {renderSection(
            "source",
            visualization
              ? formatSavedViewType(visualization.visualizationType)
              : "Unavailable",
            visualization ? (
              <div className="space-y-2 px-0.5">
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-fg">
                    {visualization.name}
                  </p>
                  <p className="text-[11px] text-neutral-fg-subtle">
                    {formatSavedViewType(visualization.visualizationType)}
                    {insight ? ` · from ${insight.name}` : ""}
                  </p>
                </div>
                {insight && (
                  <Link
                    to="/insights/$insightId"
                    params={{ insightId: insight.id }}
                    search={{ reportId: dashboard.id }}
                    className="flex h-7 items-center justify-center rounded-md bg-neutral-bg-subtle px-2 font-medium text-neutral-fg transition-colors hover:bg-neutral-bg-muted focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none"
                  >
                    Edit chart in insight
                  </Link>
                )}
                {otherReportCount > 0 && (
                  <p className="text-[11px] leading-4 text-neutral-fg-subtle">
                    Also on {otherReportCount} other report
                    {otherReportCount === 1 ? "" : "s"}. Editing the chart
                    changes it there too; overrides below apply only here.
                  </p>
                )}
              </div>
            ) : (
              <p className="px-1 py-2 text-neutral-fg-subtle">
                This saved chart is no longer available.
              </p>
            ),
          )}
          {renderSection(
            "filters",
            pinnedFilterCount > 0
              ? `${pinnedFilterCount} pinned`
              : `${fieldNames.length} inherited`,
            fieldNames.length > 0 ? (
              fieldNames.map((fieldName) => {
                const state = deriveFieldState(
                  fieldName,
                  item.id,
                  item.overrides,
                  controls,
                  insightFilterByField.get(fieldName),
                );
                const combinedField = combinedFieldByName.get(fieldName);
                return (
                  <OverrideFieldRow
                    key={fieldName}
                    fieldName={fieldName}
                    displayName={combinedField?.displayName ?? fieldName}
                    state={state}
                    combinedField={combinedField}
                    eligibleControls={getEligibleControls(fieldName)}
                    onPin={(filter) => handlePin(fieldName, filter)}
                    onClear={() => handleClear(fieldName)}
                    onInherit={() =>
                      persistOverride({
                        kind: "filter",
                        field: fieldName,
                        value: null,
                      })
                    }
                    onBind={(controlId) => handleBind(controlId)}
                    onUnbind={
                      state.type === "bound"
                        ? () => handleUnbind(state.control.id)
                        : undefined
                    }
                  />
                );
              })
            ) : (
              <p className="px-1 py-2 text-neutral-fg-subtle">
                The insight has no filters to override.
              </p>
            ),
          )}
          {renderSection(
            "sort",
            pinnedSort
              ? `${pinnedSort.field} ${pinnedSort.direction}`
              : "Inherited",
            <SortOverrideRow
              insightSorts={insight?.sorts}
              overrideSorts={item.overrides?.sorts}
              availableFields={availableFieldNames}
              onChange={(sorts) =>
                persistOverride({ kind: "sorts", value: sorts ?? null })
              }
            />,
          )}
          {renderSection(
            "limit",
            pinnedLimit !== undefined ? `${pinnedLimit} rows` : "Inherited",
            // The Insight type has no row-limit field (v0.3), so there is no
            // inherited default to show.
            <LimitOverrideRow
              key={item.id}
              insightLimit={undefined}
              overrideLimit={pinnedLimit}
              onChange={(limit) =>
                persistOverride({ kind: "limit", value: limit ?? null })
              }
            />,
          )}
        </div>
      </OverlayScrollArea>
    </>
  );
}
