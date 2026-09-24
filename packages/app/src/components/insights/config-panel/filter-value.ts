import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import type {
  InsightFilter,
  InsightFilterBetweenValue,
} from "@dashframe/types";

/**
 * Pure value parsing + validation for the filter editor. Kept free of UI/React
 * imports so it can be unit-tested directly — this is the single source of
 * truth the Save button gates on.
 */

type Operator = InsightFilter["operator"];
export type FilterInputType = "text" | "number" | "date";

/** Auto-detect the HTML input type from a field's normalized ColumnType. */
export function inputTypeForField(
  field: CombinedField | undefined,
): FilterInputType {
  if (!field) return "text";
  const t = field.type;
  if (t === "number") return "number";
  if (t === "date") return "date";
  return "text";
}

/** Editable draft of a filter's inputs, independent of React state. */
export interface FilterDraft {
  field: string;
  operator: Operator;
  inputType: FilterInputType;
  scalarValue: string;
  betweenLow: string;
  betweenHigh: string;
}

/** Split the comma-separated `in` input into trimmed, non-empty tokens. */
function parseInTokens(scalarValue: string): string[] {
  return scalarValue
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Build the persisted `value` for a filter draft. Coerces to number for numeric
 * fields. Callers must gate on isFilterDraftValid first — this does not itself
 * reject NaN or empty lists.
 */
export function buildFilterValue(draft: FilterDraft): unknown {
  const { operator, inputType, scalarValue, betweenLow, betweenHigh } = draft;
  if (operator === "between") {
    const low = inputType === "number" ? Number(betweenLow) : betweenLow;
    const high = inputType === "number" ? Number(betweenHigh) : betweenHigh;
    return { low, high } satisfies InsightFilterBetweenValue;
  }
  if (operator === "in") {
    const tokens = parseInTokens(scalarValue);
    return inputType === "number" ? tokens.map(Number) : tokens;
  }
  if (inputType === "number") {
    const n = Number(scalarValue);
    return isFinite(n) ? n : scalarValue;
  }
  return scalarValue;
}

/**
 * Whether a filter draft can be saved. Rejects: no field; empty between bounds
 * or non-finite numeric bounds; empty `in` list (IN () is always-false SQL) or
 * any non-finite numeric `in` element; empty scalar or non-finite numeric
 * scalar.
 */
export function isFilterDraftValid(draft: FilterDraft): boolean {
  const { field, operator, inputType, scalarValue, betweenLow, betweenHigh } =
    draft;
  if (!field) return false;
  if (operator === "between") {
    if (betweenLow.trim() === "" || betweenHigh.trim() === "") return false;
    if (inputType === "number")
      return isFinite(Number(betweenLow)) && isFinite(Number(betweenHigh));
    return true;
  }
  if (operator === "in") {
    const tokens = parseInTokens(scalarValue);
    if (tokens.length === 0) return false;
    if (inputType === "number") return tokens.every((t) => isFinite(Number(t)));
    return true;
  }
  if (scalarValue.trim() === "") return false;
  if (inputType === "number") return isFinite(Number(scalarValue));
  return true;
}
