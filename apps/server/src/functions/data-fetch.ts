/**
 * Public live-data fetch contract.
 *
 * This module intentionally accepts only DashFrame's typed Insight shape. It
 * has no provider id, credential, Field object, or SQL escape hatch. Connector
 * selection remains a server concern behind a versioned binding registry.
 */
import { schema } from "@dashframe/server-core";
import type {
  Insight,
  InsightFetchDefinition,
  InsightFetchResult,
  InsightRuntimeControls,
  InsightSort,
  UUID,
} from "@dashframe/types";
import { eq, jsonb, uuid } from "@wystack/db";
import { z } from "zod";

import type { DashframeFunctionContext } from "../app-context";
import { wy } from "../wystack";
import { decodeInsight, type InsightRow } from "./insights";

const MAX_LIMIT = 10_000;

const filterSchema = z.object({
  id: z.string().optional(),
  field: z.string().min(1),
  operator: z.enum([
    "eq",
    "ne",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "in",
    "between",
  ]),
  value: z.unknown(),
  allowClear: z.boolean().optional(),
});
const sortSchema = z.object({
  field: z.string().min(1),
  direction: z.enum(["asc", "desc"]),
});
const definitionSchema = z
  .object({
    baseTableId: z.string().min(1),
    selectedFields: z.array(z.string().min(1)),
    metrics: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        sourceTable: z.string(),
        columnName: z.string().optional(),
        aggregation: z.enum([
          "sum",
          "avg",
          "count",
          "min",
          "max",
          "count_distinct",
        ]),
      }),
    ),
    filters: z.array(filterSchema).optional(),
    sorts: z.array(sortSchema).optional(),
    joins: z
      .array(
        z.object({
          type: z.enum(["inner", "left", "right", "full"]),
          rightTableId: z.string(),
          leftKey: z.string(),
          rightKey: z.string(),
        }),
      )
      .optional(),
  })
  .strict();
const runtimeSchema = z
  .object({
    filterValues: z.record(z.string(), z.unknown()).optional(),
    clearFilterIds: z.array(z.string()).optional(),
    sort: sortSchema.optional(),
    limit: z.number().int().positive().max(MAX_LIMIT).optional(),
  })
  .strict();

export type ConnectorBinding = Readonly<{
  connectorKind: string;
  bindingVersion: string;
}>;

/** Server-only executor seam. Credentials and provider clients never cross it. */
export type LiveFetchExecutor = (args: {
  context: DashframeFunctionContext;
  insight: InsightFetchDefinition;
  binding: ConnectorBinding;
}) => Promise<InsightFetchResult>;

/**
 * Validates and applies the narrowly declared runtime surface before any
 * connector work. It is exported for executor implementations and focused
 * tests; the returned definition remains free of provider concerns.
 */
export function applyInsightRuntime(
  insight: InsightFetchDefinition,
  runtime: InsightRuntimeControls | undefined,
): InsightFetchDefinition {
  if (!runtime) return insight;
  const values = runtime.filterValues ?? {};
  const clear = new Set(runtime.clearFilterIds ?? []);
  const declared = new Map(
    (insight.filters ?? []).map((filter) => [filter.id, filter]),
  );
  for (const id of [...Object.keys(values), ...clear]) {
    const filter = declared.get(id);
    if (!id || !filter) throw new Error("RUNTIME_FILTER_NOT_DECLARED");
    if (clear.has(id) && !filter.allowClear)
      throw new Error("RUNTIME_FILTER_CLEAR_NOT_ALLOWED");
  }
  const filters = (insight.filters ?? []).flatMap((filter) => {
    if (filter.id && clear.has(filter.id)) return [];
    return [
      {
        ...filter,
        ...(filter.id && filter.id in values
          ? { value: values[filter.id] }
          : {}),
      },
    ];
  });
  if (runtime.sort) {
    const allowed = insight.sorts ?? [];
    if (!allowed.some((sort) => sameSortKey(sort, runtime.sort!))) {
      throw new Error("RUNTIME_SORT_NOT_DECLARED");
    }
  }
  return {
    ...insight,
    filters: filters.length ? filters : undefined,
    sorts: runtime.sort ? [runtime.sort] : insight.sorts,
  };
}

function sameSortKey(a: InsightSort, b: InsightSort): boolean {
  return a.field === b.field && a.direction === b.direction;
}

function failed(
  code: string,
  message: string,
  retryable = false,
): InsightFetchResult {
  return {
    status: "failed",
    code,
    message,
    retryable,
    diagnosticId: crypto.randomUUID(),
  };
}

/**
 * The registry is intentionally binding-only. A caller picks neither a
 * connector nor a credential; a host wires a binding to a connector-local
 * executor. There is no generic RPC retry because re-running an arbitrary
 * fetch can duplicate provider-side effects.
 */
export function createDataFetchFunctions(
  resolveBinding: (
    ctx: DashframeFunctionContext,
    baseTableId: UUID,
  ) => Promise<ConnectorBinding>,
  execute: LiveFetchExecutor,
) {
  const fetchData = wy.procedure
    .input({ insight: jsonb })
    .mutation(async (ctx, { insight }) => {
      const parsed = definitionSchema.safeParse(insight);
      if (!parsed.success) {
        return failed(
          "FETCH_INVALID_DEFINITION",
          "The Insight definition is invalid.",
        );
      }
      const binding = await resolveBinding(
        ctx,
        parsed.data.baseTableId as UUID,
      );
      return execute({ context: ctx, insight: parsed.data, binding });
    });
  const runInsight = wy.procedure
    .input({ insightId: uuid, runtime: jsonb.optional() })
    .mutation(async (ctx, { insightId, runtime }) => {
      // Canonical saved definition is read server-side. Runtime validation happens
      // before binding resolution/execution, so invalid edits never reach a source.
      const parsedRuntime = runtimeSchema.safeParse(runtime);
      if (!parsedRuntime.success) {
        return failed(
          "FETCH_INVALID_REQUEST",
          "The requested Insight runtime controls are invalid.",
        );
      }
      const saved = await getInsightForFetch(ctx, insightId as UUID);
      try {
        const insight = applyInsightRuntime(saved, parsedRuntime.data);
        const binding = await resolveBinding(ctx, insight.baseTableId);
        return execute({ context: ctx, insight, binding });
      } catch (error) {
        const code =
          error instanceof Error && error.message.startsWith("RUNTIME_")
            ? error.message
            : "FETCH_INVALID_REQUEST";
        return failed(
          code,
          "The requested Insight runtime controls are invalid.",
        );
      }
    });
  return { fetchData, runInsight };
}

async function getInsightForFetch(
  ctx: DashframeFunctionContext,
  insightId: UUID,
): Promise<Insight> {
  const row = (await ctx.db
    .from(schema.insights)
    .where(eq("id", insightId))
    .first()) as InsightRow | undefined;
  if (!row) throw new Error("INSIGHT_NOT_FOUND");
  return decodeInsight(row);
}

/** Placeholder registration keeps the public contract closed until host wiring lands. */
export const dataFetchFunctions = createDataFetchFunctions(
  async () => ({ connectorKind: "unconfigured", bindingVersion: "0" }),
  async () =>
    failed(
      "FETCH_PIPELINE_UNAVAILABLE",
      "Live data fetching is not configured.",
      true,
    ),
);
