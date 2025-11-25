import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

/**
 * DataSources Queries & Mutations
 *
 * CRUD operations for data source connections (Local CSV, Notion, PostgreSQL).
 */

// ============================================================================
// Queries
// ============================================================================

/**
 * List all data sources for the current user
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      return [];
    }

    const dataSources = await ctx.db
      .query("dataSources")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .collect();

    return dataSources;
  },
});

/**
 * Get a single data source by ID
 */
export const get = query({
  args: { id: v.id("dataSources") },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      return null;
    }

    const dataSource = await ctx.db.get(args.id);
    if (!dataSource || dataSource.userId !== identity.subject) {
      return null;
    }

    return dataSource;
  },
});

/**
 * List all data sources with their tables for the current user
 */
export const listWithTables = query({
  args: {},
  handler: async (ctx) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      return [];
    }

    const dataSources = await ctx.db
      .query("dataSources")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .collect();

    const result = await Promise.all(
      dataSources.map(async (dataSource) => {
        const dataTables = await ctx.db
          .query("dataTables")
          .withIndex("by_dataSourceId", (q) =>
            q.eq("dataSourceId", dataSource._id)
          )
          .collect();

        return {
          dataSource,
          dataTables,
          tableCount: dataTables.length,
        };
      })
    );

    return result;
  },
});

/**
 * Get a data source with all its tables
 */
export const getWithTables = query({
  args: { id: v.id("dataSources") },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      return null;
    }

    const dataSource = await ctx.db.get(args.id);
    if (!dataSource || dataSource.userId !== identity.subject) {
      return null;
    }

    const dataTables = await ctx.db
      .query("dataTables")
      .withIndex("by_dataSourceId", (q) => q.eq("dataSourceId", args.id))
      .collect();

    return { dataSource, dataTables };
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new data source
 */
export const create = mutation({
  args: {
    type: v.union(
      v.literal("local"),
      v.literal("notion"),
      v.literal("postgresql")
    ),
    name: v.string(),
    apiKey: v.optional(v.string()),
    connectionString: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const now = Date.now();
    const id = await ctx.db.insert("dataSources", {
      userId: identity.subject,
      type: args.type,
      name: args.name,
      apiKey: args.apiKey,
      connectionString: args.connectionString,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  },
});

/**
 * Update an existing data source
 */
export const update = mutation({
  args: {
    id: v.id("dataSources"),
    name: v.optional(v.string()),
    apiKey: v.optional(v.string()),
    connectionString: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const dataSource = await ctx.db.get(args.id);
    if (!dataSource || dataSource.userId !== identity.subject) {
      throw new Error("Data source not found");
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.apiKey !== undefined) updates.apiKey = args.apiKey;
    if (args.connectionString !== undefined)
      updates.connectionString = args.connectionString;

    await ctx.db.patch(args.id, updates);
    return args.id;
  },
});

/**
 * Delete a data source and cascade delete all related entities
 */
export const remove = mutation({
  args: { id: v.id("dataSources") },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const dataSource = await ctx.db.get(args.id);
    if (!dataSource || dataSource.userId !== identity.subject) {
      throw new Error("Data source not found");
    }

    // Get all data tables for this source
    const dataTables = await ctx.db
      .query("dataTables")
      .withIndex("by_dataSourceId", (q) => q.eq("dataSourceId", args.id))
      .collect();

    // Delete all related entities for each table
    for (const table of dataTables) {
      // Delete fields
      const fields = await ctx.db
        .query("fields")
        .withIndex("by_dataTableId", (q) => q.eq("dataTableId", table._id))
        .collect();
      for (const field of fields) {
        await ctx.db.delete(field._id);
      }

      // Delete metrics
      const metrics = await ctx.db
        .query("metrics")
        .withIndex("by_dataTableId", (q) => q.eq("dataTableId", table._id))
        .collect();
      for (const metric of metrics) {
        await ctx.db.delete(metric._id);
      }

      // Delete insights that use this table
      const insights = await ctx.db
        .query("insights")
        .withIndex("by_baseTableId", (q) => q.eq("baseTableId", table._id))
        .collect();
      for (const insight of insights) {
        // Delete insight metrics
        const insightMetrics = await ctx.db
          .query("insightMetrics")
          .withIndex("by_insightId", (q) => q.eq("insightId", insight._id))
          .collect();
        for (const im of insightMetrics) {
          await ctx.db.delete(im._id);
        }

        // Delete visualizations
        const visualizations = await ctx.db
          .query("visualizations")
          .withIndex("by_insightId", (q) => q.eq("insightId", insight._id))
          .collect();
        for (const viz of visualizations) {
          await ctx.db.delete(viz._id);
        }

        await ctx.db.delete(insight._id);
      }

      // Delete the table itself
      await ctx.db.delete(table._id);
    }

    // Delete the data source
    await ctx.db.delete(args.id);
    return args.id;
  },
});
