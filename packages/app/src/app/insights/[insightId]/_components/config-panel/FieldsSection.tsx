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
} from "@wystack/ui-react";
import {
  BooleanTypeIcon,
  DateTypeIcon,
  NumberTypeIcon,
  TextTypeIcon,
} from "@wystack/ui-react/icons";
import { useCallback, useState, type ReactNode } from "react";
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

function FieldRenameEditor({
  field,
  dragHandle,
  onRename,
  reporting,
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
  onConfigure?: (
    fieldId: string,
    grain: DateGrain | undefined,
    pivot: boolean,
  ) => Promise<void>;
  dragHandle: ReactNode;
  onRename: (field: CombinedField, name: string) => Promise<void> | void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(field.name);
  const [grain, setGrain] = useState<DateGrain | "none">(
    reporting?.dateGrains?.[field.id] ?? "none",
  );
  const [pivot, setPivot] = useState(
    Boolean(reporting?.pivotFields?.includes(field.id)),
  );
  const [viewer, setViewer] = useState(viewerChoice);
  const resetGrouping = () => {
    setGrain(reporting?.dateGrains?.[field.id] ?? "none");
    setPivot(Boolean(reporting?.pivotFields?.includes(field.id)));
    setViewer(viewerChoice);
  };
  const [error, setError] = useState<string | null>(null);
  const { setPending, isPending } = useSaveDismissGuard();
  const [isSaving, setIsSaving] = useSavingFlag(setPending);

  const close = () => {
    if (isPending()) return;
    setOpen(false);
    setName(field.name);
    resetGrouping();
    setError(null);
  };
  const save = async () => {
    const next = name.trim();
    if (!next) return;
    setIsSaving(true);
    setError(null);
    try {
      if (next !== field.name) await onRename(field, next);
      const groupingChanged =
        grain !== (reporting?.dateGrains?.[field.id] ?? "none") ||
        pivot !== Boolean(reporting?.pivotFields?.includes(field.id));
      if (groupingChanged)
        await onConfigure?.(
          field.id,
          grain === "none" ? undefined : grain,
          pivot,
        );
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
                aria-label={`Rename ${field.displayName}`}
              >
                <WorkbenchChipLabel title={field.displayName} />
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
        aria-label="Rename field"
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
        {onConfigure && (
          <div className="space-y-3">
            {field.type === "date" && (
              <div className="space-y-1.5">
                <Label>Group date by</Label>
                <Select
                  value={grain}
                  onValueChange={(value) =>
                    setGrain((value ?? "none") as DateGrain | "none")
                  }
                >
                  <SelectTrigger aria-label="Group date by">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["none", "day", "week", "month", "quarter", "year"].map(
                      (value) => (
                        <SelectItem key={value} value={value}>
                          {value === "none"
                            ? "Exact date"
                            : value[0]!.toUpperCase() + value.slice(1)}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Pivot placement</Label>
              <Select
                value={pivot ? "column" : "row"}
                onValueChange={(value) => setPivot(value === "column")}
              >
                <SelectTrigger aria-label="Pivot placement">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="row">Rows</SelectItem>
                  <SelectItem value="column">Columns</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
              (name.trim() === field.name &&
                grain === (reporting?.dateGrains?.[field.id] ?? "none") &&
                pivot === Boolean(reporting?.pivotFields?.includes(field.id)) &&
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
  onConfigure?: (
    fieldId: string,
    grain: DateGrain | undefined,
    pivot: boolean,
  ) => Promise<void>;
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
    // Closing here skips onOpenChange, which resets the toggle.
    setAddOpen(false);
    setViewerOnly(false);
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
