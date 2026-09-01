import { z } from "zod";
import type { Dashboard } from "@dashframe/types";
const insightFilterOverrideSchema = z
  .object({
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
    cleared: z.boolean().optional(),
  })
  .passthrough();

const insightSortSchema = z
  .object({
    field: z.string().min(1),
    direction: z.enum(["asc", "desc"]),
  })
  .passthrough();

const storedDashboardItemOverridesSchema = z
  .object({
    filters: z.array(insightFilterOverrideSchema).optional(),
    sorts: z.array(insightSortSchema).optional(),
    limit: z.number().finite().positive().optional(),
  })
  .passthrough();

const storedDashboardItemSchema = z
  .object({
    id: z.string(),
    type: z.enum(["visualization", "markdown"]),
    visualizationId: z.string().optional(),
    content: z.string().optional(),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    overrides: storedDashboardItemOverridesSchema.optional(),
  })
  .passthrough();

const storedDashboardControlSchema = z
  .object({
    id: z.string(),
    field: z.string(),
    label: z.string().optional(),
    defaultValue: z.unknown().optional(),
    boundInstances: z.array(z.string()),
  })
  .passthrough();

/** Shared structural contract for dashboard JSONB reads and writes. */
export const storedDashboardStateSchema = z.object({
  layout: z
    .array(storedDashboardItemSchema)
    .nullish()
    .transform((value) => value ?? []),
  controls: z
    .array(storedDashboardControlSchema)
    .nullish()
    .transform((value) => value ?? undefined),
});

export function parseStoredDashboardState(
  value: unknown,
  subject: string,
): Pick<Dashboard, "items" | "controls"> {
  const parsed = storedDashboardStateSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "state";
    throw new Error(`${subject} is invalid: ${path} ${issue?.message}`);
  }
  return {
    items: parsed.data.layout as Dashboard["items"],
    controls: parsed.data.controls as Dashboard["controls"],
  };
}
