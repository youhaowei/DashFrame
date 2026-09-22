import type {
  DataTable,
  InsightMetric,
  MeasureExpression,
  MeasureFilter,
  MeasureFormat,
} from "@dashframe/types";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wystack/ui-react";

export type MeasureOptions = Pick<
  InsightMetric,
  "expression" | "filters" | "format"
>;
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
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
          <SelectValue />
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
export function MeasureCalculationFields({
  value,
  onChange,
  metrics,
  dataTable,
}: {
  value: MeasureOptions;
  onChange: (value: MeasureOptions) => void;
  metrics: InsightMetric[];
  dataTable: DataTable;
}) {
  const expression = value.expression;
  const binary = expression?.kind === "binary" ? expression : undefined;
  const measureChoices = metrics.map((metric) => ({
    value: metric.id,
    label: metric.name,
  }));
  const patchExpression = (
    patch: Partial<Extract<MeasureExpression, { kind: "binary" }>>,
  ) => {
    if (binary) onChange({ ...value, expression: { ...binary, ...patch } });
  };
  const patchFilter = (index: number, patch: Partial<MeasureFilter>) =>
    onChange({
      ...value,
      filters: value.filters?.map((filter, i) =>
        i === index ? { ...filter, ...patch } : filter,
      ),
    });
  const format = value.format ?? { style: "number" as const };
  const setFormat = (patch: Partial<MeasureFormat>) =>
    onChange({ ...value, format: { ...format, ...patch } });
  return (
    <div className="space-y-3">
      <Choice
        label="Calculation"
        value={expression ? "calculated" : "aggregate"}
        options={[
          { value: "aggregate", label: "Aggregate a column" },
          ...(metrics.length
            ? [{ value: "calculated", label: "Calculate from measures" }]
            : []),
        ]}
        onChange={(mode) =>
          onChange({
            ...value,
            filters: mode === "calculated" ? undefined : value.filters,
            expression:
              mode === "aggregate"
                ? undefined
                : {
                    kind: "binary",
                    operator: "divide",
                    left: { kind: "measure", measureId: metrics[0]!.id },
                    right: {
                      kind: "measure",
                      measureId: (metrics[1] ?? metrics[0])!.id,
                    },
                  },
          })
        }
      />
      {binary && (
        <div className="space-y-2">
          <Choice
            label="First measure"
            value={binary.left.kind === "measure" ? binary.left.measureId : ""}
            options={measureChoices}
            onChange={(measureId) =>
              patchExpression({ left: { kind: "measure", measureId } })
            }
          />
          <Choice
            label="Operation"
            value={binary.operator}
            options={[
              { value: "divide", label: "Divide ÷" },
              { value: "multiply", label: "Multiply ×" },
              { value: "add", label: "Add +" },
              { value: "subtract", label: "Subtract −" },
            ]}
            onChange={(operator) =>
              patchExpression({ operator: operator as typeof binary.operator })
            }
          />
          <Choice
            label="Second measure"
            value={
              binary.right.kind === "measure" ? binary.right.measureId : ""
            }
            options={measureChoices}
            onChange={(measureId) =>
              patchExpression({ right: { kind: "measure", measureId } })
            }
          />
          <p className="text-xs text-neutral-fg-subtle">
            Calculated after aggregation. Division by zero displays —.
          </p>
        </div>
      )}
      {!expression && (
        <div className="space-y-2">
          {(value.filters ?? []).map((filter, index) => (
            <div
              key={index}
              className="space-y-2 rounded-md bg-neutral-bg-muted p-2"
            >
              <Choice
                label={`Measure filter ${index + 1} field`}
                value={filter.field}
                options={(dataTable.fields ?? []).map((field) => ({
                  value: field.columnName ?? field.name,
                  label: field.name,
                }))}
                onChange={(field) => patchFilter(index, { field, value: "" })}
              />
              <Choice
                label={`Measure filter ${index + 1} condition`}
                value={filter.operator}
                options={[
                  { value: "eq", label: "Equals" },
                  { value: "ne", label: "Does not equal" },
                  { value: "gt", label: "Greater than" },
                  { value: "gte", label: "At least" },
                  { value: "lt", label: "Less than" },
                  { value: "lte", label: "At most" },
                ]}
                onChange={(operator) =>
                  patchFilter(index, {
                    operator: operator as MeasureFilter["operator"],
                  })
                }
              />
              <Input
                aria-label={`Measure filter ${index + 1} value`}
                value={String(filter.value ?? "")}
                onChange={(event) => {
                  const raw = event.target.value;
                  const field = dataTable.fields?.find(
                    (candidate) =>
                      (candidate.columnName ?? candidate.name) === filter.field,
                  );
                  const next =
                    field?.type === "number" && raw !== "" ? Number(raw) : raw;
                  patchFilter(index, {
                    value: field?.type === "boolean" ? raw === "true" : next,
                  });
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                label="Remove measure filter"
                onClick={() =>
                  onChange({
                    ...value,
                    filters: value.filters?.filter((_, i) => i !== index),
                  })
                }
              />
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            label="Filter this measure"
            disabled={!dataTable.fields?.length}
            onClick={() =>
              onChange({
                ...value,
                filters: [
                  ...(value.filters ?? []),
                  {
                    field:
                      dataTable.fields![0]!.columnName ??
                      dataTable.fields![0]!.name,
                    operator: "eq",
                    value: "",
                  },
                ],
              })
            }
          />
        </div>
      )}
      <Choice
        label="Number format"
        value={format.style}
        options={[
          { value: "number", label: "Number" },
          { value: "currency", label: "Currency" },
          { value: "percent", label: "Percentage" },
        ]}
        onChange={(style) =>
          setFormat({ style: style as MeasureFormat["style"] })
        }
      />
      {format.style === "currency" && (
        <Input
          aria-label="Currency code"
          value={format.currency ?? "USD"}
          maxLength={3}
          onChange={(event) =>
            setFormat({ currency: event.target.value.toUpperCase() })
          }
        />
      )}
      <div className="space-y-1.5">
        <Label>Decimal places</Label>
        <Input
          aria-label="Decimal places"
          type="number"
          min={0}
          max={20}
          value={format.decimals ?? 2}
          onChange={(event) =>
            setFormat({ decimals: Number(event.target.value) })
          }
        />
      </div>
    </div>
  );
}
