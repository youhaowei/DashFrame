import type {
  ConnectorQueryResult,
  DefinitionQueryOptions,
} from "@dashframe/engine";
import type { GrainScope } from "@dashframe/types";
import { createFieldsFromColumns } from "@dashframe/engine";
import {
  Dictionary,
  Float64,
  Int32,
  Table,
  TimestampMillisecond,
  Utf8,
  tableToIPC,
  vectorFromArray,
} from "apache-arrow";

import type { Ga4TableDefinition } from "./definition.js";
import {
  definitionFilters,
  resolveDateRange,
  validateDefinition,
} from "./definition.js";
import type { Ga4ApiClient } from "./metadata.js";
import { propertyResource, scopeFor } from "./metadata.js";

const REPORT_PAGE_SIZE = 250_000;
const DATE_DIMENSIONS = new Set([
  "date",
  "yearWeek",
  "isoYearIsoWeek",
  "yearMonth",
]);

export interface RunReportResponse {
  dimensionHeaders?: Array<{ name?: unknown }>;
  metricHeaders?: Array<{ name?: unknown; type?: unknown }>;
  rows?: Array<{
    dimensionValues?: Array<{ value?: unknown }>;
    metricValues?: Array<{ value?: unknown }>;
  }>;
  rowCount?: unknown;
  propertyQuota?: { tokensPerDay?: { consumed?: unknown } };
}

export function yearWeekStart(value: string): Date | null {
  const match = /^(\d{4})(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) return null;
  const january1 = Date.UTC(year, 0, 1);
  const offsetDays =
    week === 1 ? 0 : 7 - new Date(january1).getUTCDay() + 7 * (week - 2);
  const start = new Date(january1 + offsetDays * 86_400_000);
  return start.getUTCFullYear() === year ? start : null;
}

export function isoYearIsoWeekStart(value: string): Date | null {
  const match = /^(\d{4})(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) return null;
  const january4 = new Date(Date.UTC(year, 0, 4));
  const mondayOffset = (january4.getUTCDay() + 6) % 7;
  const start = new Date(
    january4.getTime() + (7 * (week - 1) - mondayOffset) * 86_400_000,
  );
  const thursday = new Date(start.getTime() + 3 * 86_400_000);
  return thursday.getUTCFullYear() === year ? start : null;
}

