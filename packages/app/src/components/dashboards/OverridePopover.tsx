import { useMutation } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { useArtifactList } from "@/data/artifact-lists";
/**
 * Per-cell override popover — anchored to the cell, opened by the customize button.
 *
 * Self-fetches the visualization → insight → data table needed to derive field
 * state and drive the inline filter editor.  Mirrors the self-fetch pattern used
 * in VisualizationDisplay.
 *
 * Mutations:
 * - Filter / sort / limit overrides → server-applied intent patches
 * - Bind to control → `SetDashboardControls` through `commitBatch` (replace whole array)
 * - Unbind         → the same command, removing item.id from boundInstances
 *
 * A tile override runs through a control the chart's Insight declares for
 * viewers (`runtimeControls`), so a row is shown only for a declared control:
 *   • Sort, when the Insight declares a viewer sort
 *   • Limit, when it declares a viewer limit
 *   • A filter row per field with one declared runtime filter
 * An override the Insight does not declare replaces the tile with an error, so
 * a tile that already holds one keeps that row with only its removal.  When
 * the Insight declares none of the three, the popover says so and points at
 * the chart editor.
 */

import { computeItemOverrides } from "@/lib/dashboards/controls";
import { resolveInsightAvailableFields } from "@/lib/insights/compute-combined-fields";
import { api } from "@dashframe/convex-backend/api";
import {
  type DashboardControl,
  type DashboardItem,
  type DashboardItemOverridePatch,
  type InsightFilterOverride,
  type InsightRuntimeDeclaration,
  type InsightSort,
  cmd,
  type UUID,
} from "@dashframe/types";

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
import { EditIcon, SettingsIcon } from "@wystack/ui-react/icons";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  buildSortFieldOptions,
  clampLimit,
  computeNewOverridesOnClear,
  controlCanDrive,
  deriveFieldState,
  formatSortKeys,
  hasOverrides,
  overrideOffer,
  resolveFilterRow,
  type SortFieldOptions,
  sortKeyToPin,
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
  /** Opens the tile's chart for editing, as a tab in the report. */
  onEditChart?: (visualizationId: string) => void;
}

// ---------------------------------------------------------------------------
// Sort row
// ---------------------------------------------------------------------------

/**
 * Edits the tile's sort override, which holds one key: the tile runtime sends
 * it to the host as a runtime sort, and the host runs one.  Every edit
 * therefore saves a one-key list, including over a longer list saved before
 * writes started rejecting those.
 */
