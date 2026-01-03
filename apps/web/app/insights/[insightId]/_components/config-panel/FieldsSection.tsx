"use client";

import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  SortableList,
  cn,
  type SortableListItem,
} from "@dashframe/ui";
import {
  BooleanTypeIcon,
  ChevronRightIcon,
  CloseIcon,
  DateTypeIcon,
  EditIcon,
  NumberTypeIcon,
  PlusIcon,
  TextTypeIcon,
} from "@dashframe/ui/icons";
import { useCallback, useState } from "react";

/**
 * Render field type icon based on type string.
 * Uses direct JSX rendering to avoid React Compiler "component created during render" error.
 * The icon components (Hash, Calendar, etc.) are statically imported.
 */
function FieldTypeIcon({ type }: { type: string }) {
  const className = "text-muted-foreground h-3 w-3 shrink-0";
  const normalizedType = type.toLowerCase();

  // Numeric types
  if (
    ["number", "integer", "float", "decimal", "int", "bigint"].includes(
      normalizedType,
    )
  ) {
    return <NumberTypeIcon className={className} title={type} />;
  }

  // Date/time types
  if (
    ["date", "datetime", "timestamp", "time"].includes(normalizedType) ||
    normalizedType.includes("date")
  ) {
    return <DateTypeIcon className={className} title={type} />;
  }

  // Boolean types
  if (["boolean", "bool"].includes(normalizedType)) {
    return <BooleanTypeIcon className={className} title={type} />;
  }

  // Default to text/string
  return <TextTypeIcon className={className} title={type} />;
}

/** Extended sortable item with field data */
interface FieldSortableItem extends SortableListItem {
  field: CombinedField;
}

interface FieldsSectionProps {
  selectedFields: CombinedField[];
  baseTableId: string;
  onReorder: (newOrder: string[]) => void;
  onRemove: (fieldId: string) => void;
  onRenameClick: (field: CombinedField) => void;
  onAddClick: () => void;
  defaultOpen?: boolean;
}

/**
 * FieldsSection - Collapsible section for managing insight fields (dimensions)
 *
 * Shows a sortable list of selected fields with drag-and-drop reordering.
 * Each field displays name and type icon.
 */
export function FieldsSection({
  selectedFields,
  onReorder,
  onRemove,
  onRenameClick,
  onAddClick,
  defaultOpen = true,
}: FieldsSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // Convert CombinedField to sortable item format
  const sortableItems: FieldSortableItem[] = selectedFields.map((field) => ({
    id: field.id,
    field,
  }));

  // Handle reorder - convert back to field IDs
  const handleReorder = useCallback(
    (items: FieldSortableItem[]) => {
      onReorder(items.map((item) => item.id));
    },
    [onReorder],
  );

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border-b">
        <div className="flex items-center justify-between px-4 py-3">
          <CollapsibleTrigger asChild>
            <button className="-ml-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent/50">
              <ChevronRightIcon
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  isOpen && "rotate-90",
                )}
              />
              <NumberTypeIcon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm leading-none font-medium">Fields</span>
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-xs leading-none tabular-nums"
              >
                {selectedFields.length}
              </Badge>
            </button>
          </CollapsibleTrigger>
          <Button
            label="Add"
            icon={PlusIcon}
            variant="text"
            size="sm"
            onClick={onAddClick}
          />
        </div>
        <CollapsibleContent>
          <div className="px-4 pb-4">
            {sortableItems.length > 0 ? (
              <SortableList
                items={sortableItems}
                onReorder={handleReorder}
                gap={6}
                renderItem={(item) => (
                  <FieldItemContent
                    field={item.field}
                    onRemove={() => onRemove(item.id)}
                    onRenameClick={() => onRenameClick(item.field)}
                  />
                )}
              />
            ) : (
              <p className="py-2 text-sm text-muted-foreground">
                No fields selected.
              </p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

interface FieldItemContentProps {
  field: CombinedField;
  onRemove: () => void;
  onRenameClick: () => void;
}

function FieldItemContent({
  field,
  onRemove,
  onRenameClick,
}: FieldItemContentProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {/* Render icon inline to avoid "component created during render" error */}
      <FieldTypeIcon type={field.type} />
      <span
        className="min-w-0 flex-1 cursor-pointer truncate text-sm hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          onRenameClick();
        }}
        title={`${field.displayName} (click to rename)`}
      >
        {field.displayName}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRenameClick();
        }}
        className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`Rename ${field.displayName}`}
      >
        <EditIcon className="h-3 w-3" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`Remove ${field.displayName}`}
      >
        <CloseIcon className="h-3 w-3" />
      </button>
    </div>
  );
}
