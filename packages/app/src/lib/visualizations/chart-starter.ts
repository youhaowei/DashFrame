import { extractColumnAliasComponents } from "@dashframe/engine";
import {
  looksLikeIdentifier,
  type ColumnAnalysis,
  type Field,
  type VisualizationType,
} from "@dashframe/types";

/**
 * Rule-based starting points for an empty chart. Each suggestion names the
 * rule that produced it, so the card can say why it is there; nothing here is
 * scored or learned, and the same table always gives the same suggestions.
 */
export type ChartStarterRule =
  | "line-over-time"
  | "count-by-category"
  | "sum-sorted";

export interface ChartStarterSuggestion {
  /** Stable per table: rule, grouping field and measured field. */
  key: string;
  rule: ChartStarterRule;
  chartType: Extract<VisualizationType, "line" | "barY" | "barX">;
  /** The field the chart groups by. */
  group: Field;
  aggregation: "count" | "sum";
  /** The number field a sum measures; absent for a row count. */
  measure?: Field;
  /** Sort the groups by the metric, largest first. */
  sortByValue: boolean;
}

/** Rules in priority order: the first card comes from the first rule. */
const RULE_ORDER: readonly ChartStarterRule[] = [
  "line-over-time",
  "count-by-category",
  "sum-sorted",
];

export const CHART_STARTER_RULE_LABELS: Record<ChartStarterRule, string> = {
  "line-over-time": "Date + number → line over time",
  "count-by-category": "Few text values + row count → bar",
  "sum-sorted": "Text + number → bar, sorted",
};

export const MAX_CHART_STARTER_SUGGESTIONS = 4;
/** Above this many columns the rules cannot choose well; the plain table shows. */
export const MAX_CHART_STARTER_COLUMNS = 20;
/** "Few values": a text column a row-count bar can show every value of. */
export const FEW_TEXT_VALUES = 12;
/** A sorted bar is readable up to this many groups. */
const MAX_SORTED_BAR_VALUES = 50;
/** A line thumbnail draws the whole series, up to this many dates. */
const MAX_LINE_DATES = 2000;

/**
 * The most groups a suggestion's chart may have. The rules judge distinct
 * values on a sample of rows; the card's own aggregate checks the real count
 * against this and drops the card when the sample undercounted.
 */
export function chartStarterGroupLimit(rule: ChartStarterRule): number {
  if (rule === "count-by-category") return FEW_TEXT_VALUES;
  if (rule === "sum-sorted") return MAX_SORTED_BAR_VALUES;
  return MAX_LINE_DATES;
}

interface Column {
  field: Field;
  analysis: ColumnAnalysis;
}

/** A result column is named by its field's id, or by the `field_<uuid>` alias. */
export function starterColumnFieldId(columnName: string): string {
  const alias = extractColumnAliasComponents(columnName);
  // A repeat-join instance is not the table's own field.
  if (alias) return alias.instanceIndex === 0 ? alias.uuid : columnName;
  return columnName;
}

function isIdentifier(field: Field): boolean {
  return (
    field.isIdentifier === true ||
    looksLikeIdentifier(field.name) ||
    (field.columnName !== undefined && looksLikeIdentifier(field.columnName))
  );
}

/** Columns a rule may use, in the table's column order. */
function usableColumns(
  fields: readonly Field[],
  analysis: readonly ColumnAnalysis[],
): Column[] {
  const byId = new Map(fields.map((field) => [field.id as string, field]));
  return analysis.flatMap((column) => {
    const field = byId.get(starterColumnFieldId(column.columnName));
    if (!field || field.name.startsWith("_") || !field.columnName) return [];
    if (isIdentifier(field)) return [];
    // A column with no values in the sample tells the rules nothing.
    if (column.cardinality === 0) return [];
    return [{ field, analysis: column }];
  });
}

function candidatesFor(
  rule: ChartStarterRule,
  columns: readonly Column[],
  canSum: (field: Field) => boolean,
): ChartStarterSuggestion[] {
  const numbers = columns.filter(
    (column) => column.analysis.dataType === "number" && canSum(column.field),
  );
  const texts = columns.filter(
    (column) => column.analysis.dataType === "string",
  );
  if (rule === "line-over-time") {
    const dates = columns.filter(
      (column) => column.analysis.dataType === "date",
    );
    return dates.flatMap((date) =>
      numbers.map((number) => ({
        key: `${rule}:${date.field.id}:${number.field.id}`,
        rule,
        chartType: "line" as const,
        group: date.field,
        aggregation: "sum" as const,
        measure: number.field,
        sortByValue: false,
      })),
    );
  }
  if (rule === "count-by-category") {
    return texts
      .filter((text) => text.analysis.cardinality <= FEW_TEXT_VALUES)
      .map((text) => ({
        key: `${rule}:${text.field.id}`,
        rule,
        chartType: "barY" as const,
        group: text.field,
        aggregation: "count" as const,
        sortByValue: false,
      }));
  }
  return texts
    .filter((text) => text.analysis.cardinality <= MAX_SORTED_BAR_VALUES)
    .flatMap((text) =>
      numbers.map((number) => ({
        key: `${rule}:${text.field.id}:${number.field.id}`,
        rule,
        chartType: "barX" as const,
        group: text.field,
        aggregation: "sum" as const,
        measure: number.field,
        sortByValue: true,
      })),
    );
}

/**
 * Up to `limit` (four) suggestions for an empty chart, or none when the table has no
 * rows or too many columns — then the empty chart shows its plain table.
 *
 * Each rule offers its candidates in column order. The first pass takes one
 * card per rule, in rule order, preferring a grouping column no earlier card
 * uses; later passes fill the remaining slots in rule order.
 */
export function suggestChartStarters(
  fields: readonly Field[],
  analysis: readonly ColumnAnalysis[],
  rowCount: number,
  options: {
    /** How many to return; the starter asks for every candidate as backups. */
    limit?: number;
    /**
     * Whether a plain sum of this number field is a valid metric. A field
     * that fails (a ratio or non-additive measure) is never summed.
     */
    canSum?: (field: Field) => boolean;
  } = {},
): ChartStarterSuggestion[] {
  const { limit = MAX_CHART_STARTER_SUGGESTIONS, canSum = () => true } =
    options;
  if (rowCount === 0 || analysis.length > MAX_CHART_STARTER_COLUMNS) return [];
  const columns = usableColumns(fields, analysis);
  const queues = RULE_ORDER.map((rule) => candidatesFor(rule, columns, canSum));
  const picked: ChartStarterSuggestion[] = [];
  const take = (queue: ChartStarterSuggestion[], index: number) => {
    const [suggestion] = queue.splice(index, 1);
    if (suggestion) picked.push(suggestion);
  };

  for (const queue of queues) {
    if (picked.length >= limit) break;
    const usedGroups = new Set(picked.map((pick) => pick.group.id));
    const fresh = queue.findIndex(
      (candidate) => !usedGroups.has(candidate.group.id),
    );
    take(queue, fresh === -1 ? 0 : fresh);
  }
  while (picked.length < limit && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      if (picked.length >= limit) break;
      take(queue, 0);
    }
  }
  return picked;
}
