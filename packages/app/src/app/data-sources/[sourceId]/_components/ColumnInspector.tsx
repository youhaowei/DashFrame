import type {
  ColumnAnalysis,
  ColumnType,
  Field,
  FieldSensitivity,
} from "@dashframe/types";
import {
  getFieldSensitivity,
  suggestSensitivityReasons,
} from "@dashframe/types";
import {
  OverlayScrollArea,
  WorkbenchPaneHeader,
  formatDateValue,
  formatNumeric,
} from "@dashframe/ui";
import { Badge, Button, Input, Label } from "@wystack/ui-react";
import { useId, useRef, useState, type ReactNode } from "react";

/**
 * A value as the grid shows it, short enough for a pane row. Dates arrive as
 * epoch numbers, so the column's type decides how a number reads.
 */
export function formatColumnValue(value: unknown, type?: ColumnType): string {
  if (value === null || value === undefined) return "";
  if (type === "date") return formatDateValue(value) ?? String(value);
  if (typeof value === "number") return formatNumeric(value);
  if (value instanceof Date) return formatDateValue(value) ?? String(value);
  return String(value);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-[11px] text-neutral-fg-subtle">{label}</dt>
      <dd className="min-w-0 text-xs break-words text-neutral-fg">
        {children}
      </dd>
    </div>
  );
}

/** The analysed range, in the column's own terms, or null when unknown. */
function describeRange(analysis: ColumnAnalysis): string | null {
  switch (analysis.dataType) {
    case "number":
      return `${formatNumeric(analysis.min)} – ${formatNumeric(analysis.max)}`;
    case "date":
      return `${formatDateValue(analysis.minDate) ?? analysis.minDate} – ${
        formatDateValue(analysis.maxDate) ?? analysis.maxDate
      }`;
    case "boolean":
      return `${formatNumeric(analysis.trueCount)} true · ${formatNumeric(
        analysis.falseCount,
      )} false`;
    default:
      return null;
  }
}

const SENSITIVITY_COPY: Record<
  "sensitive" | "likely" | "unclassified" | "cleared",
  { label: string; color: "danger" | "warning" | "secondary"; line: string }
> = {
  sensitive: {
    label: "Sensitive",
    color: "danger",
    line: "Restricted by privacy checks.",
  },
  likely: {
    label: "Likely sensitive",
    color: "warning",
    line: "Restricted until you decide.",
  },
  unclassified: {
    label: "Unclassified",
    color: "secondary",
    line: "Restricted until marked safe.",
  },
  cleared: {
    label: "Not sensitive",
    color: "secondary",
    line: "Not restricted.",
  },
};

export interface ColumnInspectorProps {
  field: Field;
  /** Cached profile of the column; absent until the table is analysed. */
  analysis?: ColumnAnalysis;
  /** Distinct values from the preview rows, in the grid's order. */
  sampleValues: string[];
  /** Resolves false when the rename was not saved. */
  onRename: (name: string) => Promise<boolean>;
  onSetSensitivity: (sensitivity: FieldSensitivity, reasons?: string[]) => void;
}

/**
 * The right pane of a data source: what one column is and how it may be used.
 * Sensitivity is decided here, on the one column in view, rather than flagged
 * on every column of the grid.
 */
export function ColumnInspector({
  field,
  analysis,
  sampleValues,
  onRename,
  onSetSensitivity,
}: ColumnInspectorProps) {
  const nameId = useId();
  const [name, setName] = useState(field.name);
  const [shownSavedName, setShownSavedName] = useState(field.name);
  // Escape blurs the field before its reset re-renders, so the blur's commit
  // would still see the edit; the flag tells it to save nothing.
  const cancelledRef = useRef(false);
  // A rename from elsewhere replaces what the field shows, so leaving the
  // field untouched never writes the old name back.
  if (shownSavedName !== field.name) {
    setShownSavedName(field.name);
    setName(field.name);
  }
  const commitName = async () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const next = name.trim();
    if (!next || next === field.name) {
      setName(field.name);
      return;
    }
    if (!(await onRename(next))) setName(field.name);
  };

  const sensitivity = getFieldSensitivity(field);
  const suggestedReasons =
    sensitivity === "unclassified"
      ? suggestSensitivityReasons({ name: field.name, analysis })
      : [];
  const sensitivityState =
    sensitivity === "unclassified" && suggestedReasons.length > 0
      ? "likely"
      : sensitivity;
  const copy = SENSITIVITY_COPY[sensitivityState];
  let reason: string | undefined;
  if (sensitivityState === "likely") reason = suggestedReasons.join("; ");
  else if (sensitivity === "sensitive") reason = field.sensitivityReason;
  const range = analysis ? describeRange(analysis) : null;
  const sourceColumn =
    field.columnName && field.columnName !== field.name
      ? field.columnName
      : null;

  return (
    <div className="flex h-full flex-col bg-neutral-bg text-xs">
      <WorkbenchPaneHeader title="Column">{null}</WorkbenchPaneHeader>
      <OverlayScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-3.5 pb-4">
          <div className="space-y-1">
            <Label htmlFor={nameId} className="text-[11px] font-normal">
              Display name
            </Label>
            <Input
              id={nameId}
              size="sm"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => void commitName()}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  cancelledRef.current = true;
                  setName(field.name);
                  event.currentTarget.blur();
                }
              }}
            />
          </div>

          <dl className="space-y-4">
            <Row label="Type">
              <span className="capitalize">{field.type}</span>
              {sourceColumn && (
                <span className="text-neutral-fg-subtle">
                  {" "}
                  · from <span className="font-mono">{sourceColumn}</span>
                </span>
              )}
            </Row>

            <Row label="Sensitivity">
              <span className="block space-y-2">
                <span className="flex items-center gap-1.5">
                  <Badge
                    variant={copy.color === "secondary" ? "outline" : "soft"}
                    color={copy.color}
                  >
                    {copy.label}
                  </Badge>
                </span>
                <span className="block text-neutral-fg-subtle">
                  {reason ? `${reason}. ` : ""}
                  {copy.line}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {sensitivity !== "sensitive" && (
                    <Button
                      size="sm"
                      variant="outline"
                      label="Mark sensitive"
                      onClick={() =>
                        onSetSensitivity(
                          "sensitive",
                          sensitivityState === "likely"
                            ? suggestedReasons
                            : undefined,
                        )
                      }
                    />
                  )}
                  {sensitivity !== "cleared" && (
                    <Button
                      size="sm"
                      variant="outline"
                      label="Mark safe"
                      onClick={() => onSetSensitivity("cleared")}
                    />
                  )}
                </span>
              </span>
            </Row>

            {analysis && (
              <Row label="Empty values">
                {formatNumeric(analysis.nullCount)}
              </Row>
            )}
            {analysis && (
              <Row label="Distinct values">
                {formatNumeric(analysis.cardinality)}
              </Row>
            )}
            {range && <Row label="Range">{range}</Row>}

            {sampleValues.length > 0 && (
              <Row label="Sample">
                <span className="flex flex-wrap gap-1">
                  {sampleValues.map((value) => (
                    <span
                      key={value}
                      className="max-w-full truncate rounded bg-neutral-bg-subtle px-1.5 py-0.5 font-mono text-[11px]"
                      title={value}
                    >
                      {value}
                    </span>
                  ))}
                </span>
              </Row>
            )}
          </dl>
        </div>
      </OverlayScrollArea>
    </div>
  );
}
