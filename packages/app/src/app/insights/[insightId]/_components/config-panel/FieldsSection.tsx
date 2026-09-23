import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import type { DataTable, DateGrain, InsightReporting } from "@dashframe/types";
import {
  SortableList,
  WorkbenchAddRow,
  WorkbenchChip,
  WorkbenchSwitch,
  WorkbenchChipLabel,
  type SortableListItem,
} from "@dashframe/ui";
import {
  Alert,
  AlertDescription,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Toggle,
} from "@wystack/ui-react";
import {
  BooleanTypeIcon,
  DateTypeIcon,
  NumberTypeIcon,
  TextTypeIcon,
} from "@wystack/ui-react/icons";
import { useCallback, useState, type ReactNode } from "react";
import { NumberField } from "./ReportSettings";
import { ViewerChoiceCheckbox, ViewerChoiceMark } from "./ViewerChoice";
import { useSaveDismissGuard, useSavingFlag } from "./use-save-dismiss-guard";

export function FieldTypeIcon({ type }: { type: string }) {
  const className = "h-3.5 w-3.5";
  const normalizedType = type.toLowerCase();
  if (
    ["number", "integer", "float", "decimal", "int", "bigint"].includes(
      normalizedType,
    )
  ) {
    return <NumberTypeIcon className={className} />;
  }
  if (
    ["date", "datetime", "timestamp", "time"].includes(normalizedType) ||
    normalizedType.includes("date")
  ) {
    return <DateTypeIcon className={className} />;
  }
  if (["boolean", "bool"].includes(normalizedType)) {
    return <BooleanTypeIcon className={className} />;
  }
  return <TextTypeIcon className={className} />;
}

interface FieldSortableItem extends SortableListItem {
  field: CombinedField;
}

/** How a field groups the report; the rank is the report's one Top N. */
export interface FieldGrouping {
  grain?: DateGrain;
  pivot: boolean;
  rank?: { direction: "asc" | "desc"; count: number; measureId: string };
}

