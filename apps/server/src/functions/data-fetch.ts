/** Closed server-side contract for materialized live Insight fetches. */
import { schema } from "@dashframe/server-core";
import type {
  Insight,
  InsightFetchDefinition,
  InsightFetchResult,
  InsightRuntimeInput,
  UUID,
} from "@dashframe/types";
import { eq, jsonb, uuid } from "@wystack/db";
import { z } from "zod";

import type { DashframeFunctionContext } from "../app-context";
import { permissions } from "../permissions";
import { wy } from "../wystack";
import type { MaterializationTarget } from "./data-fetch/materializer";
import { staleFrameMetadata } from "./data-fetch/publisher";
import { decodeInsight, type InsightRow } from "./insights";

type EffectiveInsightDefinition = InsightFetchDefinition & { limit?: number };

const RUNTIME_FAILURE_CODES = new Set([
  "RUNTIME_FILTER_NOT_DECLARED",
  "RUNTIME_FILTER_KEY_DUPLICATE",
  "RUNTIME_FILTER_DECLARATION_INVALID",
  "RUNTIME_FILTER_REQUIRED",
  "RUNTIME_FILTER_CLEAR_NOT_ALLOWED",
  "RUNTIME_SORT_NOT_DECLARED",
  "RUNTIME_SORT_MAX_KEYS",
  "RUNTIME_SORT_FIELD_NOT_ALLOWED",
  "RUNTIME_LIMIT_OUT_OF_RANGE",
]);

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
    sorts: z
      .array(
        z.object({ field: z.string(), direction: z.enum(["asc", "desc"]) }),
      )
      .optional(),
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
    filters: z.record(z.string(), z.unknown()).optional(),
    sort: z
      .array(
        z.object({ fieldId: z.string(), direction: z.enum(["asc", "desc"]) }),
      )
      .max(1)
      .optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

/** Server-owned connector selection identity; never supplied by a caller. */
export type ConnectorBinding = Readonly<{
  connectorKind: string;
  sourceBindingVersion: string;
}>;

/** Implementations must atomically persist a new immutable DataFrame before ready. */
export type LiveFetchExecutor = (args: {
  context: DashframeFunctionContext;
  insight: EffectiveInsightDefinition;
  binding: ConnectorBinding;
  target: MaterializationTarget;
}) => Promise<InsightFetchResult>;

