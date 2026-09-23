import { resolveInsightAvailableFields } from "@/lib/insights/compute-combined-fields";
import { fieldIdToColumnAlias } from "@dashframe/engine";
import type {
  DashboardControl,
  DashboardItem,
  DataTable,
  Insight,
  Visualization,
  UUID,
} from "@dashframe/types";
import {
  Button,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@wystack/ui-react";
import { PlusIcon, SettingsIcon } from "@wystack/ui-react/icons";
import { useMemo, useState } from "react";

export type DashboardControlCandidate = {
  field: string;
  label: string;
  type: "string" | "number" | "date" | "boolean";
  instances: Array<{ id: UUID; label: string }>;
};

type CandidateObservation = {
  field: string;
  label: string;
  type: DashboardControlCandidate["type"];
  instance: { id: UUID; label: string };
};

function declaredEqualityFilters(insight: Insight) {
  const resolved = (insight.runtimeControls?.filters ?? []).flatMap(
    (declaration) => {
      if (declaration.required || declaration.allowClear !== true) return [];
      const saved = (insight.filters ?? []).filter(
        (filter) => filter.id === declaration.filterId,
      );
      const filter = saved[0];
      if (!filter || saved.length !== 1 || filter.operator !== "eq") return [];
      const sameField = (insight.filters ?? []).filter(
        (candidate) => candidate.field === filter.field,
      );
      return sameField.length === 1 ? [filter] : [];
    },
  );
  return resolved.filter(
    (filter) =>
      resolved.filter((candidate) => candidate.field === filter.field)
        .length === 1,
  );
}

function itemCandidateObservations(
  item: DashboardItem,
  input: {
    visualizations: Visualization[];
    insights: Insight[];
    dataTables: DataTable[];
  },
): CandidateObservation[] {
  if (item.type !== "visualization" || !item.visualizationId) return [];
  const visualization = input.visualizations.find(
    (candidate) => candidate.id === item.visualizationId,
  );
  const insight = input.insights.find(
    (candidate) => candidate.id === visualization?.insightId,
  );
  if (!visualization || !insight) return [];
  const fields = resolveInsightAvailableFields(
    insight,
    input.dataTables,
    input.insights,
  );
  return declaredEqualityFilters(insight).flatMap((filter) => {
    const matches = fields.filter(
      (field) =>
        (field.columnName ?? field.name) === filter.field ||
        fieldIdToColumnAlias(field.id) === filter.field,
    );
    const field = matches[0];
    if (!field || matches.length !== 1) return [];
    const rawField = field.columnName ?? field.name;
    if (
      fields.filter(
        (candidate) => (candidate.columnName ?? candidate.name) === rawField,
      ).length !== 1
    )
      return [];
    if (
      !(["string", "number", "date", "boolean"] as const).includes(
        field.type as DashboardControlCandidate["type"],
      )
    )
      return [];
    return [
      {
        field: rawField,
        label: field.name,
        type: field.type as DashboardControlCandidate["type"],
        instance: { id: item.id, label: visualization.name },
      },
    ];
  });
}

/** Fields that can safely map one shared equality value to saved view instances. */
export function resolveDashboardControlCandidates(input: {
  items: DashboardItem[];
  visualizations: Visualization[];
  insights: Insight[];
  dataTables: DataTable[];
}): DashboardControlCandidate[] {
  const observations = new Map<
    string,
    Array<Omit<CandidateObservation, "field">>
  >();
  for (const item of input.items) {
    for (const observation of itemCandidateObservations(item, input)) {
      const current = observations.get(observation.field) ?? [];
      current.push(observation);
      observations.set(observation.field, current);
    }
  }
  return [...observations.entries()]
    .flatMap(([field, matches]) => {
      const signatures = new Set(
        matches.map((match) => `${match.type}\0${match.label}`),
      );
      if (signatures.size !== 1 || !matches[0]) return [];
      return [
        {
          field,
          label: matches[0].label,
          type: matches[0].type,
          instances: matches.map((match) => match.instance),
        },
      ];
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

type EditorDraft = {
  id?: UUID;
  field: string;
  label: string;
  defaultValue: string;
  boundInstances: UUID[];
};

function draftFor(control?: DashboardControl): EditorDraft {
  return {
    id: control?.id,
    field: control?.field ?? "",
    label: control?.label ?? "",
    defaultValue:
      control?.defaultValue === undefined || control.defaultValue === null
        ? ""
        : String(control.defaultValue),
    boundInstances: control?.boundInstances ?? [],
  };
}

function parseDefault(
  raw: string,
  type: DashboardControlCandidate["type"],
): string | number | boolean | undefined {
  if (raw === "") return undefined;
  if (type === "number") {
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }
  if (type === "boolean") return raw === "true";
  return raw;
}

function inputTypeForCandidate(type: DashboardControlCandidate["type"]) {
  if (type === "number") return "number";
  if (type === "date") return "date";
  return "text";
}

export function DashboardControlsManager({
  controls,
  items,
  visualizations,
  insights,
  dataTables,
  onSave,
}: {
  controls: DashboardControl[];
  items: DashboardItem[];
  visualizations: Visualization[];
  insights: Insight[];
  dataTables: DataTable[];
  onSave: (controls: DashboardControl[]) => Promise<void>;
}) {
  const candidates = useMemo(
    () =>
      resolveDashboardControlCandidates({
        items,
        visualizations,
        insights,
        dataTables,
      }),
    [dataTables, insights, items, visualizations],
  );
  const [draft, setDraft] = useState<EditorDraft>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const candidate = candidates.find((entry) => entry.field === draft?.field);
  const eligibleIds = new Set(candidate?.instances.map(({ id }) => id) ?? []);
  const invalidTargets =
    draft?.boundInstances.filter((id) => !eligibleIds.has(id)) ?? [];
  const invalidTargetLabels = invalidTargets.map((id) => {
    const item = items.find((candidate) => candidate.id === id);
    const visualization = visualizations.find(
      (candidate) => candidate.id === item?.visualizationId,
    );
    return { id, label: visualization?.name ?? "Unavailable saved view" };
  });

  const save = async (next: DashboardControl[]) => {
    setSaving(true);
    setError(undefined);
    try {
      await onSave(next);
      setDraft(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save controls.",
      );
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = () => {
    if (!draft || !candidate) return;
    if (invalidTargets.length) {
      setError(
        "Remove targets that no longer expose this filter before saving.",
      );
      return;
    }
    const parsed = parseDefault(draft.defaultValue, candidate.type);
    if (
      candidate.type === "number" &&
      draft.defaultValue !== "" &&
      parsed === undefined
    ) {
      setError("Enter a valid number or leave the default blank.");
      return;
    }
    const nextControl: DashboardControl = {
      id: draft.id ?? (crypto.randomUUID() as UUID),
      field: candidate.field,
      label: draft.label.trim() || candidate.label,
      ...(parsed === undefined ? {} : { defaultValue: parsed }),
      boundInstances: draft.boundInstances,
    };
    void save(
      draft.id
        ? controls.map((control) =>
            control.id === draft.id ? nextControl : control,
          )
        : [...controls, nextControl],
    );
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            icon={SettingsIcon}
            label="Shared controls"
          />
        }
      />
      <PopoverContent align="end" className="w-96 space-y-4 p-4">
        <div>
          <p className="text-sm font-semibold text-neutral-fg">
            Shared controls
          </p>
          <p className="mt-1 text-xs text-neutral-fg-subtle">
            Apply one filter value to selected saved views.
          </p>
        </div>
        {draft ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="shared-control-field">Filter</Label>
              <select
                id="shared-control-field"
                aria-label="Filter"
                className="h-9 w-full rounded-md border border-neutral-border bg-neutral-bg px-3 text-sm"
                value={draft.field}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    field: event.target.value,
                    boundInstances: [],
                  })
                }
              >
                <option value="">Choose an exposed filter</option>
                {candidates.map((entry) => (
                  <option key={entry.field} value={entry.field}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shared-control-label">Label</Label>
              <Input
                id="shared-control-label"
                value={draft.label}
                onChange={(event) =>
                  setDraft({ ...draft, label: event.target.value })
                }
              />
            </div>
            {candidate && (
              <div className="space-y-1.5">
                <Label htmlFor="shared-control-default">Default value</Label>
                {candidate.type === "boolean" ? (
                  <select
                    id="shared-control-default"
                    className="h-9 w-full rounded-md border border-neutral-border bg-neutral-bg px-3 text-sm"
                    value={draft.defaultValue}
                    onChange={(event) =>
                      setDraft({ ...draft, defaultValue: event.target.value })
                    }
                  >
                    <option value="">Include all</option>
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </select>
                ) : (
                  <Input
                    id="shared-control-default"
                    type={inputTypeForCandidate(candidate.type)}
                    value={draft.defaultValue}
                    placeholder="Include all"
                    onChange={(event) =>
                      setDraft({ ...draft, defaultValue: event.target.value })
                    }
                  />
                )}
              </div>
            )}
            {candidate && (
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium text-neutral-fg">
                  Saved views
                </legend>
                {candidate.instances.map((instance) => (
                  <label
                    key={instance.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={draft.boundInstances.includes(instance.id)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          boundInstances: event.target.checked
                            ? [...draft.boundInstances, instance.id]
                            : draft.boundInstances.filter(
                                (id) => id !== instance.id,
                              ),
                        })
                      }
                    />
                    {instance.label}
                  </label>
                ))}
              </fieldset>
            )}
            {invalidTargetLabels.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-palette-danger">
                  These saved views no longer expose this filter. Uncheck them
                  before saving.
                </p>
                {invalidTargetLabels.map((target) => (
                  <label
                    key={target.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked
                      onChange={() =>
                        setDraft({
                          ...draft,
                          boundInstances: draft.boundInstances.filter(
                            (id) => id !== target.id,
                          ),
                        })
                      }
                    />
                    {target.label}
                  </label>
                ))}
              </div>
            )}
            {error && (
              <p role="alert" className="text-xs text-palette-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                label="Cancel"
                disabled={saving}
                onClick={() => setDraft(undefined)}
              />
              <Button
                label="Save control"
                loading={saving}
                disabled={!candidate}
                onClick={saveDraft}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {controls.map((control) => (
              <div
                key={control.id}
                className="flex items-center justify-between gap-3 rounded-md bg-neutral-bg-subtle px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {control.label ??
                      candidates.find((entry) => entry.field === control.field)
                        ?.label ??
                      "Shared filter"}
                  </p>
                  <p className="text-xs text-neutral-fg-subtle">
                    {control.boundInstances.length} saved views
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Edit"
                    onClick={() => {
                      setError(undefined);
                      setDraft(draftFor(control));
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Remove"
                    onClick={() =>
                      void save(
                        controls.filter((entry) => entry.id !== control.id),
                      )
                    }
                  />
                </div>
              </div>
            ))}
            {candidates.length === 0 ? (
              <p className="text-sm text-neutral-fg-subtle">
                Expose an equality filter on a question first, then add its
                saved view to this report.
              </p>
            ) : (
              <Button
                icon={PlusIcon}
                label="Add control"
                variant="outline"
                onClick={() => {
                  setError(undefined);
                  setDraft(draftFor());
                }}
              />
            )}
            {error && (
              <p role="alert" className="text-xs text-palette-danger">
                {error}
              </p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
