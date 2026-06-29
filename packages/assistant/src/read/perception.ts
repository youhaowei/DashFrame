import type { ColumnProfile, DataReadResult, NodeRef } from "./port.js";

export interface PerceptionAssemblerOptions {
  /** Bounded row sample; omit to return profiles only. */
  sampleRows?: ReadonlyArray<Record<string, unknown>>;
  /** Maximum rows the agent may see. Default: 5. */
  maxRows?: number;
  /** Approximate JSON-character budget for the sample. Default: 12k. */
  maxSampleChars?: number;
}

const DEFAULT_MAX_ROWS = 5;
const DEFAULT_MAX_SAMPLE_CHARS = 12_000;

function obfuscateValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number") return 0;
  if (typeof value === "boolean") return false;
  if (typeof value === "string") return value.length === 0 ? "" : "<text>";
  if (Array.isArray(value)) return value.map(obfuscateValue);
  if (typeof value === "object") return "<object>";
  return "<value>";
}

function obfuscateRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, obfuscateValue(value)]),
  );
}

function withinBudget(rows: Array<Record<string, unknown>>, budget: number) {
  return JSON.stringify(rows).length <= budget;
}

function selectRowsUnderBudget(
  rows: ReadonlyArray<Record<string, unknown>>,
  opts: { maxRows: number; maxSampleChars: number; masked: boolean },
): { rows: Array<Record<string, unknown>>; truncated: boolean } {
  const capped = rows
    .slice(0, opts.maxRows)
    .map((row) => (opts.masked ? obfuscateRow(row) : { ...row }));

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
 * sample budget. Profiles are always present; raw rows are included only for
 * unmasked reads. Masked reads may include obfuscated rows, never raw values.
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

  const selected = selectRowsUnderBudget(options.sampleRows, {
    maxRows,
    maxSampleChars: Math.max(
      2,
      options.maxSampleChars ?? DEFAULT_MAX_SAMPLE_CHARS,
    ),
    masked,
  });

  result.sample = {
    tier: masked ? "obfuscated" : "raw",
    rows: selected.rows,
    rowCount: options.sampleRows.length,
    truncated: selected.truncated,
  };
  return result;
}
