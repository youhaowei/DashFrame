"use client";

import { useState } from "react";
import type { Field, ColumnType } from "@dashframe/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  PrimitiveButton,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Checkbox,
} from "@dashframe/ui";

interface FieldEditorModalProps {
  isOpen: boolean;
  field: Field | null;
  onSave: (fieldId: string, updates: Partial<Field>) => void;
  onClose: () => void;
}

/**
 * Internal form component that initializes state from props.
 * By using a key={field.id} on this component, React will remount it
 * when the field changes, effectively resetting the form state.
 */
function FieldEditorForm({
  field,
  onSave,
  onClose,
}: {
  field: Field;
  onSave: (fieldId: string, updates: Partial<Field>) => void;
  onClose: () => void;
}) {
  // Initialize state from props - no useEffect needed since component remounts on key change
  const [name, setName] = useState(field.name);
  const [type, setType] = useState<ColumnType>(field.type);
  const [isIdentifier, setIsIdentifier] = useState(field.isIdentifier ?? false);

  const handleSave = () => {
    if (!name.trim()) return;

    onSave(field.id, {
      name: name.trim(),
      type,
      isIdentifier,
    });
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit Field</DialogTitle>
        <DialogDescription>
          Modify the properties of this field. Changes will affect how the data
          is displayed and processed.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {/* Field Name */}
        <div className="space-y-2">
          <Label htmlFor="field-name">Field Name</Label>
          <Input
            id="field-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter field name"
            autoFocus
          />
        </div>

        {/* Field Type */}
        <div className="space-y-2">
          <Label htmlFor="field-type">Field Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as ColumnType)}>
            <SelectTrigger id="field-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="string">String</SelectItem>
              <SelectItem value="number">Number</SelectItem>
              <SelectItem value="date">Date</SelectItem>
              <SelectItem value="boolean">Boolean</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Is Identifier */}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="is-identifier"
            checked={isIdentifier}
            onCheckedChange={(checked) => setIsIdentifier(checked === true)}
          />
          <Label
            htmlFor="is-identifier"
            className="text-sm font-normal leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Use as identifier (unique key)
          </Label>
        </div>
      </div>

      <DialogFooter>
        <PrimitiveButton variant="outline" onClick={onClose}>
          Cancel
        </PrimitiveButton>
        <PrimitiveButton onClick={handleSave} disabled={!name.trim()}>
          Save Changes
        </PrimitiveButton>
      </DialogFooter>
    </>
  );
}

export function FieldEditorModal({
  isOpen,
  field,
  onSave,
  onClose,
}: FieldEditorModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {field && (
          <FieldEditorForm
            key={field.id}
            field={field}
            onSave={onSave}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
