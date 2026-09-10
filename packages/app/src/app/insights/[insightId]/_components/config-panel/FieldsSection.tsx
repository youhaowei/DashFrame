import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import type { DataTable } from "@dashframe/types";
import {
  SortableList,
  WorkbenchAddRow,
  WorkbenchChip,
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
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@wystack/ui-react";
import {
  BooleanTypeIcon,
  DateTypeIcon,
  NumberTypeIcon,
  TextTypeIcon,
} from "@wystack/ui-react/icons";
import { useCallback, useState, type ReactNode } from "react";
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
  onRemove,
}: {
  field: CombinedField;
  dragHandle: ReactNode;
  onRename: (field: CombinedField, name: string) => Promise<void> | void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(field.displayName);
  const [error, setError] = useState<string | null>(null);
  const { setPending, isPending } = useSaveDismissGuard();
  const [isSaving, setIsSaving] = useSavingFlag(setPending);

  const close = () => {
    if (isPending()) return;
    setOpen(false);
    setName(field.displayName);
    setError(null);
  };
  const save = async () => {
    const next = name.trim();
    if (!next || next === field.displayName) return;
    setIsSaving(true);
    setError(null);
    try {
      await onRename(field, next);
      setOpen(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unknown error";
      setError(`Failed to rename field: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else setOpen(true);
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
                className="min-w-0 flex-1 truncate text-left font-medium focus-visible:outline-none"
                aria-label={`Rename ${field.displayName}`}
              >
                {field.displayName}
              </button>
            }
          />
        }
        removeLabel={`Remove ${field.displayName}`}
        onRemove={onRemove}
      />
      <PopoverContent align="start" className="w-72 space-y-3">
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
            disabled={!name.trim() || name.trim() === field.displayName}
            onClick={() => void save()}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FieldsSection({
  selectedFields,
  availableFields,
  tables,
  onReorder,
  onRemove,
  onRename,
  onAdd,
}: {
  selectedFields: CombinedField[];
  availableFields: CombinedField[];
  tables: DataTable[];
  onReorder: (newOrder: string[]) => void;
  onRemove: (fieldId: string) => void;
  onRename: (field: CombinedField, name: string) => Promise<void> | void;
  onAdd: (fieldId: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const sortableItems: FieldSortableItem[] = selectedFields.map((field) => ({
    id: field.id,
    field,
  }));
  const handleReorder = useCallback(
    (items: FieldSortableItem[]) => onReorder(items.map((item) => item.id)),
    [onReorder],
  );
  const tableGroups = tables
    .map((table) => ({
      table,
      fields: availableFields.filter(
        (field) => field.sourceTableId === table.id,
      ),
    }))
    .filter((group) => group.fields.length > 0);

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
              dragHandle={dragHandle}
              onRename={onRename}
              onRemove={() => onRemove(item.id)}
            />
          )}
        />
      )}
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger
          render={
            <WorkbenchAddRow disabled={availableFields.length === 0}>
              Add field
            </WorkbenchAddRow>
          }
        />
        <PopoverContent align="start" className="w-72 p-0">
          <Command label="Add field">
            <CommandInput
              placeholder="Search fields…"
              aria-label="Search fields"
            />
            <CommandList>
              <CommandEmpty>No matching fields.</CommandEmpty>
              {tableGroups.map(({ table, fields }) => (
                <CommandGroup key={table.id} heading={table.name}>
                  {fields.map((field) => (
                    <CommandItem
                      key={field.id}
                      value={field.id}
                      keywords={[field.displayName, field.type, table.name]}
                      onSelect={() => {
                        onAdd(field.id);
                        setAddOpen(false);
                      }}
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
        </PopoverContent>
      </Popover>
    </div>
  );
}
