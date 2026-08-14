/**
 * Per-cell override popover — anchored to the cell, opened by the customize button.
 *
 * Self-fetches the visualization → insight → data table needed to derive field
 * state and drive the inline filter editor.  Mirrors the self-fetch pattern used
 * in VisualizationDisplay.
 *
 * Mutations:
 * - Filter / sort / limit overrides → server-applied intent patches
 * - Bind to control → `updateControls(dashboardId, newControls)` (replace whole array)
 * - Unbind         → `updateControls(...)` removing item.id from boundInstances
 *
 * Fields shown = union of:
 *   • Fields with an insight-level filter (inherit or override)
 *   • Fields with a cell-level override (already shown above)
 *   • Fields on a bound control targeting this cell
 *   • (Additive "add filter" row for other eligible fields — not in this PR)
 */

import { isControlEligible } from "@/lib/dashboards/controls";
import { computeCombinedFields } from "@/lib/insights/compute-combined-fields";
import { api } from "@/wystack/api";
import type {
  DashboardControl,
  DashboardItem,
  DashboardItemOverridePatch,
  InsightFilter,
  InsightFilterOverride,
  InsightSort,
} from "@dashframe/types";
import { cmd, type UUID } from "@dashframe/types";
import { useMutation, useQuery } from "@wystack/client";
import {
  Badge,
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  cn,
} from "@wystack/ui-react";
import { SettingsIcon } from "@wystack/ui-react/icons";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  computeNewOverridesOnClear,
  deriveFieldState,
  hasOverrides,
  resolveDeclaredRuntimeFilterId,
  withDeclaredFilterId,
} from "./override-field-row-utils";
import { OverrideFieldRow } from "./OverrideFieldRow";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OverridePopoverProps {
  item: DashboardItem;
  dashboardId: string;
  /** Dashboard-level controls (from dashboard.controls ?? []). */
  controls: DashboardControl[];
}

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

