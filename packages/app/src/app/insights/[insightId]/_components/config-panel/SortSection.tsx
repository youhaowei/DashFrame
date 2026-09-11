import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import { metricIdToColumnAlias } from "@dashframe/engine";
import type {
  InsightMetric,
  InsightRuntimeDeclaration,
  InsightSort,
  UUID,
} from "@dashframe/types";
import {
  SortableList,
  WorkbenchAddRow,
  WorkbenchCheckbox,
  WorkbenchChip,
  WorkbenchSwitch,
  type SortableListItem,
} from "@dashframe/ui";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@wystack/ui-react";
import { ArrowDown, ArrowUp, Sigma } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { FieldTypeIcon } from "./FieldsSection";
import { stableValueSignature } from "./runtime-controls";

interface SortableSort extends SortableListItem {
  sort: InsightSort;
}

interface SortOption {
  value: string;
  label: string;
  id: UUID;
  group: "Fields" | "Metrics";
  icon: ReactNode;
}

function ViewerLimitFields({
  limit,
  onCommit,
}: {
  limit: NonNullable<InsightRuntimeDeclaration["limit"]>;
  onCommit: (limit: NonNullable<InsightRuntimeDeclaration["limit"]>) => void;
}) {
  const [minimum, setMinimum] = useState(String(limit.min));
  const [maximum, setMaximum] = useState(String(limit.max));
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    const min = Number(minimum);
    const max = Number(maximum);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1) {
      setError("Use whole numbers of at least 1.");
      return;
    }
    if (min > max) {
      setError("Minimum cannot exceed maximum.");
      return;
    }
    setError(null);
    if (min !== limit.min || max !== limit.max) onCommit({ min, max });
  };
  const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
  };

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="viewer-limit-min">Minimum</Label>
          <Input
            id="viewer-limit-min"
            inputMode="numeric"
            value={minimum}
            onChange={(event) => setMinimum(event.target.value)}
            onBlur={commit}
            onKeyDown={commitOnEnter}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="viewer-limit-max">Maximum</Label>
          <Input
            id="viewer-limit-max"
            inputMode="numeric"
            value={maximum}
            onChange={(event) => setMaximum(event.target.value)}
            onBlur={commit}
            onKeyDown={commitOnEnter}
          />
        </div>
      </div>
      {error && <p className="text-[11px] text-danger-fg">{error}</p>}
    </div>
  );
}