const DATE_GRAINS: { value: DateGrain | "none"; label: string }[] = [
  { value: "none", label: "Exact date" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

const RANKS = [
  { value: "all", label: "All values" },
  { value: "desc", label: "Top" },
  { value: "asc", label: "Bottom" },
] as const;

function groupingOf(
  reporting: InsightReporting | undefined,
  fieldId: string,
): FieldGrouping {
  const topN = reporting?.topN;
  return {
    grain: reporting?.dateGrains?.[fieldId],
    pivot: Boolean(reporting?.pivotFields?.includes(fieldId)),
    rank:
      topN?.fieldId === fieldId
        ? {
            direction: topN.direction,
            count: topN.count,
            measureId: topN.measureId,
          }
        : undefined,
  };
}

/** The report's grouping with one field's grouping replaced. */
export function withFieldGrouping(
  reporting: InsightReporting | undefined,
  fieldId: string,
  { grain, pivot, rank }: FieldGrouping,
): InsightReporting {
  const next = { ...reporting };
  const dateGrains = { ...next.dateGrains };
  if (grain) dateGrains[fieldId] = grain;
  else delete dateGrains[fieldId];
  const current = next.pivotFields ?? [];
  const pivotFields = pivot
    ? current.includes(fieldId)
      ? current
      : [...current, fieldId]
    : current.filter((id) => id !== fieldId);
  // A report ranks one field, so ranking this one replaces the other.
  if (rank) next.topN = { fieldId, ...rank };
  else if (next.topN?.fieldId === fieldId) delete next.topN;
  return { ...next, dateGrains, pivotFields };
}

function sameGrouping(a: FieldGrouping, b: FieldGrouping) {
  return (
    a.grain === b.grain &&
    a.pivot === b.pivot &&
    a.rank?.direction === b.rank?.direction &&
    a.rank?.count === b.rank?.count &&
    a.rank?.measureId === b.rank?.measureId
  );
}

function rankError(rank: FieldGrouping["rank"]) {
  if (!rank) return null;
  return Number.isInteger(rank.count) && rank.count >= 1 && rank.count <= 10000
    ? null
    : "Enter a whole number from 1 to 10,000.";
}

/** Short qualifier for a field chip, e.g. "by month · columns · top 10". */
export function groupingSummary(grouping: FieldGrouping) {
  const parts: string[] = [];
  if (grouping.grain) parts.push(`by ${grouping.grain}`);
  if (grouping.pivot) parts.push("columns");
  if (grouping.rank)
    parts.push(
      `${grouping.rank.direction === "desc" ? "top" : "bottom"} ${grouping.rank.count}`,
    );
  return parts.join(" · ");
}

function FieldRenameEditor({
  field,
  dragHandle,
  onRename,
  reporting,
  measures = [],
  rankedFieldName,
  onConfigure,
  viewerChoice = false,
  onViewerChange,
  onRemove,
}: {
  field: CombinedField;
  /** Whether viewers can show or hide this field. */
  viewerChoice?: boolean;
  onViewerChange?: (fieldId: string, enabled: boolean) => Promise<void>;
  reporting?: InsightReporting;
  /** Measures a Top N can rank by. */
  measures?: readonly { id: string; name: string }[];
  /** Another field that holds the report's Top N, if any. */
  rankedFieldName?: string;
  onConfigure?: (fieldId: string, grouping: FieldGrouping) => Promise<void>;
  dragHandle: ReactNode;
  onRename: (field: CombinedField, name: string) => Promise<void> | void;
  onRemove: () => void;
}) {
  const saved = groupingOf(reporting, field.id);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(field.name);
  const [grouping, setGrouping] = useState(saved);
  const [viewer, setViewer] = useState(viewerChoice);
  const resetGrouping = () => {
    setGrouping(saved);
    setViewer(viewerChoice);
  };
  const [error, setError] = useState<string | null>(null);
  const { setPending, isPending } = useSaveDismissGuard();
  const [isSaving, setIsSaving] = useSavingFlag(setPending);
  const countError = rankError(grouping.rank);
  const update = (patch: Partial<FieldGrouping>) =>
    setGrouping((current) => ({ ...current, ...patch }));
  const summary = groupingSummary(saved);
  const countId = `field-rank-count-${field.id}`;

  const close = () => {
    if (isPending()) return;
    setOpen(false);
    setName(field.name);
    resetGrouping();
    setError(null);
  };
  const save = async () => {
    const next = name.trim();
    if (!next || countError) return;
    setIsSaving(true);
    setError(null);
    try {
      if (next !== field.name) await onRename(field, next);
      if (!sameGrouping(grouping, saved))
        await onConfigure?.(field.id, grouping);
      if (viewer !== viewerChoice) await onViewerChange?.(field.id, viewer);
      setOpen(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unknown error";
      setError(`Failed to save field: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else {
          setName(field.name);
          resetGrouping();
          setError(null);
          setOpen(true);
        }
      }}
    >
      <WorkbenchChip
        dragHandle={dragHandle}
        icon={<FieldTypeIcon type={field.type} />}
        open={open}
        content={
          <PopoverTrigger
            render={
              <button
                type="button"
                className="flex min-w-0 flex-1 focus-visible:outline-none"
                aria-label={`Edit ${field.displayName}`}
              >
                <WorkbenchChipLabel
                  title={field.displayName}
                  description={summary}
                />
              </button>
            }
          />
        }
        trailing={
          viewerChoice ? (
            <ViewerChoiceMark
              label={`Viewers can show or hide ${field.displayName}`}
            />
          ) : undefined
        }
        removeLabel={`Remove ${field.displayName}`}
        onRemove={onRemove}
      />
      <PopoverContent
        aria-label="Edit field"
        align="start"
        className="w-72 space-y-3"
      >
        {error && (
          <Alert color="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`field-name-${field.id}`}>Display name</Label>
          <Input
            id={`field-name-${field.id}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void save();
            }}
            autoFocus
          />
        </div>
        {onConfigure && field.type === "date" && (
          <div className="space-y-1.5">
            <Label>Group date by</Label>
            <Select
              value={grouping.grain ?? "none"}
              onValueChange={(value) =>
                update({
                  grain:
                    value && value !== "none"
                      ? (value as DateGrain)
                      : undefined,
                })
              }
            >
              <SelectTrigger aria-label="Group date by">
                <SelectValue>
                  {
                    DATE_GRAINS.find(
                      (item) => item.value === (grouping.grain ?? "none"),
                    )?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DATE_GRAINS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {onConfigure && (
          <div className="space-y-1.5">
            <Label>Show values as</Label>
            <Toggle
              size="sm"
              value={grouping.pivot ? "columns" : "rows"}
              options={[
                { value: "rows", label: "Rows" },
                { value: "columns", label: "Columns" },
              ]}
              onValueChange={(value) => update({ pivot: value === "columns" })}
            />
          </div>
        )}
        {onConfigure && measures.length > 0 && (
          <div className="space-y-1.5">
            <Label>Keep</Label>
            <Select
              value={grouping.rank?.direction ?? "all"}
              onValueChange={(value) =>
                update({
                  rank:
                    value === "asc" || value === "desc"
                      ? {
                          count: grouping.rank?.count ?? 10,
                          measureId:
                            grouping.rank?.measureId ?? measures[0]!.id,
                          direction: value,
                        }
                      : undefined,
                })
              }
            >
              <SelectTrigger aria-label="Keep">
                <SelectValue>
                  {
                    RANKS.find(
                      (item) =>
                        item.value === (grouping.rank?.direction ?? "all"),
                    )?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RANKS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {grouping.rank && (
              <NumberField
                label="Number of values"
                errorId={countError ? `${countId}-error` : undefined}
                value={
                  Number.isNaN(grouping.rank.count)
                    ? undefined
                    : grouping.rank.count
                }
                onChange={(count) =>
                  update({
                    rank: { ...grouping.rank!, count: count ?? Number.NaN },
                  })
                }
              />
            )}
            {countError && (
              <FieldError id={`${countId}-error`}>{countError}</FieldError>
            )}
            {grouping.rank && (
              <div className="space-y-1.5 pt-1.5">
                <Label>Ranked by</Label>
                <Select
                  value={grouping.rank.measureId}
                  onValueChange={(value) =>
                    value &&
                    update({ rank: { ...grouping.rank!, measureId: value } })
                  }
                >
                  <SelectTrigger aria-label="Ranked by">
                    <SelectValue>
                      {measures.find(
                        (measure) => measure.id === grouping.rank?.measureId,
                      )?.name ?? "Choose a measure"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {measures.map((measure) => (
                      <SelectItem key={measure.id} value={measure.id}>
                        {measure.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {rankedFieldName && !saved.rank && (
                  <FieldDescription>
                    Replaces the ranking on {rankedFieldName}.
                  </FieldDescription>
                )}
              </div>
            )}
          </div>
        )}
        {onViewerChange && (
          <ViewerChoiceCheckbox
            checked={viewer}
            onCheckedChange={setViewer}
            kind="fields"
          />
        )}
        <div className="flex justify-end gap-2">
          <Button
            label="Cancel"
            variant="ghost"
            size="sm"
            disabled={isSaving}
            onClick={close}
          />
          <Button
            label={isSaving ? "Saving…" : "Save"}
            size="sm"
            loading={isSaving}
            disabled={
              !name.trim() ||
              countError !== null ||
              (name.trim() === field.name &&
                sameGrouping(grouping, saved) &&
                viewer === viewerChoice)
            }
            onClick={() => void save()}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FieldsSection({
  reporting,
  onConfigure,
  measures,
  selectedFields,
  availableFields,
  tables,
  baseTableId,
  onReorder,
  onRemove,
  onRename,
  onAdd,
  viewerFieldIds = [],
  onViewerChange,
}: {
  /** Fields viewers can show or hide, selected or not. */
  viewerFieldIds?: readonly string[];
  onViewerChange?: (fieldId: string, enabled: boolean) => Promise<void>;
  reporting?: InsightReporting;
  onConfigure?: (fieldId: string, grouping: FieldGrouping) => Promise<void>;
  /** Measures a Top N can rank by. */
  measures?: readonly { id: string; name: string }[];
  selectedFields: CombinedField[];
  availableFields: CombinedField[];
  tables: DataTable[];
  baseTableId: string;
  onReorder: (newOrder: string[]) => void;
  onRemove: (fieldId: string) => void;
  onRename: (field: CombinedField, name: string) => Promise<void> | void;
  onAdd: (fieldId: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [viewerOnly, setViewerOnly] = useState(false);
  const selectedIds = new Set(selectedFields.map((field) => field.id));
  // Viewers can add these although the report doesn't show them by default.
  const viewerOnlyFields = viewerFieldIds.flatMap((id) => {
    if (selectedIds.has(id)) return [];
    const field = availableFields.find((candidate) => candidate.id === id);
    return field ? [field] : [];
  });
  // A failed viewer-choice write already shows its own toast.
  const ignoreRejection = () => undefined;
  const pickField = (fieldId: string) => {
    if (viewerOnly) onViewerChange?.(fieldId, true).catch(ignoreRejection);
    else onAdd(fieldId);
    setAddOpen(false);
  };
  const addableFields = viewerOnly
    ? availableFields.filter((field) => !viewerFieldIds.includes(field.id))
    : availableFields;
  const sortableItems: FieldSortableItem[] = selectedFields.map((field) => ({
    id: field.id,
    field,
  }));
  const handleReorder = useCallback(
    (items: FieldSortableItem[]) => onReorder(items.map((item) => item.id)),
    [onReorder],
  );
  const rankedFieldName = selectedFields.find(
    (field) => field.id === reporting?.topN?.fieldId,
  )?.displayName;
  const tableById = new Map(tables.map((table) => [table.id, table]));
  const groupedFields = new Map<string, CombinedField[]>();
  for (const field of addableFields) {
    const groupId = field.sourceTableId;
    groupedFields.set(groupId, [...(groupedFields.get(groupId) ?? []), field]);
  }
  const tableGroups = [...groupedFields].map(([tableId, fields]) => ({
    tableId,
    tableName:
      tableById.get(tableId)?.name ??
      (tableId === baseTableId ? "Base table" : "Joined table"),
    fields,
  }));

  return (
    <div className="space-y-1">
      {sortableItems.length > 0 && (
        <SortableList
          items={sortableItems}
          onReorder={handleReorder}
          gap={3}
          unstyledItems
          renderItem={(item, _index, { dragHandle }) => (
            <FieldRenameEditor
              field={item.field}
              reporting={reporting}
              onConfigure={onConfigure}
              measures={measures}
              rankedFieldName={rankedFieldName}
              dragHandle={dragHandle}
              onRename={onRename}
              viewerChoice={viewerFieldIds.includes(item.id)}
              onViewerChange={onViewerChange}
              onRemove={() => onRemove(item.id)}
            />
          )}
        />
      )}
      {viewerOnlyFields.map((field) => (
        <WorkbenchChip
          key={field.id}
          icon={<FieldTypeIcon type={field.type} />}
          title={field.displayName}
          description="viewers can add"
          trailing={
            <ViewerChoiceMark label={`Viewers can add ${field.displayName}`} />
          }
          removeLabel={`Stop offering ${field.displayName} to viewers`}
          onRemove={() =>
            onViewerChange?.(field.id, false).catch(ignoreRejection)
          }
        />
      ))}
      <Popover
        open={addOpen}
        onOpenChange={(next) => {
          setAddOpen(next);
          if (!next) setViewerOnly(false);
        }}
      >
        <PopoverTrigger
          render={
            <WorkbenchAddRow disabled={availableFields.length === 0}>
              Add field
            </WorkbenchAddRow>
          }
        />
        <PopoverContent
          aria-label="Add field"
          align="start"
          className="w-72 p-0"
        >
          <Command label="Add field">
            <CommandInput
              placeholder="Search fields…"
              aria-label="Search fields"
            />
            <CommandList>
              <CommandEmpty>No matching fields.</CommandEmpty>
              {tableGroups.map(({ tableId, tableName, fields }) => (
                <CommandGroup key={tableId} heading={tableName}>
                  {fields.map((field) => (
                    <CommandItem
                      key={field.id}
                      value={field.id}
                      keywords={[field.displayName, field.type, tableName]}
                      onSelect={() => pickField(field.id)}
                    >
                      <FieldTypeIcon type={field.type} />
                      <span className="min-w-0 flex-1 truncate">
                        {field.displayName}
                      </span>
                      <span className="text-xs text-neutral-fg-subtle">
                        {field.type}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
          {onViewerChange && (
            <Field
              orientation="horizontal"
              className="border-t border-neutral-border/60 px-3 py-2"
            >
              <FieldContent>
                <FieldLabel htmlFor="add-field-viewer-only">
                  Offer to viewers only
                </FieldLabel>
                <FieldDescription id="add-field-viewer-only-hint">
                  Hidden until a viewer adds it
                </FieldDescription>
              </FieldContent>
              <WorkbenchSwitch
                id="add-field-viewer-only"
                aria-describedby="add-field-viewer-only-hint"
                checked={viewerOnly}
                onCheckedChange={(next) => setViewerOnly(next === true)}
              />
            </Field>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
