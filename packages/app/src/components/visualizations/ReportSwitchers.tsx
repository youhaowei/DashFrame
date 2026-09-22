import type { Field, Insight, InsightRuntimeInput } from "@dashframe/types";
import { WorkbenchCheckbox } from "@dashframe/ui";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@wystack/ui-react";
import { useState } from "react";

export function ReportSelectionMenu({
  label,
  options,
  selected,
  minimum = 0,
  maximum = 16,
  onApply,
}: {
  label: string;
  options: { id: string; label: string }[];
  selected: string[];
  minimum?: number;
  maximum?: number;
  onApply: (ids: string[]) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const toggle = (id: string, checked: boolean) =>
    setDraft((current) =>
      checked ? [...current, id] : current.filter((value) => value !== id),
    );
  const apply = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await onApply(draft);
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not apply choices.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        if (next) {
          setDraft(
            selected.filter((id) => options.some((option) => option.id === id)),
          );
          setError(undefined);
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className="rounded-md bg-neutral-bg-subtle px-3 py-2 text-xs transition-colors hover:bg-neutral-bg-muted"
          >
            {label} · {selected.length}
          </button>
        }
      />
      <PopoverContent
        className="max-h-[60vh] w-64 space-y-3 overflow-auto p-3"
        align="start"
      >
        <div className="text-sm font-medium">{label}</div>
        {options.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-2 text-xs"
          >
            <WorkbenchCheckbox
              checked={draft.includes(option.id)}
              disabled={saving}
              onCheckedChange={(checked) => toggle(option.id, checked === true)}
            />
            {option.label}
          </label>
        ))}
        <p className="text-xs text-neutral-fg-subtle">
          Choose {minimum}–{maximum}.
        </p>
        {error && (
          <p role="alert" className="text-xs text-palette-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            label="Cancel"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => setOpen(false)}
          />
          <Button
            label="Apply"
            size="sm"
            loading={saving}
            disabled={draft.length < minimum || draft.length > maximum}
            onClick={() => void apply()}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ReportSwitchers({
  insight,
  fields,
  runtime,
  onChange,
}: {
  insight: Insight | undefined;
  fields: Field[];
  runtime?: InsightRuntimeInput;
  onChange: (runtime: InsightRuntimeInput | undefined) => void;
}) {
  const dimensions = insight?.runtimeControls?.dimensions;
  const measures = insight?.runtimeControls?.measures;
  if (!insight || (!dimensions && !measures)) return null;
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 px-2 py-2"
      aria-label="Report controls"
    >
      {dimensions && (
        <ReportSelectionMenu
          label="Dimensions"
          options={fields
            .filter((field) => dimensions.allowedIds.includes(field.id))
            .map((field) => ({ id: field.id, label: field.name }))}
          selected={runtime?.dimensions ?? insight.selectedFields}
          minimum={1}
          maximum={dimensions.maxSelected}
          onApply={(ids) => onChange({ ...runtime, dimensions: ids })}
        />
      )}
      {measures && (
        <ReportSelectionMenu
          label="Measures"
          options={insight.metrics
            .filter((metric) => measures.allowedIds.includes(metric.id))
            .map((metric) => ({ id: metric.id, label: metric.name }))}
          selected={
            runtime?.measures ??
            insight.reporting?.measureIds ??
            insight.metrics.map((metric) => metric.id)
          }
          minimum={1}
          maximum={measures.maxSelected}
          onApply={(ids) => onChange({ ...runtime, measures: ids })}
        />
      )}
      {runtime && (
        <Button
          label="Reset"
          variant="ghost"
          size="sm"
          onClick={() => onChange(undefined)}
        />
      )}
    </div>
  );
}