export function applyInsightRuntime(
  saved: Insight,
  runtime: InsightRuntimeInput | undefined,
): EffectiveInsightDefinition {
  const definition: EffectiveInsightDefinition = {
    baseTableId: saved.baseTableId,
    selectedFields: saved.selectedFields,
    metrics: saved.metrics,
    filters: saved.filters,
    sorts: saved.sorts,
    joins: saved.joins,
  };
  const declared = saved.runtimeControls;
  const values = runtime?.filters ?? {};
  const declaredFilters = declared?.filters ?? [];
  const controls = new Map<string, (typeof declaredFilters)[number]>();
  const targetFilterIds = new Set<string>();
  const savedFilterIds = new Map<string, number>();
  for (const filter of saved.filters ?? []) {
    if (filter.id)
      savedFilterIds.set(filter.id, (savedFilterIds.get(filter.id) ?? 0) + 1);
  }
  for (const control of declaredFilters) {
    if (controls.has(control.key))
      throw new Error("RUNTIME_FILTER_KEY_DUPLICATE");
    if (targetFilterIds.has(control.filterId))
      throw new Error("RUNTIME_FILTER_DECLARATION_INVALID");
    if (savedFilterIds.get(control.filterId) !== 1)
      throw new Error("RUNTIME_FILTER_DECLARATION_INVALID");
    controls.set(control.key, control);
    targetFilterIds.add(control.filterId);
  }
  for (const key of Object.keys(values)) {
    if (!controls.has(key)) throw new Error("RUNTIME_FILTER_NOT_DECLARED");
  }
  for (const control of controls.values()) {
    const hasValue = Object.hasOwn(values, control.key);
    const value = values[control.key];
    if (control.required && (!hasValue || value === null))
      throw new Error("RUNTIME_FILTER_REQUIRED");
    if (!hasValue) continue;
    const filter = (saved.filters ?? []).find(
      (candidate) => candidate.id === control.filterId,
    );
    if (!filter) throw new Error("RUNTIME_FILTER_DECLARATION_INVALID");
    if (value === null) {
      if (!control.allowClear)
        throw new Error("RUNTIME_FILTER_CLEAR_NOT_ALLOWED");
      definition.filters = definition.filters?.filter(
        (candidate) => candidate.id !== control.filterId,
      );
    } else {
      definition.filters = definition.filters?.map((candidate) =>
        candidate.id === control.filterId ? { ...candidate, value } : candidate,
      );
    }
  }
  if (runtime?.sort) {
    const sortControl = declared?.sort;
    if (!sortControl) throw new Error("RUNTIME_SORT_NOT_DECLARED");
    if (
      sortControl.maxKeys < 1 ||
      sortControl.maxKeys > 1 ||
      runtime.sort.length > sortControl.maxKeys
    )
      throw new Error("RUNTIME_SORT_MAX_KEYS");
    if (
      runtime.sort.some(
        (sort) => !sortControl.allowedFieldIds.includes(sort.fieldId),
      )
    )
      throw new Error("RUNTIME_SORT_FIELD_NOT_ALLOWED");
    definition.sorts = runtime.sort.map((sort) => ({
      field: sort.fieldId,
      direction: sort.direction,
    }));
  }
  if (runtime?.limit !== undefined) {
    const limit = declared?.limit;
    if (!limit || runtime.limit < limit.min || runtime.limit > limit.max)
      throw new Error("RUNTIME_LIMIT_OUT_OF_RANGE");
    definition.limit = runtime.limit;
  }
  return definition;
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

export function toFetchFailure(
  error: unknown,
  fallback: string,
): InsightFetchResult {
  const sourceCode = error instanceof Error ? error.message : "";
  const code =
    RUNTIME_FAILURE_CODES.has(sourceCode) ||
    sourceCode === "SOURCE_SCHEMA_CHANGED" ||
    sourceCode === "TARGET_NOT_READY"
      ? sourceCode
      : fallback;
  if (code === "SOURCE_SCHEMA_CHANGED")
    return failed(
      code,
      "The source schema changed and the Insight needs review.",
    );
  if (code === "TARGET_NOT_READY")
    return failed(code, "The requested data target is not ready yet.", true);
  return failed(
    code,
    code.startsWith("RUNTIME_")
      ? "The requested Insight runtime controls are invalid."
      : "Live data could not be fetched.",
    fallback === "FETCH_EXECUTION_FAILED",
  );
}

/**
 * Host-only factory, deliberately not registered until a real executor exists.
 * Both routes are closed: validation, saved-definition, binding, compilation,
 * and connector errors all return a safe failed result rather than an RPC error.
 */
export function createDataFetchFunctions(
  resolveBinding: (
    ctx: DashframeFunctionContext,
    baseTableId: UUID,
  ) => Promise<ConnectorBinding>,
  execute: LiveFetchExecutor,
) {
  const materialize = async (
    ctx: DashframeFunctionContext,
    insight: EffectiveInsightDefinition,
    target: MaterializationTarget,
  ): Promise<InsightFetchResult> => {
    let binding: ConnectorBinding;
    try {
      binding = await resolveBinding(ctx, insight.baseTableId);
    } catch (error) {
      return toFetchFailure(error, "FETCH_BINDING_FAILED");
    }
    try {
      return await execute({ context: ctx, insight, binding, target });
    } catch (error) {
      return toFetchFailure(error, "FETCH_EXECUTION_FAILED");
    }
  };
  const fetchData = wy.procedure
    .input({ insight: jsonb })
    .authorize(permissions.data.fetchData)
    .mutation(async (ctx, { insight }) => {
      const parsed = definitionSchema.safeParse(insight);
      if (!parsed.success)
        return failed(
          "FETCH_INVALID_DEFINITION",
          "The Insight definition is invalid.",
        );
      return materialize(ctx, parsed.data, { kind: "ephemeral" });
    });
  const runInsight = wy.procedure
    .input({ insightId: uuid, runtime: jsonb.optional() })
    .authorize(permissions.insights.runInsight)
    .mutation(async (ctx, { insightId, runtime }) => {
      const parsedRuntime = runtimeSchema.optional().safeParse(runtime);
      if (!parsedRuntime.success)
        return failed(
          "FETCH_INVALID_REQUEST",
          "The requested Insight runtime controls are invalid.",
        );
      try {
        const saved = await getInsightForFetch(ctx, insightId as UUID);
        return materialize(
          ctx,
          applyInsightRuntime(saved, parsedRuntime.data),
          {
            kind: "saved",
            insightId: insightId as UUID,
          },
        );
      } catch (error) {
        const result = toFetchFailure(error, "FETCH_SOURCE_FAILED");
        const prior = await lastSuccessfulForInsight(ctx, insightId as UUID);
        return result.status === "failed" && prior
          ? { ...result, lastSuccessful: prior }
          : result;
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

async function lastSuccessfulForInsight(
  ctx: DashframeFunctionContext,
  insightId: UUID,
) {
  const row = (await ctx.db
    .from(schema.dataFrames)
    .where(eq("insightId", insightId))
    .first()) as
    | {
        id: UUID;
        fieldIds: unknown;
        rowCount: number | null;
        analysis: unknown;
        lastRefreshedAt: Date | null;
      }
    | undefined;
  return row ? staleFrameMetadata(row) : undefined;
}
