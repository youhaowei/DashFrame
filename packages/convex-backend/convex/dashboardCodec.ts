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

// A report tightens an Insight's ceiling, never loosens it: `changeable` is
// either absent or exactly `false`.
const storedDashboardItemControlSchema = z
  .object({
    visibility: z.enum(["hidden", "visible", "pinned"]),
    changeable: z
      .boolean()
      .optional()
      .refine((value) => value !== true, {
        message: "a report cannot loosen an Insight's changeable ceiling",
      }),
  })
  .strict();

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
    // An empty map means nothing is disclosed, which is also what absence
    // means, so it is stored as absence on every write path.
    controls: z
      .record(z.string().min(1), storedDashboardItemControlSchema)
      .optional()
      // Only a filter pins to the tile face. A sort or limit has no value to
      // put in a pill, so the reserved keys are hidden or visible, never
      // pinned.
      .refine(
        (value) =>
          value?.sort?.visibility !== "pinned" &&
          value?.limit?.visibility !== "pinned",
        { message: "a sort or limit cannot be pinned to the tile" },
      )
      .transform((value) =>
        value && Object.keys(value).length > 0 ? value : undefined,
      ),
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
