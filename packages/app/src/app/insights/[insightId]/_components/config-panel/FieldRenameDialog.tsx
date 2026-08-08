import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@wystack/ui-react";
import { useState } from "react";

interface FieldRenameDialogProps {
  field: CombinedField | null;
  tableName?: string;
  onOpenChange: (open: boolean) => void;
  onSave: (field: CombinedField, newName: string) => Promise<void> | void;
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
  onSave: (field: CombinedField, newName: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [name, setName] = useState(field.name);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const columnName = field.columnName ?? field.name;

  const handleSave = async () => {
    if (!name.trim()) return;
    setError(null);
    setIsSaving(true);
    try {
      await onSave(field, name.trim());
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setError(`Failed to rename field: ${message}`);
    } finally {
      setIsSaving(false);
    }
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
        {error && (
          <Alert color="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Source info (read-only) */}
        <div className="space-y-2 rounded-lg bg-neutral-bg-muted px-3 py-3">
          {tableName && (
            <div className="flex items-start justify-between gap-4">
              <span className="shrink-0 text-sm text-neutral-fg-subtle">
                Table
              </span>
              <span className="min-w-0 text-right text-sm break-all text-neutral-fg">
                {tableName}
              </span>
            </div>
          )}
          <div className="flex items-start justify-between gap-4">
            <span className="shrink-0 text-sm text-neutral-fg-subtle">
              Column
            </span>
            <code className="min-w-0 text-right font-mono text-sm break-all text-neutral-fg">
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
        <Button
          label="Cancel"
          variant="outline"
          onClick={onClose}
          disabled={isSaving}
        />
        <Button
          label={isSaving ? "Saving..." : "Save"}
          onClick={handleSave}
          disabled={isSaving || !name.trim() || name.trim() === field.name}
          loading={isSaving}
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
