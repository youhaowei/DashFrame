"use client";

import { useState, useEffect } from "react";
import type { Field, ColumnType } from "@dashframe/dataframe";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Checkbox } from "@dashframe/ui";

interface FieldEditorModalProps {
  isOpen: boolean;
  field: Field | null;
  onSave: (fieldId: string, updates: Partial<Field>) => void;
  onClose: () => void;
}

export function FieldEditorModal({
  isOpen,
  field,
  onSave,
  onClose,
}: FieldEditorModalProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ColumnType>("string");
  const [isIdentifier, setIsIdentifier] = useState(false);

  // Reset form when field changes
  useEffect(() => {
    if (field) {
      setName(field.name);
      setType(field.type);
      setIsIdentifier(field.isIdentifier ?? false);
    } else {
      setName("");
      setType("string");
      setIsIdentifier(false);
    }
  }, [field]);

  const handleSave = () => {
    if (!field || !name.trim()) return;

    onSave(field.id, {
      name: name.trim(),
      type,
      isIdentifier,
    });

    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Field</DialogTitle>
          <DialogDescription>
            Modify the properties of this field. Changes will affect how the
            data is displayed and processed.
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
              onCheckedChange={(checked) =>
                setIsIdentifier(checked === true)
              }
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
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
