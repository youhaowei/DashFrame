import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

/**
 * Metrics Queries & Mutations
 *
 * CRUD operations for metrics (aggregations) within a data table.
 */

// ============================================================================
// Queries
// ============================================================================

/**
 * List all metrics for a data table
 */
export const list = query({
  args: { dataTableId: v.id("dataTables") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      return [];
    }

    // Verify user owns the data table
    const dataTable = await ctx.db.get(args.dataTableId);
    if (!dataTable) {
      return [];
    }

    const dataSource = await ctx.db.get(dataTable.dataSourceId);
    if (!dataSource || dataSource.userId !== userId) {
      return [];
    }

    const metrics = await ctx.db
      .query("metrics")
      .withIndex("by_dataTableId", (q) => q.eq("dataTableId", args.dataTableId))
      .collect();

    return metrics;
  },
});

/**
 * Get a single metric by ID
 */
export const get = query({
  args: { id: v.id("metrics") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      return null;
    }

    const metric = await ctx.db.get(args.id);
    if (!metric) {
      return null;
    }

    // Verify user owns the parent data table
    const dataTable = await ctx.db.get(metric.dataTableId);
    if (!dataTable) {
      return null;
    }

    const dataSource = await ctx.db.get(dataTable.dataSourceId);
    if (!dataSource || dataSource.userId !== userId) {
      return null;
    }

    return metric;
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new metric
 */
export const create = mutation({
  args: {
    dataTableId: v.id("dataTables"),
    name: v.string(),
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

    // Verify user owns the data table
    const dataTable = await ctx.db.get(args.dataTableId);
    if (!dataTable) {
      throw new Error("Data table not found");
    }

    const dataSource = await ctx.db.get(dataTable.dataSourceId);
    if (!dataSource || dataSource.userId !== userId) {
      throw new Error("Data table not found");
    }

    const id = await ctx.db.insert("metrics", {
      dataTableId: args.dataTableId,
      name: args.name,
      columnName: args.columnName,
      aggregation: args.aggregation,
      createdAt: Date.now(),
    });

    return id;
  },
});

/**
 * Update a metric
 */
export const update = mutation({
  args: {
    id: v.id("metrics"),
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

    // Verify user owns the parent data table
    const dataTable = await ctx.db.get(metric.dataTableId);
    if (!dataTable) {
      throw new Error("Metric not found");
    }

    const dataSource = await ctx.db.get(dataTable.dataSourceId);
    if (!dataSource || dataSource.userId !== userId) {
      throw new Error("Metric not found");
    }

    const updates: Record<string, unknown> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.columnName !== undefined) updates.columnName = args.columnName;
    if (args.aggregation !== undefined) updates.aggregation = args.aggregation;

    await ctx.db.patch(args.id, updates);
    return args.id;
  },
});

/**
 * Delete a metric
 */
export const remove = mutation({
  args: { id: v.id("metrics") },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const metric = await ctx.db.get(args.id);
    if (!metric) {
      throw new Error("Metric not found");
    }

    // Verify user owns the parent data table
    const dataTable = await ctx.db.get(metric.dataTableId);
    if (!dataTable) {
      throw new Error("Metric not found");
    }

    const dataSource = await ctx.db.get(dataTable.dataSourceId);
    if (!dataSource || dataSource.userId !== userId) {
      throw new Error("Metric not found");
    }

    await ctx.db.delete(args.id);
    return args.id;
  },
});
