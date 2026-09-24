import type { TableDefinition } from "@dashframe/engine";

import { METRIC_RATIO_EXPRESSIONS, scopeFor } from "./metadata.js";

export type Ga4Grain = "day" | "week" | "month";

export type Ga4DateRange =
  | { kind: "relative"; months: number }
  | { kind: "absolute"; start: string; end: string };

export type Ga4DefinitionFilter = NonNullable<
  TableDefinition["filters"]
>[number];

export interface Ga4TableDefinition extends TableDefinition {
  dateRange: Ga4DateRange;
  grain: Ga4Grain;
}

export interface DefinitionValidation {
  valid: boolean;
  errors: string[];
}

export interface DefinitionValidationOptions {
  allowLegacyYearWeek?: boolean;
}

export interface ResolvedGa4DateRange {
  startDate: string;
  endDate: string;
}

function filterExpression(
  filters: readonly Ga4DefinitionFilter[],
  metric: boolean,
): unknown {
  const selected: unknown[] = [];
  for (const filter of filters) {
    const isMetric = filter.kind === "metric";
    if (isMetric !== metric) continue;
    if (filter.operator === "greaterThan") {
      selected.push({
        filter: {
          fieldName: filter.field,
          numericFilter: {
            operation: "GREATER_THAN",
            value: { doubleValue: filter.value },
          },
        },
      });
      continue;
    }
    selected.push({
      filter: {
        fieldName: filter.field,
        ...(filter.operator === "exact"
          ? {
              stringFilter: {
                matchType: "EXACT",
                value: filter.values[0] ?? "",
                caseSensitive: true,
              },
            }
          : { inListFilter: { values: filter.values, caseSensitive: true } }),
      },
    });
  }
  if (selected.length === 0) return undefined;
  return selected.length === 1
    ? selected[0]
    : { andGroup: { expressions: selected } };
}

/** Filter clauses shared by runReport and checkCompatibility requests. */
export function definitionFilters(definition: Ga4TableDefinition): {
  dimensionFilter?: unknown;
  metricFilter?: unknown;
} {
  const filters = definition.filters ?? [];
  const dimensionFilter = filterExpression(filters, false);
  const metricFilter = filterExpression(filters, true);
  return {
    ...(dimensionFilter ? { dimensionFilter } : {}),
    ...(metricFilter ? { metricFilter } : {}),
  };
}

