import type { DataFrameData, Field } from "@dashframe/types";
import {
  OverlayScrollArea,
  VirtualTable,
  type VirtualTableColumnConfig,
} from "@dashframe/ui";
import { Button, Spinner, cn } from "@wystack/ui-react";
import { formatColumnValue } from "./ColumnInspector";

export type TablePreviewView = "grid" | "columns";

/** The frame column a field reads; frames keep source column names. */
export function fieldColumnName(field: Field): string {
  return field.columnName ?? field.name;
}

/** Whether a field matches the "Find column" text, by name or source column. */
export function matchesColumnQuery(field: Field, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    field.name.toLowerCase().includes(needle) ||
    fieldColumnName(field).toLowerCase().includes(needle)
  );
}

/** Up to `limit` distinct, non-empty values of a field's column, in row order. */
export function sampleColumnValues(
  rows: readonly Record<string, unknown>[],
  field: Field,
  limit: number,
): string[] {
  const columnName = fieldColumnName(field);
  const values: string[] = [];
  for (const row of rows) {
    const value = formatColumnValue(row[columnName], field.type);
    if (value && !values.includes(value)) values.push(value);
    if (values.length >= limit) break;
  }
  return values;
}

export interface TablePreviewProps {
  fields: Field[];
  view: TablePreviewView;
  columnQuery: string;
  selectedFieldId: string | null;
  onSelectField: (fieldId: string) => void;
  preview: {
    data: DataFrameData | null;
    isLoading: boolean;
    error: string | null;
    reload: () => void;
  };
}

function CenteredStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      {children}
    </div>
  );
}

/**
 * The open table, preview first: a grid of its first rows, or for wide
 * tables a list of its columns. Both scroll inside themselves, so the page
 * never scrolls sideways.
 */
export function TablePreview({
  fields,
  view,
  columnQuery,
  selectedFieldId,
  onSelectField,
  preview,
}: TablePreviewProps) {
  const matchingFields = fields.filter((field) =>
    matchesColumnQuery(field, columnQuery),
  );
  const rows = preview.data?.rows ?? [];

  if (fields.length > 0 && matchingFields.length === 0) {
    return (
      <CenteredStatus>
        <p className="text-sm text-neutral-fg-subtle">
          No columns match &ldquo;{columnQuery.trim()}&rdquo;.
        </p>
      </CenteredStatus>
    );
  }

  if (view === "columns") {
    return (
      <OverlayScrollArea className="h-full">
        <ul aria-label="Columns" className="space-y-0.5 p-1.5">
          {matchingFields.map((field) => {
            const selected = field.id === selectedFieldId;
            const sample = sampleColumnValues(rows, field, 3).join(", ");
            return (
              <li key={field.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelectField(field.id)}
                  className={cn(
                    "grid w-full grid-cols-[minmax(0,2fr)_5rem_minmax(0,3fr)] items-center gap-3 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors duration-150 motion-reduce:transition-none",
                    "hover:bg-neutral-bg-subtle focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none",
                    selected && "bg-neutral-bg-muted hover:bg-neutral-bg-muted",
                  )}
                >
                  <span className="truncate font-medium text-neutral-fg">
                    {field.name}
                  </span>
                  <span className="truncate text-neutral-fg-subtle capitalize">
                    {field.type}
                  </span>
                  <span className="truncate font-mono text-[11px] text-neutral-fg-subtle">
                    {sample}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </OverlayScrollArea>
    );
  }

  if (preview.isLoading) {
    return (
      <CenteredStatus>
        <Spinner size="sm" />
        <p className="text-sm text-neutral-fg-subtle">Loading rows…</p>
      </CenteredStatus>
    );
  }

  // A failed load is not an empty table. Checked before the rows because the
  // hook clears them on failure, which would otherwise read as zero rows.
  if (preview.error) {
    return (
      <CenteredStatus>
        <p className="text-sm font-medium text-neutral-fg">
          Couldn&apos;t load the preview
        </p>
        <p className="text-sm text-neutral-fg-subtle">
          Something went wrong. Check your connection and try again.
        </p>
        <Button
          variant="outline"
          size="sm"
          label="Try again"
          onClick={preview.reload}
        />
      </CenteredStatus>
    );
  }

  if (!preview.data || rows.length === 0) {
    return (
      <CenteredStatus>
        <p className="text-sm text-neutral-fg-subtle">
          This table has no rows.
        </p>
      </CenteredStatus>
    );
  }

  const matchingColumns = new Set(matchingFields.map(fieldColumnName));
  const fieldByColumn = new Map(
    fields.map((field) => [fieldColumnName(field), field]),
  );
  const columns = preview.data.columns ?? [];
  const columnConfigs: VirtualTableColumnConfig[] = columns.map((column) => {
    const field = fieldByColumn.get(column.name);
    return {
      id: column.name,
      label: field?.name,
      hidden: field
        ? !matchingColumns.has(column.name)
        : columnQuery.trim() !== "",
      highlight:
        field !== undefined && field.id === selectedFieldId
          ? "selected"
          : false,
    };
  });

  return (
    <VirtualTable
      rows={rows}
      columns={columns}
      columnConfigs={columnConfigs}
      height="100%"
      className="h-full"
      stickyFirstColumn
      onHeaderClick={(columnName) => {
        const field = fieldByColumn.get(columnName);
        if (field) onSelectField(field.id);
      }}
    />
  );
}
