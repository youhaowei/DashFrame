import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

/**
 * Insights Queries & Mutations
 *
 * CRUD operations for user-defined queries and transformations.
 */

// ============================================================================
// Queries
// ============================================================================

/**
 * List all insights for the current user
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      return [];
    }

    const insights = await ctx.db
      .query("insights")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    return insights;
  },
});

/**
 * Get a single insight by ID
 */
export const get = query({
  args: { id: v.id("insights") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      return null;
    }

    const insight = await ctx.db.get(args.id);
    if (!insight || insight.userId !== userId) {
      return null;
    }

    return insight;
  },
});

/**
 * Get an insight with all its metrics
 */
export const getWithMetrics = query({
  args: { id: v.id("insights") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      return null;
    }

    const insight = await ctx.db.get(args.id);
    if (!insight || insight.userId !== userId) {
      return null;
    }

    const metrics = await ctx.db
      .query("insightMetrics")
      .withIndex("by_insightId", (q) => q.eq("insightId", args.id))
      .collect();

    return { insight, metrics };
  },
});

/**
 * Get insights by base table
 */
export const getByBaseTable = query({
  args: { baseTableId: v.id("dataTables") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      return [];
    }

    const insights = await ctx.db
      .query("insights")
      .withIndex("by_baseTableId", (q) => q.eq("baseTableId", args.baseTableId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();

    return insights;
  },
});

/**
 * List all insights with related data (table, source, visualization count)
 * Optimized for the insights list page to avoid N+1 queries
 */
export const listWithDetails = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      return [];
    }

    const insights = await ctx.db
      .query("insights")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    // Get all visualizations for counting
    const allVisualizations = await ctx.db
      .query("visualizations")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    // Build a map of insightId -> visualization count
    const vizCountByInsight = new Map<string, number>();
    for (const viz of allVisualizations) {
      if (viz.insightId) {
        const count = vizCountByInsight.get(viz.insightId) ?? 0;
        vizCountByInsight.set(viz.insightId, count + 1);
      }
    }

    // Fetch related data for each insight
    const results = await Promise.all(
      insights.map(async (insight) => {
        const dataTable = await ctx.db.get(insight.baseTableId);
        let dataSource = null;
        if (dataTable) {
          dataSource = await ctx.db.get(dataTable.dataSourceId);
        }

        return {
          insight,
          dataTable,
          sourceType: dataSource?.type ?? null,
          visualizationCount: vizCountByInsight.get(insight._id) ?? 0,
        };
      })
    );

    return results;
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new insight (draft)
 */
export const create = mutation({
  args: {
    name: v.string(),
    baseTableId: v.id("dataTables"),
    selectedFieldIds: v.optional(v.array(v.id("fields"))),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Verify the base table exists and user owns it
    const dataTable = await ctx.db.get(args.baseTableId);
    if (!dataTable) {
      throw new Error("Data table not found");
    }

    const dataSource = await ctx.db.get(dataTable.dataSourceId);
    if (!dataSource || dataSource.userId !== userId) {
      throw new Error("Data table not found");
    }

    const now = Date.now();
    const id = await ctx.db.insert("insights", {
      userId: userId,
      name: args.name,
      baseTableId: args.baseTableId,
      selectedFieldIds: args.selectedFieldIds ?? [],
      createdAt: now,
      updatedAt: now,
    });

    return id;
  },
});

/**
 * Update an insight
 */
export const update = mutation({
  args: {
    id: v.id("insights"),
    name: v.optional(v.string()),
    selectedFieldIds: v.optional(v.array(v.id("fields"))),
    filters: v.optional(
      v.object({
        excludeNulls: v.optional(v.boolean()),
        limit: v.optional(v.number()),
        orderBy: v.optional(
          v.object({
            fieldOrMetricId: v.string(),
            direction: v.union(v.literal("asc"), v.literal("desc")),
          })
        ),
      })
    ),
    dataFrameId: v.optional(v.string()),
    lastComputedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const insight = await ctx.db.get(args.id);
    if (!insight || insight.userId !== userId) {
      throw new Error("Insight not found");
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.selectedFieldIds !== undefined)
      updates.selectedFieldIds = args.selectedFieldIds;
    if (args.filters !== undefined) updates.filters = args.filters;
    if (args.dataFrameId !== undefined) updates.dataFrameId = args.dataFrameId;
    if (args.lastComputedAt !== undefined)
      updates.lastComputedAt = args.lastComputedAt;

    await ctx.db.patch(args.id, updates);
    return args.id;
  },
});

/**
 * Fork an insight (create a copy for visualization-specific modifications)
 */