export function dimensionValue(
  name: string,
  value: unknown,
): string | Date | null {
  if (typeof value !== "string") return null;
  if (name === "yearWeek") return yearWeekStart(value);
  if (name === "isoYearIsoWeek") return isoYearIsoWeekStart(value);
  if (name === "yearMonth") {
    if (!/^\d{6}$/u.test(value)) return null;
    const date = new Date(
      `${value.slice(0, 4)}-${value.slice(4, 6)}-01T00:00:00.000Z`,
    );
    return Number.isNaN(date.getTime()) ||
      date.getUTCMonth() + 1 !== Number(value.slice(4, 6))
      ? null
      : date;
  }
  if (name !== "date") return value;
  if (!/^\d{8}$/u.test(value)) return null;
  const date = new Date(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`,
  );
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10).replaceAll("-", "") !== value
    ? null
    : date;
}

export function reportBody(
  definition: Ga4TableDefinition,
  offset: number,
  now: number,
  limit = REPORT_PAGE_SIZE,
  options: {
    timeZone?: string;
    legacyDateRange?: "30daysAgo" | "90daysAgo";
  } = {},
): Record<string, unknown> {
  const legacyDateRange = options.legacyDateRange;
  return {
    dateRanges: [
      legacyDateRange
        ? { startDate: legacyDateRange, endDate: "yesterday" }
        : resolveDateRange(definition.dateRange, now, options.timeZone),
    ],
    dimensions: definition.dimensions.map((name) => ({ name })),
    metrics: definition.metrics.map((name) => ({ name })),
    offset: String(offset),
    limit: String(limit),
    orderBys: definition.dimensions.map((dimensionName) => ({
      dimension: { dimensionName },
    })),
    ...(legacyDateRange
      ? {}
      : {
          returnPropertyQuota: true,
          keepEmptyRows: false,
          ...definitionFilters(definition),
        }),
  };
}

function headerNames(
  headers: Array<{ name?: unknown }> | undefined,
  fallback: string,
): string[] {
  return (headers ?? []).map((header) =>
    typeof header.name === "string" ? header.name : fallback,
  );
}

function assertSameHeaders(
  expected: readonly string[],
  actual: readonly string[],
): void {
  if (
    expected.length !== actual.length ||
    expected.some((name, index) => name !== actual[index])
  ) {
    throw new Error("[GA4Connector] Report schema changed between pages");
  }
}

export interface RunDefinitionOptions extends DefinitionQueryOptions {
  now?: number;
  /** Reporting zone returned by the GA4 Admin API for relative definitions. */
  timeZone?: string;
  labels?: Readonly<Record<string, string>>;
  /** Legacy query callers own pagination; definition queries page internally. */
  page?: { offset: number; limit: number; single: true };
  /** The historical v2 report uses GA4's Sunday `yearWeek`, not the new ISO grain. */
  allowLegacyYearWeek?: boolean;
  /** Preserves the historical provider-relative v1/v2 request body. */
  legacyDateRange?: "30daysAgo" | "90daysAgo";
}

interface ReportPages {
  dimensions: string[];
  metrics: string[];
  rows: NonNullable<RunReportResponse["rows"]>;
}

function stableHeaders(
  current: string[] | undefined,
  page: string[],
): string[] {
  if (current) assertSameHeaders(current, page);
  return current ?? page;
}

function totalRowsIn(response: RunReportResponse): number | undefined {
  if (response.rowCount === undefined) return undefined;
  if (
    typeof response.rowCount !== "number" ||
    !Number.isSafeInteger(response.rowCount) ||
    response.rowCount < 0
  ) {
    throw new Error("[GA4Connector] Invalid report rowCount");
  }
  return response.rowCount;
}

function enforceRowLimit(totalRows: number, maxRows: number | undefined): void {
  if (maxRows !== undefined && totalRows > maxRows)
    throw new Error("SOURCE_RESULT_TOO_LARGE");
}

function reconcileReportedTotal(
  response: RunReportResponse,
  previous: number | undefined,
): number | undefined {
  const current = totalRowsIn(response);
  if (current !== undefined && previous !== undefined && current !== previous) {
    throw new Error("[GA4Connector] Report rowCount changed between pages");
  }
  return current ?? previous;
}

function shouldStopPaging(
  singlePage: boolean,
  pageRows: number,
  pageSize: number,
  nextOffset: number,
  totalRows: number | undefined,
): boolean {
  if (singlePage) return true;
  return totalRows === undefined
    ? pageRows < pageSize
    : nextOffset >= totalRows;
}

function assertCompleteReport(
  singlePage: boolean,
  received: number,
  totalRows: number | undefined,
): void {
  if (!singlePage && totalRows !== undefined && received !== totalRows) {
    throw new Error(
      `[GA4Connector] Expected ${totalRows} report rows but received ${received}`,
    );
  }
}

function initialResponseBudget(
  maxResponseBytes: number | undefined,
): number | undefined {
  if (maxResponseBytes === undefined) return undefined;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new Error("[GA4Connector] Invalid response budget");
  }
  return maxResponseBytes;
}

function consumeResponseBudget(
  remaining: number | undefined,
  byteLength: number,
): number | undefined {
  if (remaining === undefined) return undefined;
  if (byteLength > remaining) throw new Error("SOURCE_RESULT_TOO_LARGE");
  return remaining - byteLength;
}

function logQuota(response: RunReportResponse): void {
  const consumed = response.propertyQuota?.tokensPerDay?.consumed;
  if (typeof consumed !== "number") return;
  // oxlint-disable-next-line no-console -- GA4 quota consumption is required operator debug telemetry
  console.debug("[GA4Connector] property quota", {
    tokensPerDayConsumed: consumed,
  });
}

function assertResponseMeasurement(
  client: Ga4ApiClient,
  maxResponseBytes: number | undefined,
): void {
  if (maxResponseBytes !== undefined && !client.requestMeasured) {
    throw new Error(
      "[GA4Connector] Response byte budget requires transport measurement",
    );
  }
}

async function fetchReportPages(
  property: string,
  definition: Ga4TableDefinition,
  client: Ga4ApiClient,
  options: RunDefinitionOptions,
  now: number,
): Promise<ReportPages> {
  assertResponseMeasurement(client, options.maxResponseBytes);
  const pageSize = options.page?.limit ?? REPORT_PAGE_SIZE;
  let offset = options.page?.offset ?? 0;
  let dimensionNames: string[] | undefined;
  let metricNames: string[] | undefined;
  let remainingResponseBytes = initialResponseBudget(options.maxResponseBytes);
  let reportedTotalRows: number | undefined;
  const rows: NonNullable<RunReportResponse["rows"]> = [];
  for (;;) {
    const url = `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`;
    const init = {
      method: "POST",
      signal: options.signal,
      body: JSON.stringify(
        reportBody(definition, offset, now, pageSize, {
          timeZone: options.timeZone,
          legacyDateRange: options.legacyDateRange,
        }),
      ),
    } satisfies RequestInit;
    const measured =
      remainingResponseBytes !== undefined && client.requestMeasured
        ? await client.requestMeasured(url, init, remainingResponseBytes)
        : undefined;
    const response = (measured?.body ??
      (await client.request(url, init))) as RunReportResponse;
    if (measured) {
      remainingResponseBytes = consumeResponseBudget(
        remainingResponseBytes,
        measured.byteLength,
      );
    }
    const pageDimensions = headerNames(response.dimensionHeaders, "dimension");
    const pageMetrics = headerNames(response.metricHeaders, "metric");
    dimensionNames = stableHeaders(dimensionNames, pageDimensions);
    metricNames = stableHeaders(metricNames, pageMetrics);
    const pageRows = response.rows ?? [];
    for (const row of pageRows) rows.push(row);
    reportedTotalRows = reconcileReportedTotal(response, reportedTotalRows);
    enforceRowLimit(
      options.page?.single ? rows.length : (reportedTotalRows ?? rows.length),
      options.maxRows,
    );
    logQuota(response);
    offset += pageSize;
    if (
      shouldStopPaging(
        options.page?.single === true,
        pageRows.length,
        pageSize,
        offset,
        reportedTotalRows,
      )
    )
      break;
    if (remainingResponseBytes === 0) {
      throw new Error("SOURCE_RESULT_TOO_LARGE");
    }
  }
  assertCompleteReport(
    options.page?.single === true,
    rows.length,
    reportedTotalRows,
  );
  return {
    dimensions: dimensionNames ?? definition.dimensions,
    metrics: metricNames ?? definition.metrics,
    rows,
  };
}

function arrowTable(
  dimensions: readonly string[],
  metrics: readonly string[],
  arrays: Readonly<Record<string, unknown[]>>,
): Table {
  return new Table(
    Object.fromEntries([
      ...dimensions.map((name) => [
        name,
        vectorFromArray(
          arrays[name] ?? [],
          DATE_DIMENSIONS.has(name)
            ? new TimestampMillisecond()
            : new Dictionary(new Utf8(), new Int32()),
        ),
      ]),
      ...metrics.map((name) => [
        name,
        vectorFromArray(arrays[name] ?? [], new Float64()),
      ]),
    ]),
  );
}

function validateReportDefinition(
  definition: Ga4TableDefinition,
  allowLegacyYearWeek: boolean | undefined,
): void {
  const validation = validateDefinition(definition, { allowLegacyYearWeek });
  if (!validation.valid) {
    throw new Error(
      `[GA4Connector] Invalid definition: ${validation.errors.join("; ")}`,
    );
  }
}

export async function runReport(
  site: string,
  definition: Ga4TableDefinition,
  client: Ga4ApiClient,
  options: RunDefinitionOptions,
): Promise<ConnectorQueryResult> {
  validateReportDefinition(definition, options.allowLegacyYearWeek);
  options.signal?.throwIfAborted();
  const property = propertyResource(site);
  const now = options.now ?? Date.now();
  const { dimensions, metrics, rows } = await fetchReportPages(
    property,
    definition,
    client,
    options,
    now,
  );
  const columns = [
    ...dimensions.map((name) => ({
      name,
      type: DATE_DIMENSIONS.has(name) ? ("date" as const) : ("string" as const),
    })),
    ...metrics.map((name) => ({ name, type: "number" as const })),
  ];
  const fields = createFieldsFromColumns(columns, options.tableId).map(
    (field) => {
      const columnName = field.columnName ?? field.name;
      const scope: GrainScope | undefined = dimensions.includes(columnName)
        ? scopeFor(columnName)
        : undefined;
      return {
        ...field,
        name: options.labels?.[columnName] ?? field.name,
        ...(scope ? { scope } : {}),
      };
    },
  );
  const arrays = Object.create(null) as Record<string, unknown[]>;
  for (const name of dimensions) arrays[name] = [];
  for (const name of metrics) arrays[name] = [];
  for (const row of rows) {
    dimensions.forEach((name, index) => {
      arrays[name]!.push(
        dimensionValue(name, row.dimensionValues?.[index]?.value),
      );
    });
    metrics.forEach((name, index) => {
      const value = row.metricValues?.[index]?.value;
      const numeric = typeof value === "string" ? Number(value) : NaN;
      arrays[name]!.push(Number.isFinite(numeric) ? numeric : null);
    });
  }
  const arrow = arrowTable(dimensions, metrics, arrays);
  return {
    arrowBuffer: Buffer.from(tableToIPC(arrow)).toString("base64"),
    fieldIds: fields.map((field) => field.id),
    fields,
    rowCount: rows.length,
  };
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgoRange(
  days: number,
  now: number,
): Ga4TableDefinition["dateRange"] {
  // This valid absolute placeholder is never serialized: legacy requests use
  // their original provider-relative tokens through `legacyDateRange`.
  const current = new Date(now);
  const end = new Date(
    Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth(),
      current.getUTCDate() - 1,
    ),
  );
  const start = new Date(
    Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth(),
      current.getUTCDate() - days,
    ),
  );
  return { kind: "absolute", start: day(start), end: day(end) };
}

export function legacyDefinition(
  version: "v1" | "v2",
  now: number,
): Ga4TableDefinition {
  return version === "v1"
    ? {
        dimensions: ["date"],
        metrics: ["activeUsers"],
        dateRange: daysAgoRange(30, now),
        grain: "day",
      }
    : {
        dimensions: ["yearWeek", "sessionDefaultChannelGroup"],
        metrics: [
          "activeUsers",
          "newUsers",
          "sessions",
          "engagedSessions",
          "engagementRate",
          "keyEvents",
          "totalRevenue",
        ],
        dateRange: daysAgoRange(90, now),
        grain: "week",
      };
}