export function OverridePopover({
  item,
  dashboardId,
  controls,
}: OverridePopoverProps) {
  const commitBatch = useMutation(api.commitBatch);

  // Self-fetch visualization → insight → data table (same pattern as VisualizationDisplay).
  const { data: visualizations = [] } = useQuery(api.listVisualizations, {
    args: {},
  });
  const { data: insights = [] } = useQuery(api.listInsights, { args: {} });
  const { data: dataTables = [] } = useQuery(api.listDataTables, { args: {} });

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

  const dataTable = useMemo(
    () =>
      insight?.source.sourceType === "dataTable"
        ? (dataTables.find((t) => t.id === insight.source.sourceId) ?? null)
        : null,
    [insight, dataTables],
  );

  // Combined fields for type-aware value editors.
  const { fields: combinedFields } = useMemo(
    () =>
      insight && dataTable
        ? computeCombinedFields(dataTable, insight.joins ?? [], dataTables)
        : { fields: [] },
    [insight, dataTable, dataTables],
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

  // Build the list of fields to show.
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
        isControlEligible(fieldName, dataTable ?? undefined),
    );
  }

  // ---------------------------------------------------------------------------
  // Mutation handlers
  // ---------------------------------------------------------------------------

  function persistOverride(patch: DashboardItemOverridePatch) {
    commitBatch
      .mutateAsync({
        commands: [
          cmd("PatchDashboardItemOverride", {
            dashboardId: dashboardId as UUID,
            itemId: item.id,
            patch,
          }),
        ],
      })
      .catch((error: unknown) => {
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
    persistOverride({
      kind: "filter",
      field: fieldName,
      value,
    });
  }

  function handleInherit(fieldName: string) {
    persistOverride({
      kind: "filter",
      field: fieldName,
      value: null,
    });
  }

  function handleSortChange(sorts: InsightSort[] | undefined) {
    persistOverride({
      kind: "sorts",
      value: sorts ?? null,
    });
  }

  function handleLimitChange(limit: number | undefined) {
    persistOverride({
      kind: "limit",
      value: limit ?? null,
    });
  }

  async function handleBind(controlId: string) {
    // Add item.id to the control's boundInstances.  Replaces the whole controls array.
    // fieldName is not needed here — control→field routing is already encoded in
    // the control record (`c.field`); we look up by controlId directly.
    const next = controls.map((c) =>
      c.id === controlId
        ? { ...c, boundInstances: [...c.boundInstances, item.id] }
        : c,
    );
    try {
      await commitBatch.mutateAsync({
        commands: [
          cmd("SetDashboardControls", {
            dashboardId: dashboardId as UUID,
            controls: next,
          }),
        ],
      });
    } catch {
      toast.error("Couldn't bind the control");
    }
  }

  async function handleUnbind(controlId: string) {
    // Remove item.id from the control's boundInstances.
    const next = controls.map((c) =>
      c.id === controlId
        ? {
            ...c,
            boundInstances: c.boundInstances.filter((id) => id !== item.id),
          }
        : c,
    );
    try {
      await commitBatch.mutateAsync({
        commands: [
          cmd("SetDashboardControls", {
            dashboardId: dashboardId as UUID,
            controls: next,
          }),
        ],
      });
    } catch {
      toast.error("Couldn't unbind the control");
    }
  }

  // Available field names for the sort row (fields in the data table).
  const availableFieldNames = useMemo(
    () => (dataTable?.fields ?? []).map((f) => f.columnName ?? f.name),
    [dataTable],
  );

  const overridePresent = hasOverrides(item.overrides);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Customize cell overrides"
            className={cn(
              "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md p-0 text-neutral-fg-subtle transition-colors hover:bg-neutral-bg hover:text-neutral-fg",
              overridePresent && "text-palette-primary",
            )}
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            {overridePresent && (
              <span
                aria-label="This cell has overrides"
                className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-palette-primary"
              />
            )}
          </button>
        }
      />

      <PopoverContent
        className="w-80 p-0"
        side="bottom"
        align="end"
        sideOffset={6}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-border px-3 py-2">
          <span className="text-sm font-semibold text-neutral-fg">
            Cell overrides
          </span>
          {overridePresent && (
            <Badge variant="soft" color="primary" className="text-xs">
              active
            </Badge>
          )}
        </div>

        <ScrollArea className="max-h-96">
          <div className="px-3 py-2">
            {/* Filter rows */}
            {fieldNames.length > 0 && (
              <>
                <p className="mb-1 text-xs font-medium text-neutral-fg-subtle uppercase tracking-wide">
                  Filters
                </p>
                {fieldNames.map((fieldName) => {
                  const state = deriveFieldState(
                    fieldName,
                    item.id,
                    item.overrides,
                    controls,
                    insightFilterByField.get(fieldName),
                  );
                  const combinedField = combinedFieldByName.get(fieldName);
                  const eligible = getEligibleControls(fieldName);

                  return (
                    <OverrideFieldRow
                      key={fieldName}
                      fieldName={fieldName}
                      displayName={combinedField?.displayName ?? fieldName}
                      state={state}
                      combinedField={combinedField}
                      eligibleControls={eligible}
                      onPin={(filter) => handlePin(fieldName, filter)}
                      onClear={() => handleClear(fieldName)}
                      onInherit={() => handleInherit(fieldName)}
                      onBind={(controlId) => handleBind(controlId)}
                      onUnbind={
                        state.type === "bound"
                          ? () => handleUnbind(state.control.id)
                          : undefined
                      }
                    />
                  );
                })}
                <Separator className="my-2" />
              </>
            )}

            {/* Sort row */}
            <p className="mb-1 text-xs font-medium text-neutral-fg-subtle uppercase tracking-wide">
              Sort
            </p>
            <SortOverrideRow
              insightSorts={insight?.sorts}
              overrideSorts={item.overrides?.sorts}
              availableFields={availableFieldNames}
              onChange={handleSortChange}
            />

            <Separator className="my-2" />

            {/* Limit row */}
            <p className="mb-1 text-xs font-medium text-neutral-fg-subtle uppercase tracking-wide">
              Limit
            </p>
            {/* insightLimit: the Insight type has no row-limit field (v0.3).
                The "default: N rows" hint is intentionally absent for now. */}
            <LimitOverrideRow
              insightLimit={undefined}
              overrideLimit={item.overrides?.limit}
              onChange={handleLimitChange}
            />
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
