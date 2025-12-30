"use client";

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Badge,
  Input,
  cn,
} from "@dashframe/ui";
import { NumberTypeIcon, DatabaseIcon, SearchIcon } from "@dashframe/ui/icons";
import type { CombinedField } from "@/lib/insights/compute-combined-fields";

interface InsightFieldEditorModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  availableFields: CombinedField[];
  baseTableId: string;
  onSelect: (fieldId: string) => void;
}

/**
 * InsightFieldEditorModal - Dialog for adding fields to an insight
 *
 * Displays available fields from base table + joined tables.
 * Clicking a field adds it to the insight's selected fields.
 */
export function InsightFieldEditorModal({
  isOpen,
  onOpenChange,
  availableFields,
  baseTableId,
  onSelect,
}: InsightFieldEditorModalProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // Filter fields by search query
  const filteredFields = useMemo(() => {
    if (!searchQuery.trim()) return availableFields;

    const query = searchQuery.toLowerCase();
    return availableFields.filter(
      (field) =>
        field.displayName.toLowerCase().includes(query) ||
        field.name.toLowerCase().includes(query) ||
        field.type.toLowerCase().includes(query),
    );
  }, [availableFields, searchQuery]);

  // Group fields by source table
  const groupedFields = useMemo(() => {
    const groups = new Map<string, CombinedField[]>();

    for (const field of filteredFields) {
      const isBase = field.sourceTableId === baseTableId;
      const groupKey = isBase ? "base" : field.sourceTableId;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(field);
    }

    return groups;
  }, [filteredFields, baseTableId]);

  const handleSelect = (fieldId: string) => {
    onSelect(fieldId);
    onOpenChange(false);
    setSearchQuery("");
  };

  const handleClose = () => {
    onOpenChange(false);
    setSearchQuery("");
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add field</DialogTitle>
          <DialogDescription>
            Select a field to add as a dimension for grouping your data.
          </DialogDescription>
        </DialogHeader>

        {/* Search input */}
        <div className="relative">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search fields..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        {/* Field list */}
        <div className="max-h-[300px] space-y-4 overflow-y-auto">
          {filteredFields.length === 0 ? (
            <div className="py-8 text-center">
              <NumberTypeIcon className="text-muted-foreground mx-auto mb-2 h-8 w-8" />
              <p className="text-muted-foreground text-sm">
                {availableFields.length === 0
                  ? "All fields have been added."
                  : "No fields match your search."}
              </p>
            </div>
          ) : (
            Array.from(groupedFields.entries()).map(([groupKey, fields]) => {
              const isBase = groupKey === "base";
              return (
                <div key={groupKey}>
                  <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-medium uppercase">
                    <DatabaseIcon className="h-3 w-3" />
                    {isBase ? "Base table" : "Joined table"}
                  </div>
                  <div className="space-y-1">
                    {fields.map((field) => (
                      <FieldOption
                        key={field.id}
                        field={field}
                        isJoined={!isBase}
                        onClick={() => handleSelect(field.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface FieldOptionProps {
  field: CombinedField;
  isJoined: boolean;
  onClick: () => void;
}

function FieldOption({ field, isJoined, onClick }: FieldOptionProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "hover:bg-accent flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
        "focus:ring-primary focus:ring-2 focus:outline-none",
      )}
    >
      <NumberTypeIcon className="text-muted-foreground h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{field.displayName}</p>
        {field.columnName && field.columnName !== field.name && (
          <p className="text-muted-foreground truncate text-xs">
            Column: {field.columnName}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant="outline" className="text-[10px]">
          {field.type}
        </Badge>
        {isJoined && (
          <Badge
            variant="secondary"
            className="bg-blue-500/10 text-[10px] text-blue-600"
          >
            joined
          </Badge>
        )}
      </div>
    </button>
  );
}
