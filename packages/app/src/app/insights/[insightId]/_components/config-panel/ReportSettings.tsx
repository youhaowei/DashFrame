import type {
  Field,
  Insight,
  InsightReporting,
  RelativeDateRange,
} from "@dashframe/types";
import {
  Button,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wystack/ui-react";
import { useState, type ReactNode } from "react";

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label;
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select
        value={value}
        onValueChange={(value) => {
          if (value) onChange(value);
        }}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
export function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        aria-label={label}
        type="number"
        min={1}
        step={1}
        value={value ?? ""}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? undefined : Number(event.target.value),
          )
        }
      />
    </div>
  );
}

function SettingEditor({
  label,
  reporting,
  validate,
  onSave,
  children,
}: {
  label: string;
  reporting: InsightReporting | undefined;
  validate: (draft: InsightReporting) => void;
  onSave: (draft: InsightReporting) => Promise<void>;
  children: (
    draft: InsightReporting,
    update: (patch: Partial<InsightReporting>) => void,
  ) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<InsightReporting>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    setError(undefined);
    try {
      validate(draft);
      setSaving(true);
      await onSave(draft);
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save report settings.",
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
          setDraft({ ...reporting });
          setError(undefined);
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className="mt-2 w-full rounded-md bg-neutral-bg-subtle px-3 py-2 text-left text-xs transition-colors hover:bg-neutral-bg-muted focus-visible:outline-2 focus-visible:outline-palette-primary"
          >
            {label}
          </button>
        }
      />
      <PopoverContent
        side="right"
        align="start"
        className="max-h-[70vh] w-80 space-y-4 overflow-auto p-4"
      >
        <div className="text-sm font-medium">{label}</div>
        {open &&
          children(draft, (patch) =>
            setDraft((current) => ({ ...current, ...patch })),
          )}
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
            label="Save"
            size="sm"
            loading={saving}
            onClick={() => void save()}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

const PERIODS = [
  { value: "none", label: "All dates" },
  { value: "this_month", label: "This month" },
  { value: "previous_month", label: "Previous month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "previous_quarter", label: "Previous quarter" },
  { value: "this_year", label: "This year" },
  { value: "previous_year", label: "Previous year" },
  { value: "month_to_date", label: "Month to date" },
  { value: "year_to_date", label: "Year to date" },
  { value: "last_complete_days", label: "Last complete days" },
  { value: "last_complete_weeks", label: "Last complete weeks" },
  { value: "last_complete_months", label: "Last complete months" },
  { value: "absolute", label: "Custom dates" },
];
function periodRange(
  type: string,
): NonNullable<InsightReporting["dateRange"]>["range"] {
  if (type === "absolute") {
    const now = new Date();
    return {
      type,
      start: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      ).toISOString(),
      end: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
      ).toISOString(),
    };
  }
  if (
    type === "last_complete_days" ||
    type === "last_complete_weeks" ||
    type === "last_complete_months"
  )
    return { type, count: 1 };
  return { type } as Exclude<RelativeDateRange, { count: number }>;
}
function validatePeriod(draft: InsightReporting) {
  const range = draft.dateRange?.range;
  if (!range) return;
  if (!draft.dateRange?.fieldId) throw new Error("Choose a date field.");
  if (
    "count" in range &&
    (!Number.isInteger(range.count) || range.count < 1 || range.count > 10000)
  )
    throw new Error("Use a whole number from 1 to 10,000.");
  if (
    range.type === "absolute" &&
    (!Number.isFinite(Date.parse(range.start)) ||
      !Number.isFinite(Date.parse(range.end)) ||
      Date.parse(range.start) >= Date.parse(range.end))
  )
    throw new Error("Choose an end date after the start date.");
}
export function ReportPeriodControl({
  insight,
  fields,
  onChange,
}: {
  insight: Insight;
  fields: Field[];
  onChange: (patch: Partial<InsightReporting>) => Promise<void>;
}) {
  const dates = fields.filter((field) => field.type === "date");
  if (!dates.length) return null;
  const rangeType = insight.reporting?.dateRange?.range.type ?? "none";
  const label = `Period · ${PERIODS.find((period) => period.value === rangeType)?.label ?? "All dates"}`;
  return (
    <SettingEditor
      label={label}
      reporting={insight.reporting}
      validate={(draft) => {
        validatePeriod(draft);
        if (draft.dateRange && draft.comparison && !insight.metrics.length)
          throw new Error("Add a measure before comparing periods.");
      }}
      onSave={(draft) =>
        onChange({
          dateRange: draft.dateRange,
          comparison: draft.dateRange ? draft.comparison : undefined,
        })
      }
    >
      {(draft, update) => (
        <>
          <Choice
            label="Date range"
            value={draft.dateRange?.range.type ?? "none"}
            options={PERIODS}
            onChange={(type) =>
              update({
                dateRange:
                  type === "none"
                    ? undefined
                    : {
                        fieldId: draft.dateRange?.fieldId ?? dates[0]!.id,
                        range: periodRange(type),
                      },
              })
            }
          />
          {draft.dateRange && (
            <PeriodFields
              dateRange={draft.dateRange}
              dates={dates}
              onChange={(dateRange) => update({ dateRange })}
            />
          )}
          {draft.dateRange && (
            <Choice
              label="Compare with"
              value={draft.comparison ?? "none"}
              options={[
                { value: "none", label: "No comparison" },
                { value: "previous_period", label: "Previous period" },
                { value: "previous_year", label: "Previous year" },
              ]}
              onChange={(value) =>
                update({
                  comparison:
                    value === "none"
                      ? undefined
                      : (value as InsightReporting["comparison"]),
                })
              }
            />
          )}
          <p className="text-xs text-neutral-fg-subtle">
            Calendar periods use UTC. Relative dates update when the report
            runs.
          </p>
        </>
      )}
    </SettingEditor>
  );
}
function PeriodFields({
  dateRange,
  dates,
  onChange,
}: {
  dateRange: NonNullable<InsightReporting["dateRange"]>;
  dates: Field[];
  onChange: (value: NonNullable<InsightReporting["dateRange"]>) => void;
}) {
  const range = dateRange.range;
  return (
    <>
      <Choice
        label="Date field"
        value={dateRange.fieldId}
        options={dates.map((field) => ({ value: field.id, label: field.name }))}
        onChange={(fieldId) => onChange({ ...dateRange, fieldId })}
      />
      {"count" in range && (
        <NumberField
          label="Number of periods"
          value={range.count}
          onChange={(count) =>
            onChange({ ...dateRange, range: { ...range, count: count ?? 0 } })
          }
        />
      )}
      {range.type === "absolute" && (
        <div className="grid grid-cols-2 gap-2">
          {(["start", "end"] as const).map((bound) => (
            <div key={bound} className="space-y-1.5">
              <Label>
                {bound === "start" ? "Start date" : "End date (exclusive)"}
              </Label>
              <Input
                aria-label={
                  bound === "start" ? "Start date" : "End date (exclusive)"
                }
                type="date"
                value={range[bound].slice(0, 10)}
                onChange={(event) =>
                  onChange({
                    ...dateRange,
                    range: {
                      ...range,
                      [bound]: event.target.value
                        ? `${event.target.value}T00:00:00.000Z`
                        : "",
                    },
                  })
                }
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
function validateResults(draft: InsightReporting) {
  if (
    draft.limit !== undefined &&
    (!Number.isInteger(draft.limit) || draft.limit < 1 || draft.limit > 100000)
  )
    throw new Error(
      "Limit must be a whole number from 1 to 100,000, or blank for all rows.",
    );
}
export function ReportResultOptions({
  insight,
  onChange,
}: {
  insight: Insight;
  onChange: (patch: Partial<InsightReporting>) => Promise<void>;
}) {
  return (
    <SettingEditor
      label="Limit & totals"
      reporting={insight.reporting}
      validate={validateResults}
      onSave={(draft) => onChange({ limit: draft.limit, totals: draft.totals })}
    >
      {(draft, update) => (
        <>
          <NumberField
            label="Row limit (blank for all)"
            value={draft.limit}
            onChange={(limit) => update({ limit })}
          />
          <Choice
            label="Totals and KPI summary"
            value={draft.totals ? "on" : "off"}
            options={[
              { value: "off", label: "Hidden" },
              { value: "on", label: "Show" },
            ]}
            onChange={(value) => update({ totals: value === "on" })}
          />
        </>
      )}
    </SettingEditor>
  );
}
