import type {
  InsightFilter,
  InsightRuntimeDeclaration,
  UUID,
} from "@dashframe/types";
import { useEffect, useState } from "react";

interface RuntimeControlsSectionProps {
  declaration?: InsightRuntimeDeclaration;
  filters: readonly InsightFilter[];
  resultFields: readonly { id: UUID; label: string }[];
  onChange: (value: InsightRuntimeDeclaration | undefined) => void;
}

export function RuntimeControlsSection({
  declaration,
  filters,
  resultFields,
  onChange,
}: RuntimeControlsSectionProps) {
  const [draft, setDraft] = useState(declaration);
  useEffect(() => setDraft(declaration), [declaration]);
  const update = (next: InsightRuntimeDeclaration) =>
    setDraft(next.filters || next.sort || next.limit ? next : undefined);
  const dirty = JSON.stringify(draft) !== JSON.stringify(declaration);
  return (
    <div className="space-y-5 p-4 text-sm">
      <div>
        <h3 className="font-medium">Viewer filters</h3>
        <p className="text-xs text-neutral-fg-subtle">
          Expose saved filter values. Field and operator remain fixed.
        </p>
        {filters.map((filter, index) => {
          if (!filter.id) return null;
          const existing = draft?.filters?.find(
            (item) => item.filterId === filter.id,
          );
          return (
            <div key={filter.id} className="mt-2 space-y-2 rounded border p-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(existing)}
                  onChange={(event) => {
                    const rest =
                      draft?.filters?.filter(
                        (item) => item.filterId !== filter.id,
                      ) ?? [];
                    update({
                      ...draft,
                      filters: event.target.checked
                        ? [
                            ...rest,
                            {
                              key: `filter-${filter.id}`,
                              filterId: filter.id!,
                              label: filter.field || `Filter ${index + 1}`,
                            },
                          ]
                        : rest.length
                          ? rest
                          : undefined,
                    });
                  }}
                />
                <span>{filter.field || `Filter ${index + 1}`}</span>
              </label>
              {existing && (
                <div className="grid grid-cols-2 gap-2 pl-6">
                  <input
                    aria-label={`Runtime key for ${filter.field}`}
                    className="rounded border px-2 py-1"
                    value={existing.key}
                    onChange={(event) =>
                      update({
                        ...draft,
                        filters: draft!.filters!.map((control) =>
                          control.filterId === filter.id
                            ? { ...control, key: event.target.value }
                            : control,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label={`Runtime label for ${filter.field}`}
                    className="rounded border px-2 py-1"
                    value={existing.label}
                    onChange={(event) =>
                      update({
                        ...draft,
                        filters: draft!.filters!.map((control) =>
                          control.filterId === filter.id
                            ? { ...control, label: event.target.value }
                            : control,
                        ),
                      })
                    }
                  />
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={existing.required ?? false}
                      onChange={(event) =>
                        update({
                          ...draft,
                          filters: draft!.filters!.map((control) =>
                            control.filterId === filter.id
                              ? {
                                  ...control,
                                  required: event.target.checked || undefined,
                                }
                              : control,
                          ),
                        })
                      }
                    />
                    Required
                  </label>
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={existing.allowClear ?? false}
                      onChange={(event) =>
                        update({
                          ...draft,
                          filters: draft!.filters!.map((control) =>
                            control.filterId === filter.id
                              ? {
                                  ...control,
                                  allowClear: event.target.checked || undefined,
                                }
                              : control,
                          ),
                        })
                      }
                    />
                    Allow clear
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div>
        <h3 className="font-medium">Viewer sort</h3>
        <p className="text-xs text-neutral-fg-subtle">
          Allow one sort key from selected result fields.
        </p>
        {resultFields.map((field) => {
          const checked =
            draft?.sort?.allowedFieldIds.includes(field.id) ?? false;
          return (
            <label key={field.id} className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  const current = draft?.sort?.allowedFieldIds ?? [];
                  const allowedFieldIds = event.target.checked
                    ? [...current, field.id]
                    : current.filter((id) => id !== field.id);
                  update({
                    ...draft,
                    sort: allowedFieldIds.length
                      ? { allowedFieldIds, maxKeys: 1 }
                      : undefined,
                  });
                }}
              />
              <span>{field.label}</span>
            </label>
          );
        })}
      </div>
      <div>
        <label className="flex items-center gap-2 font-medium">
          <input
            type="checkbox"
            checked={Boolean(draft?.limit)}
            onChange={(event) =>
              update({
                ...draft,
                limit: event.target.checked ? { min: 1, max: 1000 } : undefined,
              })
            }
          />
          Viewer row limit
        </label>
        {draft?.limit && (
          <div className="mt-2 flex gap-2">
            <input
              aria-label="Minimum row limit"
              className="w-24 rounded border px-2 py-1"
              type="number"
              min={1}
              value={draft.limit.min}
              onChange={(event) =>
                update({
                  ...draft,
                  limit: {
                    ...draft.limit!,
                    min: Math.max(1, Number(event.target.value)),
                  },
                })
              }
            />
            <input
              aria-label="Maximum row limit"
              className="w-24 rounded border px-2 py-1"
              type="number"
              min={draft.limit.min}
              value={draft.limit.max}
              onChange={(event) =>
                update({
                  ...draft,
                  limit: {
                    ...draft.limit!,
                    max: Math.max(draft.limit!.min, Number(event.target.value)),
                  },
                })
              }
            />
          </div>
        )}
      </div>
      <button
        type="button"
        className="rounded bg-palette-primary px-3 py-1.5 text-palette-primary-fg disabled:opacity-50"
        disabled={!dirty}
        onClick={() => onChange(draft)}
      >
        Save runtime controls
      </button>
    </div>
  );
}