export const fork = mutation({
  args: { id: v.id("insights") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const original = await ctx.db.get(args.id);
    if (!original || original.userId !== userId) {
      throw new Error("Insight not found");
    }

    const now = Date.now();
    const forkId = await ctx.db.insert("insights", {
      userId: userId,
      name: `${original.name} (copy)`,
      baseTableId: original.baseTableId,
      selectedFieldIds: [...original.selectedFieldIds],
      filters: original.filters,
      forkedFromId: args.id,
      createdAt: now,
      updatedAt: now,
    });

    // Copy insight metrics
    const metrics = await ctx.db
      .query("insightMetrics")
      .withIndex("by_insightId", (q) => q.eq("insightId", args.id))
      .collect();

    for (const metric of metrics) {
      await ctx.db.insert("insightMetrics", {
        insightId: forkId,
        name: metric.name,
        sourceTableId: metric.sourceTableId,
        columnName: metric.columnName,
        aggregation: metric.aggregation,
        createdAt: now,
      });
    }

    return forkId;
  },
});

/**
 * Delete an insight and cascade delete metrics
 */
export const remove = mutation({
  args: { id: v.id("insights") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const insight = await ctx.db.get(args.id);
    if (!insight || insight.userId !== userId) {
      throw new Error("Insight not found");
    }

    // Delete insight metrics
    const metrics = await ctx.db
      .query("insightMetrics")
      .withIndex("by_insightId", (q) => q.eq("insightId", args.id))
      .collect();
    for (const metric of metrics) {
      await ctx.db.delete(metric._id);
    }

    // Delete visualizations using this insight
    const visualizations = await ctx.db
      .query("visualizations")
      .withIndex("by_insightId", (q) => q.eq("insightId", args.id))
      .collect();
    for (const viz of visualizations) {
      await ctx.db.delete(viz._id);
    }

    // Delete the insight
    await ctx.db.delete(args.id);
    return args.id;
  },
});

// ============================================================================
// Insight Metrics
// ============================================================================

/**
 * Add a metric to an insight
 */
export const addMetric = mutation({
  args: {
    insightId: v.id("insights"),
    name: v.string(),
    sourceTableId: v.id("dataTables"),
    columnName: v.optional(v.string()),
    aggregation: v.union(
      v.literal("sum"),
      v.literal("avg"),
      v.literal("count"),
      v.literal("min"),
      v.literal("max"),
      v.literal("count_distinct")
    ),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const insight = await ctx.db.get(args.insightId);
    if (!insight || insight.userId !== userId) {
      throw new Error("Insight not found");
    }

    const id = await ctx.db.insert("insightMetrics", {
      insightId: args.insightId,
      name: args.name,
      sourceTableId: args.sourceTableId,
      columnName: args.columnName,
      aggregation: args.aggregation,
      createdAt: Date.now(),
    });

    // Update insight's updatedAt
    await ctx.db.patch(args.insightId, { updatedAt: Date.now() });

    return id;
  },
});

/**
 * Update an insight metric
 */
export const updateMetric = mutation({
  args: {
    id: v.id("insightMetrics"),
    name: v.optional(v.string()),
    columnName: v.optional(v.string()),
    aggregation: v.optional(
      v.union(
        v.literal("sum"),
        v.literal("avg"),
        v.literal("count"),
        v.literal("min"),
        v.literal("max"),
        v.literal("count_distinct")
      )
    ),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const metric = await ctx.db.get(args.id);
    if (!metric) {
      throw new Error("Metric not found");
    }

    const insight = await ctx.db.get(metric.insightId);
    if (!insight || insight.userId !== userId) {
      throw new Error("Metric not found");
    }

    const updates: Record<string, unknown> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.columnName !== undefined) updates.columnName = args.columnName;
    if (args.aggregation !== undefined) updates.aggregation = args.aggregation;

    await ctx.db.patch(args.id, updates);

    // Update insight's updatedAt
    await ctx.db.patch(metric.insightId, { updatedAt: Date.now() });

    return args.id;
  },
});

/**
 * Remove an insight metric
 */
export const removeMetric = mutation({
  args: { id: v.id("insightMetrics") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const metric = await ctx.db.get(args.id);
    if (!metric) {
      throw new Error("Metric not found");
    }

    const insight = await ctx.db.get(metric.insightId);
    if (!insight || insight.userId !== userId) {
      throw new Error("Metric not found");
    }

    await ctx.db.delete(args.id);

    // Update insight's updatedAt
    await ctx.db.patch(metric.insightId, { updatedAt: Date.now() });

    return args.id;
  },
});
