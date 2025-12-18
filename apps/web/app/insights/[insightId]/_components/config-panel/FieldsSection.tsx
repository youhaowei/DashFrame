"use client";

import { useState, useCallback } from "react";
import {
  Button,
  Badge,
  SortableList,
  type SortableListItem,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
} from "@dashframe/ui";
import {
  Hash,
  Type,
  Calendar,
  Toggle,
  ChevronRight,
  X,
  Plus,
} from "@dashframe/ui/icons";
import type { IconType } from "react-icons";
import type { CombinedField } from "@/lib/insights/compute-combined-fields";

/** Extended sortable item with field data */
interface FieldSortableItem extends SortableListItem {
  field: CombinedField;
  isJoined: boolean;
}

interface FieldsSectionProps {
  selectedFields: CombinedField[];
  selectedFieldIds: string[];
  baseTableId: string;
  onReorder: (newOrder: string[]) => void;
  onRemove: (fieldId: string) => void;
  onAddClick: () => void;
  defaultOpen?: boolean;
}

/**
 * FieldsSection - Collapsible section for managing insight fields (dimensions)
 *
 * Shows a sortable list of selected fields with drag-and-drop reordering.
 * Each field displays name, type, and source (base/joined).
 */
export function FieldsSection({
  selectedFields,
  baseTableId,
  onReorder,
  onRemove,
  onAddClick,
  defaultOpen = true,
}: FieldsSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // Convert CombinedField to sortable item format
  const sortableItems: FieldSortableItem[] = selectedFields.map((field) => ({
    id: field.id,
    field,
    isJoined: field.sourceTableId !== baseTableId,
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
            <button className="hover:bg-accent/50 -ml-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors">
              <ChevronRight
                className={cn(
                  "text-muted-foreground h-4 w-4 transition-transform",
                  isOpen && "rotate-90",
                )}
              />
              <Hash className="text-muted-foreground h-4 w-4" />
              <span className="text-sm font-medium leading-none">Fields</span>
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-xs tabular-nums leading-none"
              >
                {selectedFields.length}
              </Badge>
            </button>
          </CollapsibleTrigger>
          <Button
            label="Add"
            icon={Plus}
            variant="ghost"
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
                    isJoined={item.isJoined}
                    onRemove={() => onRemove(item.id)}
                  />
                )}
              />
            ) : (
              <p className="text-muted-foreground py-2 text-sm">
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
  isJoined: boolean;
  onRemove: () => void;
}

/** Get icon for field type */
function getFieldTypeIcon(type: string): IconType {
  const normalizedType = type.toLowerCase();

  // Numeric types
  if (
    ["number", "integer", "float", "decimal", "int", "bigint"].includes(
      normalizedType,
    )
  ) {
    return Hash;
  }

  // Date/time types
  if (
    ["date", "datetime", "timestamp", "time"].includes(normalizedType) ||
    normalizedType.includes("date")
  ) {
    return Calendar;
  }

  // Boolean types
  if (["boolean", "bool"].includes(normalizedType)) {
    return Toggle;
  }

  // Default to text/string
  return Type;
}

function FieldItemContent({
  field,
  isJoined,
  onRemove,
}: FieldItemContentProps) {
  const FieldIcon = getFieldTypeIcon(field.type);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <FieldIcon
        className="text-muted-foreground h-3 w-3 shrink-0"
        title={field.type}
      />
      <span className="min-w-0 flex-1 truncate text-sm">
        {field.displayName}
      </span>
      {isJoined && (
        <Badge
          variant="secondary"
          className="shrink-0 bg-blue-500/10 text-[10px] text-blue-600"
        >
          joined
        </Badge>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="text-muted-foreground hover:bg-muted hover:text-foreground shrink-0 rounded-full p-0.5"
        aria-label={`Remove ${field.displayName}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