export function SortOverrideRow({
  insightSorts,
  overrideSorts,
  fields,
  onChange,
}: {
  insightSorts?: InsightSort[];
  overrideSorts?: InsightSort[];
  /** What the field select offers, and how stored references map to it. */
  fields: SortFieldOptions;
  onChange: (sorts: InsightSort[] | undefined) => void;
}) {
  const { options, byReference } = fields;
  const isPinned = overrideSorts !== undefined;
  const pinned = overrideSorts?.[0];
  const pinnedOption = pinned && byReference.get(pinned.field);
  const keyToPin = sortKeyToPin(insightSorts, fields);

  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-xs font-medium text-neutral-fg">Sort</span>
          {!isPinned && insightSorts && insightSorts.length > 0 && (
            <span className="text-xs break-words text-neutral-fg-subtle">
              default: {formatSortKeys(insightSorts, byReference)}
            </span>
          )}
        </div>

        {isPinned ? (
          <div className="flex items-center gap-1">
            {/* Field select.  A reference stored in another form (a column
                name, an alias) selects the option it names.  `items` only
                labels the trigger, so it also carries a pinned field that is
                no longer offered. */}
            <Select
              items={
                pinnedOption && !options.includes(pinnedOption)
                  ? [...options, pinnedOption]
                  : options
              }
              value={pinnedOption?.value ?? pinned?.field ?? ""}
              onValueChange={(field) => {
                if (!field) return;
                // Only the direction carries over: `pivotValues` name a cell
                // of the old field.
                onChange([{ field, direction: pinned?.direction ?? "asc" }]);
              }}
            >
              <SelectTrigger className="h-6 w-28 text-xs">
                <SelectValue placeholder="field" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className="text-xs"
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Direction toggle */}
            <Select
              value={pinned?.direction ?? "asc"}
              onValueChange={(direction) =>
                onChange([
                  {
                    ...(pinned ?? { field: options[0]?.value ?? "" }),
                    direction: direction as InsightSort["direction"],
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
            onClick={() => keyToPin && onChange([keyToPin])}
            disabled={!keyToPin}
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

interface LimitDraft {
  /** What the input shows. */
  text: string;
  /** True while `text` holds typing that has not been committed. */
  dirty: boolean;
  /** The `overrideLimit` this draft was last reconciled with. */
  limit: number | undefined;
}

export function LimitOverrideRow({
  insightLimit,
  overrideLimit,
  bounds,
  onChange,
}: {
  insightLimit?: number;
  overrideLimit?: number;
  /**
   * The range the Insight offers viewers.  The host refuses a limit outside
   * it, so Pin and typed numbers are moved inside it before they are saved.
   */
  bounds?: InsightRuntimeDeclaration["limit"];
  /** Resolves `false` when the save failed, so the draft can stop claiming it. */
  onChange: (limit: number | undefined) => Promise<boolean> | void;
}) {
  const isPinned = overrideLimit !== undefined;
  // Local draft so that typing "100" doesn't fire three separate DB mutations.
  // The mutation only fires on blur / Enter.
  const [draft, setDraft] = useState<LimitDraft>({
    text: overrideLimit?.toString() ?? "",
    dirty: false,
    limit: overrideLimit,
  });

  // The saved limit can change while this editor stays open (another tab, an
  // agent's published draft, an undo).  Follow it unless the user is mid-edit:
  // their typing wins until they commit it.  Losing the override unmounts the
  // input, so nothing is mid-edit then.
  if (draft.limit !== overrideLimit) {
    setDraft(
      draft.dirty && overrideLimit !== undefined
        ? { ...draft, limit: overrideLimit }
        : {
            text: overrideLimit?.toString() ?? "",
            dirty: false,
            limit: overrideLimit,
          },
    );
  }

  function commitDraft() {
    // Blur and Enter also fire on an editor the user only looked at.  Writing
    // its text back would overwrite a newer saved limit with a stale one.
    if (!draft.dirty) return;
    const n = parseInt(draft.text, 10);
    if (isNaN(n) || n <= 0) {
      setDraft({ ...draft, text: draft.limit?.toString() ?? "", dirty: false });
      return;
    }
    const limit = clampLimit(n, bounds);
    const committed = limit.toString();
    setDraft({ ...draft, text: committed, dirty: false });
    // Typed text is always written, even when it equals the saved limit: an
    // earlier save may still be in flight, and this one has to land after it.
    //
    // A failed save must not leave the input claiming the rejected number:
    // show the saved limit again, unless the input has moved on since.
    const showSavedLimit = () =>
      setDraft((latest) =>
        latest.dirty || latest.text !== committed
          ? latest
          : { ...latest, text: latest.limit?.toString() ?? "" },
      );
    Promise.resolve(onChange(limit)).then((saved) => {
      if (saved === false) showSavedLimit();
    }, showSavedLimit);
  }

  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-xs font-medium text-neutral-fg">Limit</span>
          {!isPinned && insightLimit !== undefined && (
            <span className="text-xs text-neutral-fg-subtle">
              default: {insightLimit} rows
            </span>
          )}
          {bounds && (
            <span className="text-xs text-neutral-fg-subtle">
              {bounds.min}–{bounds.max} rows
            </span>
          )}
        </div>

        {isPinned ? (
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={bounds?.min ?? 1}
              max={bounds?.max}
              value={draft.text}
              onChange={(e) =>
                setDraft({ ...draft, text: e.target.value, dirty: true })
              }
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
              onClick={() => void onChange(undefined)}
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
            onClick={() =>
              void onChange(clampLimit(insightLimit ?? 100, bounds))
            }
          >
            Pin
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reset-only row
// ---------------------------------------------------------------------------

/**
 * The row for an override the chart's Insight does not declare for viewers.
 * The tile cannot run that override and shows an error in its place, so the
 * row says why and offers the one thing that repairs the tile: removing it.
 * It carries no editing control, because any value saved here would fail too.
 */
export function ResetOnlyRow({
  name,
  reason,
  action = "Reset",
  actionLabel,
  onReset,
}: {
  /** What the override is on: "Sort", "Limit", or a field's display name. */
  name: string;
  /** One sentence saying the chart no longer offers this to viewers. */
  reason: string;
  /** The button's text. */
  action?: string;
  /** The button's accessible name, which says what is removed. */
  actionLabel: string;
  onReset: () => void;
}) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-medium text-neutral-fg">{name}</span>
        <span className="text-xs text-neutral-fg-subtle">{reason}</span>
      </div>
      <Button
        label={action}
        aria-label={actionLabel}
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 px-1.5 text-xs"
        onClick={onReset}
      />
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1 text-xs font-medium tracking-wide text-neutral-fg-subtle uppercase">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OverridePopover({
  item,
  dashboardId,
  controls,
  onEditChart,
}: OverridePopoverProps) {
  const commitBatch = useMutation(api.app.commitBatch);

  // Self-fetch visualization → insight → data table (same pattern as VisualizationDisplay).
  const visualizationList = queryStatus(
    useArtifactList({ query: api.app.listVisualizations, args: {} }),
  );
  const insightList = queryStatus(
    useArtifactList({ query: api.app.listInsights, args: {} }),
  );
  const dataTableList = queryStatus(
    useArtifactList({ query: api.app.listDataTables, args: {} }),
  );
  const { data: visualizations = [] } = visualizationList;
  const { data: insights = [] } = insightList;
  const { data: dataTables = [] } = dataTableList;
  // A list stays pending until its last page is in, so once all three have
  // data, a chart or Insight that is not found is gone, not still loading.
  const listsLoaded = [visualizationList, insightList, dataTableList].every(
    (list) => list.data !== undefined,
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

  // Eligible controls per field (controls whose field matches AND cell's source table has the field).
  function getEligibleControls(fieldName: string): DashboardControl[] {
    return controls.filter(
      (c) =>
        c.field === fieldName &&
        !c.boundInstances.includes(item.id) &&
        combinedFieldByName.has(fieldName),
    );
  }

  // ---------------------------------------------------------------------------
  // Mutation handlers
  // ---------------------------------------------------------------------------

  /** Resolves `true` once the patch is saved, `false` when it was rejected. */
  function persistOverride(
    patch: DashboardItemOverridePatch,
  ): Promise<boolean> {
    return commitBatch({
      commands: [
        cmd("PatchDashboardItemOverride", {
          dashboardId: dashboardId as UUID,
          itemId: item.id,
          patch,
        }),
      ],
    }).then(
      () => true,
      (error: unknown) => {
        console.error("Failed to save dashboard override:", error);
        toast.error("Failed to save dashboard override");
        return false;
      },
    );
  }

  // Pin and Clear are offered only on a row with a declared runtime filter,
  // and store its saved-filter id so the tile runtime finds that declaration.
  function handlePin(
    fieldName: string,
    filter: InsightFilterOverride,
    declaredFilterId: string,
  ) {
    persistOverride({
      kind: "filter",
      field: fieldName,
      value: { ...filter, id: declaredFilterId },
    });
  }

  function handleClear(fieldName: string, declaredFilterId: string) {
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
    return persistOverride({
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
      await commitBatch({
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
      await commitBatch({
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

  const sortFields = useMemo(
    () =>
      buildSortFieldOptions(
        combinedFields,
        insight?.metrics ?? [],
        insight?.runtimeControls?.sort?.allowedFieldIds,
      ),
    [combinedFields, insight?.metrics, insight?.runtimeControls?.sort],
  );

  const overridePresent = hasOverrides(item.overrides);
  // The report keeps a tile whose chart was deleted; there is nothing to edit.
  const chartDeleted = listsLoaded && !insight;

  // What the Insight offers decides which rows exist.  Until it and the
  // tables its fields come from are loaded nothing is known, so nothing is
  // shown: neither a control that may not run, nor a claim that the chart
  // offers none, nor a held override called undeclared for want of a field.
  const known = listsLoaded ? insight : null;
  const runtimeControls = known?.runtimeControls;
  // What the tile runs: its own overrides, with a bound control's in place of
  // the field it drives.
  const effectiveFilters = computeItemOverrides(item, controls)?.filters ?? [];
  const offersNothing =
    !runtimeControls?.sort &&
    !runtimeControls?.limit &&
    !runtimeControls?.filters?.length;
  const sortOffer = known
    ? overrideOffer(
        runtimeControls?.sort !== undefined,
        item.overrides?.sorts !== undefined,
      )
    : "hidden";
  const limitOffer = known
    ? overrideOffer(
        runtimeControls?.limit !== undefined,
        item.overrides?.limit !== undefined,
      )
    : "hidden";
  const filterRows = known
    ? fieldNames.flatMap((fieldName) => {
        const held = effectiveFilters.find(
          (filter) => filter.field === fieldName,
        );
        const declared = resolveFilterRow(
          fieldName,
          held,
          known,
          combinedFields,
        );
        if (!declared && !held) return [];
        // The default a row shows is the declared filter's, which is the one
        // a pin replaces; the field may carry other saved filters too.
        const state = deriveFieldState(
          fieldName,
          item.id,
          item.overrides,
          controls,
          declared?.filter,
        );
        const canBind =
          declared !== undefined &&
          controlCanDrive(fieldName, declared, known, combinedFields);
        return [{ fieldName, state, declared, canBind }];
      })
    : [];

  const sections: { key: string; content: ReactNode }[] = [];
  if (filterRows.length > 0)
    sections.push({
      key: "filters",
      content: (
        <>
          <SectionHeading>Filters</SectionHeading>
          {filterRows.map(({ fieldName, state, declared, canBind }) => {
            const combinedField = combinedFieldByName.get(fieldName);
            const displayName = combinedField?.displayName ?? fieldName;
            if (!declared)
              return (
                <ResetOnlyRow
                  key={fieldName}
                  name={displayName}
                  reason="The chart no longer offers this filter to viewers."
                  {...(state.type === "bound"
                    ? {
                        action: "Unbind",
                        actionLabel: `Unbind ${displayName} from control`,
                        onReset: () => handleUnbind(state.control.id),
                      }
                    : {
                        actionLabel: `Reset ${displayName} filter to inherit`,
                        onReset: () => handleInherit(fieldName),
                      })}
                />
              );
            return (
              <OverrideFieldRow
                key={fieldName}
                fieldName={fieldName}
                displayName={displayName}
                state={state}
                combinedField={combinedField}
                eligibleControls={canBind ? getEligibleControls(fieldName) : []}
                operator={declared.filter.operator}
                canClear={declared.declaration.allowClear === true}
                onPin={(filter) =>
                  handlePin(fieldName, filter, declared.declaration.filterId)
                }
                onClear={() =>
                  handleClear(fieldName, declared.declaration.filterId)
                }
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
        </>
      ),
    });
  if (sortOffer !== "hidden")
    sections.push({
      key: "sort",
      content: (
        <>
          <SectionHeading>Sort</SectionHeading>
          {sortOffer === "editable" ? (
            <SortOverrideRow
              insightSorts={known?.sorts}
              overrideSorts={item.overrides?.sorts}
              fields={sortFields}
              onChange={handleSortChange}
            />
          ) : (
            <ResetOnlyRow
              name="Sort"
              reason="The chart no longer offers sort to viewers."
              actionLabel="Reset sort to inherit"
              onReset={() => handleSortChange(undefined)}
            />
          )}
        </>
      ),
    });
  if (limitOffer !== "hidden")
    sections.push({
      key: "limit",
      content: (
        <>
          <SectionHeading>Limit</SectionHeading>
          {limitOffer === "editable" ? (
            // insightLimit: the Insight type has no row-limit field (v0.3).
            // The "default: N rows" hint is intentionally absent for now.
            <LimitOverrideRow
              insightLimit={undefined}
              overrideLimit={item.overrides?.limit}
              bounds={runtimeControls?.limit}
              onChange={handleLimitChange}
            />
          ) : (
            <ResetOnlyRow
              name="Limit"
              reason="The chart no longer offers a limit to viewers."
              actionLabel="Reset limit to inherit"
              onReset={() => void handleLimitChange(undefined)}
            />
          )}
        </>
      ),
    });

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
          <span className="flex items-center gap-1.5">
            {overridePresent && (
              <Badge variant="soft" color="primary" className="text-xs">
                active
              </Badge>
            )}
            {onEditChart && item.visualizationId && !chartDeleted && (
              <Button
                size="sm"
                variant="ghost"
                icon={EditIcon}
                label="Edit chart"
                onClick={() => onEditChart(item.visualizationId!)}
              />
            )}
          </span>
        </div>

        <ScrollArea className="max-h-96">
          <div className="px-3 py-2">
            {sections.map((section, index) => (
              <div key={section.key}>
                {index > 0 && <Separator className="my-2" />}
                {section.content}
              </div>
            ))}
            {known && sections.length === 0 && (
              <p className="py-1 text-xs text-neutral-fg-subtle">
                {offersNothing
                  ? "This chart offers viewers no sort, limit, or filter choices. Turn them on in the chart editor."
                  : // The Insight declares filters, but more than one on a
                    // field, and a tile holds one filter override per field.
                    "This chart's viewer filters share a field, so a tile can't pin one."}
              </p>
            )}
            {chartDeleted && (
              <p className="py-1 text-xs text-neutral-fg-subtle">
                This tile&apos;s chart was deleted.
              </p>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