const DATE_DIMENSION_FOR_GRAIN: Readonly<Record<Ga4Grain, string>> = {
  day: "date",
  week: "isoYearIsoWeek",
  month: "yearMonth",
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validateDateRange(range: unknown): string[] {
  if (range === null || typeof range !== "object") {
    return ["A date range is required"];
  }
  const candidate = range as {
    kind?: unknown;
    months?: unknown;
    start?: unknown;
    end?: unknown;
  };
  if (candidate.kind !== "relative" && candidate.kind !== "absolute") {
    return ["Date range kind must be relative or absolute"];
  }
  if (candidate.kind === "relative") {
    return Number.isSafeInteger(candidate.months) &&
      (candidate.months as number) > 0
      ? []
      : ["Relative months must be a positive integer"];
  }
  const errors: string[] = [];
  const validStart =
    typeof candidate.start === "string" && isIsoDate(candidate.start);
  const validEnd =
    typeof candidate.end === "string" && isIsoDate(candidate.end);
  if (!validStart) errors.push("Absolute start must be an ISO date");
  if (!validEnd) errors.push("Absolute end must be an ISO date");
  if (
    validStart &&
    validEnd &&
    (candidate.start as string) > (candidate.end as string)
  )
    errors.push("Absolute start must not be after end");
  return errors;
}

function filterKindErrors(filter: Ga4DefinitionFilter): string[] {
  const raw = filter as { kind?: unknown; operator?: unknown };
  if (raw.kind !== "dimension" && raw.kind !== "metric") {
    return [`Filter ${filter.field} must declare its field kind`];
  }
  const validOperator =
    raw.kind === "dimension"
      ? raw.operator === "exact" || raw.operator === "inList"
      : raw.operator === "greaterThan";
  return validOperator
    ? []
    : [`${raw.kind} filter ${filter.field} has an invalid operator`];
}

function validateFilter(
  filter: Ga4DefinitionFilter,
  definition: Ga4TableDefinition,
): string[] {
  if (filter === null || typeof filter !== "object") {
    return ["Filter must be an object"];
  }
  const errors = filterKindErrors(filter);
  const dimensions = Array.isArray(definition.dimensions)
    ? definition.dimensions
    : [];
  const metrics = Array.isArray(definition.metrics) ? definition.metrics : [];
  const selectedAsDimension = dimensions.includes(filter.field);
  const selectedAsMetric = metrics.includes(filter.field);
  if (filter.kind === "metric" && selectedAsDimension) {
    errors.push(`Dimension ${filter.field} cannot use a metric filter`);
  }
  if (filter.kind === "dimension" && selectedAsMetric) {
    errors.push(`Metric ${filter.field} cannot use a dimension filter`);
  }
  if (filter.operator === "greaterThan" && !Number.isFinite(filter.value)) {
    errors.push(`greaterThan filter ${filter.field} must have a finite value`);
  }
  if (
    filter.operator !== "greaterThan" &&
    (!Array.isArray(filter.values) ||
      filter.values.length === 0 ||
      (filter.operator === "exact" && filter.values.length !== 1))
  ) {
    errors.push(`${filter.operator} filter ${filter.field} has invalid values`);
  }
  return errors;
}

function validateFilters(definition: Ga4TableDefinition): string[] {
  if (definition.filters !== undefined && !Array.isArray(definition.filters)) {
    return ["Filters must be an array"];
  }
  return (definition.filters ?? []).flatMap((filter) =>
    validateFilter(filter, definition),
  );
}

const EVENT_LEVEL_REVENUE_METRICS = new Set([
  "transactions",
  "purchaseRevenue",
  "totalRevenue",
]);

function metricRefs(metric: string): string[] {
  const expression = METRIC_RATIO_EXPRESSIONS[metric];
  if (!expression) return [];
  const numerator = expression.numerator;
  return [
    ...(typeof numerator === "string"
      ? [numerator]
      : [numerator.left, numerator.right]),
    expression.denominator,
  ];
}

function fieldShapeErrors(
  definition: Ga4TableDefinition,
  dimensions: readonly string[],
  metrics: readonly string[],
  options: DefinitionValidationOptions,
): string[] {
  const errors: string[] = [];
  if (!Array.isArray(definition?.dimensions))
    errors.push("Dimensions must be an array");
  if (dimensions.length === 0)
    errors.push("At least one dimension is required");
  if (dimensions.length > 9) errors.push("GA4 allows at most 9 dimensions");
  if (!Array.isArray(definition?.metrics))
    errors.push("Metrics must be an array");
  if (metrics.length === 0) errors.push("At least one metric is required");
  if (metrics.length > 10) errors.push("GA4 allows at most 10 metrics");
  const expectedDate = DATE_DIMENSION_FOR_GRAIN[definition.grain];
  const legacyYearWeek =
    options.allowLegacyYearWeek &&
    definition.grain === "week" &&
    dimensions[0] === "yearWeek";
  if (dimensions[0] !== expectedDate && !legacyYearWeek) {
    errors.push(
      `The first dimension for ${definition.grain} grain must be ${expectedDate}`,
    );
  }
  return errors;
}

function duplicateFieldErrors(
  dimensions: readonly string[],
  metrics: readonly string[],
): string[] {
  const fields = [...dimensions, ...metrics];
  const duplicates = fields.filter(
    (field, index) => fields.indexOf(field) !== index,
  );
  return duplicates.length > 0
    ? [`Duplicate fields: ${[...new Set(duplicates)].join(", ")}`]
    : [];
}

function incompatibleScopeErrors(
  dimensions: readonly string[],
  metrics: readonly string[],
): string[] {
  const itemDimensions = dimensions.filter(
    (dimension) => scopeFor(dimension) === "item",
  );
  const eventRevenue = metrics.filter((metric) =>
    EVENT_LEVEL_REVENUE_METRICS.has(metric),
  );
  return itemDimensions.length > 0 && eventRevenue.length > 0
    ? [
        `Event-level revenue metrics ${eventRevenue.join(", ")} cannot be combined with item-scoped dimensions ${itemDimensions.join(", ")}`,
      ]
    : [];
}

function ratioDependencyErrors(metrics: readonly string[]): string[] {
  return metrics.flatMap((metric) => {
    const missing = metricRefs(metric).filter(
      (dependency) => !metrics.includes(dependency),
    );
    return missing.length > 0
      ? [
          `Ratio metric ${metric} requires metrics: ${[...new Set(missing)].join(", ")}`,
        ]
      : [];
  });
}

export function validateDefinition(
  definition: Ga4TableDefinition,
  options: DefinitionValidationOptions = {},
): DefinitionValidation {
  const errors: string[] = [];
  const dimensions = Array.isArray(definition?.dimensions)
    ? definition.dimensions
    : [];
  const metrics = Array.isArray(definition?.metrics) ? definition.metrics : [];
  errors.push(...fieldShapeErrors(definition, dimensions, metrics, options));
  errors.push(...duplicateFieldErrors(dimensions, metrics));
  errors.push(...validateDateRange(definition.dateRange));
  errors.push(...incompatibleScopeErrors(dimensions, metrics));
  errors.push(...ratioDependencyErrors(metrics));
  errors.push(...validateFilters(definition));
  return { valid: errors.length === 0, errors };
}

export function resolveDateRange(
  range: Ga4DateRange,
  now: number = Date.now(),
  timeZone = "UTC",
): ResolvedGa4DateRange {
  if (range.kind === "absolute") {
    return { startDate: range.start, endDate: range.end };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(now));
  const numberPart = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  const start = new Date(
    Date.UTC(numberPart("year"), numberPart("month") - 1 - range.months, 1),
  );
  return {
    startDate: start.toISOString().slice(0, 10),
    // GA4 resolves this provider-relative token using the site's reporting zone.
    endDate: "yesterday",
  };
}
