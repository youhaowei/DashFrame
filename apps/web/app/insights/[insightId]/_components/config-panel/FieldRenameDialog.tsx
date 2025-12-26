"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Label,
} from "@dashframe/ui";
import type { CombinedField } from "@/lib/insights/compute-combined-fields";

interface FieldRenameDialogProps {
  field: CombinedField | null;
  tableName?: string;
  onOpenChange: (open: boolean) => void;
  onSave: (field: CombinedField, newName: string) => void;
}

/**
 * Inner form component that resets when key changes.
 * Using key-based reset pattern instead of useEffect setState.
 */
function FieldRenameForm({
  field,
  tableName,
  onSave,
  onClose,
}: {
  field: CombinedField;
  tableName?: string;
  onSave: (field: CombinedField, newName: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(field.name);
  const columnName = field.columnName ?? field.name;

  const handleSave = () => {
    if (!name.trim()) return;
    onSave(field, name.trim());
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && name.trim()) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename field</DialogTitle>
        <DialogDescription>
          Change the display name for this field. The underlying column name
          remains unchanged.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {/* Source info (read-only) */}
        <div className="bg-muted space-y-2 rounded-lg px-3 py-3">
          {tableName && (
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground shrink-0 text-sm">
                Table
              </span>
              <span className="text-foreground min-w-0 break-all text-right text-sm">
                {tableName}
              </span>
            </div>
          )}
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground shrink-0 text-sm">
              Column
            </span>
            <code className="text-foreground min-w-0 break-all text-right font-mono text-sm">
              {columnName}
            </code>
          </div>
        </div>

        {/* Display Name */}
        <div className="space-y-2">
          <Label htmlFor="field-name">Display name</Label>
          <Input
            id="field-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter display name"
            autoFocus
          />
        </div>
      </div>

      <DialogFooter>
        <Button label="Cancel" variant="outlined" onClick={onClose} />
        <Button
          label="Save"
          onClick={handleSave}
          disabled={!name.trim() || name.trim() === field.name}
        />
      </DialogFooter>
    </>
  );
}

/**
 * FieldRenameDialog - Dialog for renaming a field's display name
 *
 * Shows the underlying column name for reference and allows
 * editing the user-facing display name.
 *
 * Uses key-based reset pattern: when field changes, the inner form
 * component remounts with fresh state.
 */
export function FieldRenameDialog({
  field,
  tableName,
  onOpenChange,
  onSave,
}: FieldRenameDialogProps) {
  const handleClose = () => {
    onOpenChange(false);
  };

  const isOpen = field !== null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {field && (
          <FieldRenameForm
            key={field.id}
            field={field}
            tableName={tableName}
            onSave={onSave}
            onClose={handleClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