export function SortSection({
  sorts,
  fields,
  metrics,
  runtimeControls,
  onChange,
  onRuntimeChange,
}: {
  sorts: InsightSort[];
  fields: CombinedField[];
  metrics: InsightMetric[];
  runtimeControls?: InsightRuntimeDeclaration;
  onChange: (sorts: InsightSort[]) => void;
  onRuntimeChange: (
    value: InsightRuntimeDeclaration | undefined,
  ) => boolean | void | Promise<boolean | void>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const options = useMemo<SortOption[]>(
    () => [
      ...fields.map((field) => ({
        value: field.columnName ?? field.name,
        label: field.displayName,
        id: field.id as UUID,
        group: "Fields" as const,
        icon: <FieldTypeIcon type={field.type} />,
      })),
      ...metrics.map((metric) => ({
        value: metricIdToColumnAlias(metric.id),
        label: metric.name,
        id: metric.id,
        group: "Metrics" as const,
        icon: <Sigma className="h-3.5 w-3.5" />,
      })),
    ],
    [fields, metrics],
  );
  const unusedOptions = options.filter(
    (option) => !sorts.some((sort) => sort.field === option.value),
  );
  const sortableItems: SortableSort[] = sorts.map((sort) => ({
    id: sort.field,
    sort,
  }));
  const handleReorder = useCallback(
    (items: SortableSort[]) => onChange(items.map((item) => item.sort)),
    [onChange],
  );
  const resultOptions = options.filter(
    (option, index, all) =>
      all.findIndex((item) => item.id === option.id) === index,
  );
  const [runtimeDraft, setRuntimeDraft] = useState(runtimeControls);
  const [viewerSortEnabled, setViewerSortEnabled] = useState(false);
  const runtimeControlsRef = useRef(runtimeControls);
  const serverRuntimeControlsRef = useRef(runtimeControls);
  const pendingRuntimeSignatureRef = useRef<string | null>(null);
  const runtimeSignature = stableValueSignature(runtimeControls ?? null);
  useEffect(() => {
    serverRuntimeControlsRef.current = runtimeControls;
    if (
      pendingRuntimeSignatureRef.current === null ||
      pendingRuntimeSignatureRef.current === runtimeSignature
    ) {
      runtimeControlsRef.current = runtimeControls;
      setRuntimeDraft(runtimeControls);
      pendingRuntimeSignatureRef.current = null;
    }
  }, [runtimeControls, runtimeSignature]);

  const updateRuntime = (
    update: (
      current: InsightRuntimeDeclaration | undefined,
    ) => InsightRuntimeDeclaration,
  ) => {
    const candidate = update(runtimeControlsRef.current);
    const next =
      candidate.filters || candidate.sort || candidate.limit
        ? candidate
        : undefined;
    const nextSignature = stableValueSignature(next ?? null);
    runtimeControlsRef.current = next;
    setRuntimeDraft(next);
    pendingRuntimeSignatureRef.current = nextSignature;
    const serverSignatureAtRequest = stableValueSignature(
      serverRuntimeControlsRef.current ?? null,
    );
    const resyncFromServer = () => {
      runtimeControlsRef.current = serverRuntimeControlsRef.current;
      setRuntimeDraft(serverRuntimeControlsRef.current);
      pendingRuntimeSignatureRef.current = null;
    };
    Promise.resolve(onRuntimeChange(next)).then(
      (saved) => {
        if (pendingRuntimeSignatureRef.current !== nextSignature) return;
        // A server copy that arrived while this write was pending wins; if
        // none arrived yet, keep the draft and let the echo sync it.
        if (
          saved === false ||
          stableValueSignature(serverRuntimeControlsRef.current ?? null) !==
            serverSignatureAtRequest
        ) {
          resyncFromServer();
        } else {
          pendingRuntimeSignatureRef.current = null;
        }
      },
      () => {
        if (pendingRuntimeSignatureRef.current === nextSignature) {
          resyncFromServer();
        }
      },
    );
  };
  const setRuntimeFieldAllowed = (fieldId: UUID, allowed: boolean) => {
    setViewerSortEnabled(true);
    updateRuntime((latest) => {
      const current = latest?.sort?.allowedFieldIds ?? [];
      const allowedFieldIds = allowed
        ? [...current, fieldId]
        : current.filter((id) => id !== fieldId);
      return {
        ...latest,
        sort:
          allowedFieldIds.length > 0
            ? { allowedFieldIds, maxKeys: latest?.sort?.maxKeys ?? 1 }
            : undefined,
      };
    });
  };
  const optionByValue = useMemo(
    () => new Map(options.map((option) => [option.value, option])),
    [options],
  );
  const sortEnabled = viewerSortEnabled || Boolean(runtimeDraft?.sort);

  return (
    <div className="space-y-2">
      {sortableItems.length > 0 && (
        <SortableList
          items={sortableItems}
          onReorder={handleReorder}
          gap={3}
          unstyledItems
          renderItem={(item, index, { dragHandle }) => {
            const option = optionByValue.get(item.sort.field);
            const ascending = item.sort.direction === "asc";
            return (
              <WorkbenchChip
                dragHandle={dragHandle}
                icon={option?.icon ?? <Sigma className="h-3.5 w-3.5" />}
                title={option?.label ?? item.sort.field}
                trailing={
                  <button
                    type="button"
                    className="grid h-5 w-5 shrink-0 place-items-center rounded bg-neutral-bg text-neutral-fg-subtle hover:text-neutral-fg focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none"
                    aria-label={
                      ascending
                        ? "Ascending; switch to descending"
                        : "Descending; switch to ascending"
                    }
                    onClick={() =>
                      onChange(
                        sorts.map((sort, sortIndex) =>
                          sortIndex === index
                            ? {
                                ...sort,
                                direction: ascending ? "desc" : "asc",
                              }
                            : sort,
                        ),
                      )
                    }
                  >
                    {ascending ? (
                      <ArrowUp aria-hidden className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowDown aria-hidden className="h-3.5 w-3.5" />
                    )}
                  </button>
                }
                removeLabel={`Remove sort ${option?.label ?? item.sort.field}`}
                onRemove={() =>
                  onChange(sorts.filter((_, sortIndex) => sortIndex !== index))
                }
              />
            );
          }}
        />
      )}
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger
          render={
            <WorkbenchAddRow disabled={unusedOptions.length === 0}>
              Add sort
            </WorkbenchAddRow>
          }
        />
        <PopoverContent align="start" className="w-72 p-0">
          <Command label="Add sort">
            <CommandInput
              placeholder="Search result columns…"
              aria-label="Search result columns"
            />
            <CommandList>
              <CommandEmpty>No result columns available.</CommandEmpty>
              {(["Fields", "Metrics"] as const).map((group) => (
                <CommandGroup key={group} heading={group}>
                  {unusedOptions
                    .filter((option) => option.group === group)
                    .map((option) => (
                      <CommandItem
                        key={option.value}
                        value={option.value}
                        keywords={[option.label]}
                        onSelect={() => {
                          onChange([
                            ...sorts,
                            { field: option.value, direction: "asc" },
                          ]);
                          setAddOpen(false);
                        }}
                      >
                        {option.icon}
                        <span>{option.label}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <div className="space-y-2 border-t border-neutral-border/60 pt-2">
        <label className="flex cursor-pointer items-center justify-between gap-3 text-xs">
          <span>Viewers can change sort</span>
          <WorkbenchSwitch
            checked={sortEnabled}
            onCheckedChange={(checked) => {
              setViewerSortEnabled(checked);
              if (!checked && runtimeControlsRef.current?.sort) {
                updateRuntime((current) => ({
                  ...current,
                  sort: undefined,
                }));
              }
            }}
          />
        </label>
        {sortEnabled && (
          <div className="space-y-1 pl-1">
            {resultOptions.map((option) => {
              const checked = Boolean(
                runtimeDraft?.sort?.allowedFieldIds.includes(option.id),
              );
              return (
                <label
                  key={option.id}
                  className="flex cursor-pointer items-center gap-2 text-xs text-neutral-fg-subtle"
                >
                  <WorkbenchCheckbox
                    checked={checked}
                    onCheckedChange={(next) =>
                      setRuntimeFieldAllowed(option.id, next === true)
                    }
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        )}
        <label className="flex cursor-pointer items-center justify-between gap-3 text-xs">
          <span>Viewers can set a limit</span>
          <WorkbenchSwitch
            checked={Boolean(runtimeDraft?.limit)}
            onCheckedChange={(checked) =>
              updateRuntime((current) => ({
                ...current,
                limit: checked ? { min: 1, max: 1000 } : undefined,
              }))
            }
          />
        </label>
        {runtimeDraft?.limit && (
          <ViewerLimitFields
            key={`${runtimeDraft.limit.min}:${runtimeDraft.limit.max}`}
            limit={runtimeDraft.limit}
            onCommit={(limit) =>
              updateRuntime((current) => ({ ...current, limit }))
            }
          />
        )}
      </div>
    </div>
  );
}
