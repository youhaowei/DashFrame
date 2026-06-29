import type { ColumnProfile, DataReadResult, NodeRef } from "./port.js";

export interface PerceptionAssemblerOptions {
  /** Bounded row sample; omit to return profiles only. */
  sampleRows?: ReadonlyArray<Record<string, unknown>>;
  /** Maximum rows the agent may see. Default: 5. */
  maxRows?: number;
  /** Approximate JSON-character budget for the sample. Default: 12k. */
  maxSampleChars?: number;
  /** Incomplete lineage: obfuscate every value even if a column is marked cleared. */
  maskAllValues?: boolean;
}

const DEFAULT_MAX_ROWS = 5;
const DEFAULT_MAX_SAMPLE_CHARS = 12_000;

function obfuscateValue(value: unknown): unknown {
  if (value === null) return "<null>";
  if (value === undefined) return "<undefined>";
  if (typeof value === "number") return 0;
  if (typeof value === "boolean") return false;
  if (typeof value === "string") return "<text>";
  if (Array.isArray(value)) return "<array>";
  if (typeof value === "object") return "<object>";
  return "<value>";
}

function columnIsRestricted(column: ColumnProfile): boolean {
  return column.sensitivity !== "cleared";
}

function sampleTier(
  columns: ReadonlyArray<ColumnProfile>,
  maskAllValues: boolean,
): "raw" | "mixed" | "obfuscated" {
  if (maskAllValues) return "obfuscated";
  const hasCleared = columns.some((column) => !columnIsRestricted(column));
  const hasRestricted = columns.some(columnIsRestricted);
  if (hasCleared && hasRestricted) return "mixed";
  return hasRestricted ? "obfuscated" : "raw";
}

function projectAndTierRow(
  row: Record<string, unknown>,
  columnsByName: ReadonlyMap<string, ColumnProfile>,
  maskAllValues: boolean,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).flatMap(([key, value]) => {
      const column = columnsByName.get(key);
      if (column === undefined) return [];
      return [
        [
          key,
          maskAllValues || columnIsRestricted(column)
            ? obfuscateValue(value)
            : value,
        ],
      ];
    }),
  );
}

function withinBudget(rows: Array<Record<string, unknown>>, budget: number) {
  return (
    JSON.stringify(rows, (_, v) => (typeof v === "bigint" ? String(v) : v))
      .length <= budget
  );
}

function selectRowsUnderBudget(
  rows: ReadonlyArray<Record<string, unknown>>,
  opts: {
    columnsByName: ReadonlyMap<string, ColumnProfile>;
    maskAllValues: boolean;
    maxRows: number;
    maxSampleChars: number;
  },
): { rows: Array<Record<string, unknown>>; truncated: boolean } {
  const capped = rows
    .slice(0, opts.maxRows)
    .map((row) =>
      projectAndTierRow(row, opts.columnsByName, opts.maskAllValues),
    );

  while (capped.length > 0 && !withinBudget(capped, opts.maxSampleChars)) {
    capped.pop();
  }

  return {
    rows: capped,
    truncated: capped.length < rows.length,
  };
}

/**
 * Assemble the agent's value context under the privacy floor and a bounded
 * sample budget. Profiles are always present. Cleared columns may flow raw;
 * restricted columns are obfuscated. Incomplete lineage masks every value.
 */
export function assembleDataRead(
  node: NodeRef,
  masked: boolean,
  columns: ColumnProfile[],
  options: PerceptionAssemblerOptions = {},
): DataReadResult {
  const result: DataReadResult = { node, masked, columns };
  if (!options.sampleRows || options.sampleRows.length === 0) return result;

  const maxRows = Math.max(0, options.maxRows ?? DEFAULT_MAX_ROWS);
  if (maxRows === 0) return result;

  const maskAllValues =
    options.maskAllValues ?? (masked && !columns.some(columnIsRestricted));
  const columnsByName = new Map(columns.map((column) => [column.name, column]));
  const selected = selectRowsUnderBudget(options.sampleRows, {
    columnsByName,
    maskAllValues,
    maxRows,
    maxSampleChars: Math.max(
      2,
      options.maxSampleChars ?? DEFAULT_MAX_SAMPLE_CHARS,
    ),
  });

  result.sample = {
    tier: sampleTier(columns, maskAllValues),
    rows: selected.rows,
    rowCount: options.sampleRows.length,
    truncated: selected.truncated,
  };
  return result;
}
