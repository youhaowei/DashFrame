import type { ColumnType, Field, FieldSensitivity } from "@dashframe/types";
import { getFieldSensitivity } from "@dashframe/types";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@stdui/react";
import { useState } from "react";

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
  const [sensitivity, setSensitivity] = useState<FieldSensitivity>(
    getFieldSensitivity(field),
  );

  const handleSave = () => {
    if (!name.trim()) return;

    const updates: Partial<Field> = {
      name: name.trim(),
      type,
      isIdentifier,
    };
    // Only write sensitivity when changed, so an untouched field keeps its
    // existing reason/source (e.g. a confirmed classifier suggestion).
    if (sensitivity !== getFieldSensitivity(field)) {
      updates.sensitivity = sensitivity;
      updates.sensitivitySource = "user";
      updates.sensitivityReason =
        sensitivity === "cleared"
          ? "Cleared by you"
          : "Marked sensitive by you";
    }

    onSave(field.id, updates);
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

        {/* Privacy Sensitivity */}
        <div className="space-y-2">
          <Label htmlFor="field-sensitivity">Privacy</Label>
          <Select
            value={sensitivity}
            onValueChange={(v) => setSensitivity(v as FieldSensitivity)}
          >
            <SelectTrigger id="field-sensitivity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unclassified">
                Unclassified (treated as sensitive)
              </SelectItem>
              <SelectItem value="sensitive">Sensitive</SelectItem>
              <SelectItem value="cleared">Not sensitive</SelectItem>
            </SelectContent>
          </Select>
          {field.sensitivityReason && (
            <p className="text-xs text-neutral-fg-subtle">
              {field.sensitivityReason}
            </p>
          )}
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
            className="text-sm leading-none font-normal peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Use as identifier (unique key)
          </Label>
        </div>
      </div>

      <DialogFooter>
        <Button label="Cancel" variant="outline" onClick={onClose} />
        <Button
          label="Save Changes"
          onClick={handleSave}
          disabled={!name.trim()}
        />
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
