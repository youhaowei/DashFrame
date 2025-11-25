import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

/**
 * Visualizations Queries & Mutations
 *
 * CRUD operations for saved Vega-Lite visualization specs.
 */

// ============================================================================
// Queries
// ============================================================================

/**
 * List all visualizations for the current user
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      return [];
    }

    const visualizations = await ctx.db
      .query("visualizations")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .collect();

    return visualizations;
  },
});

/**
 * Get a single visualization by ID
 */
export const get = query({
  args: { id: v.id("visualizations") },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      return null;
    }

    const visualization = await ctx.db.get(args.id);
    if (!visualization || visualization.userId !== identity.subject) {
      return null;
    }

    return visualization;
  },
});

/**
 * List all visualizations with details for the current user
 */
export const listWithDetails = query({
  args: {},
  handler: async (ctx) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      return [];
    }

    const visualizations = await ctx.db
      .query("visualizations")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .collect();

    const result = await Promise.all(
      visualizations.map(async (visualization) => {
        let insight = null;
        let dataTable = null;
        let sourceType = null;

        if (visualization.insightId) {
          insight = await ctx.db.get(visualization.insightId);
          if (insight?.baseTableId) {
            dataTable = await ctx.db.get(insight.baseTableId);
            if (dataTable?.dataSourceId) {
              const dataSource = await ctx.db.get(dataTable.dataSourceId);
              sourceType = dataSource?.type ?? null;
            }
          }
        }

        return {
          visualization,
          insight,
          dataTable,
          sourceType,
        };
      })
    );

    return result;
  },
});

/**
 * Get visualizations by insight
 */
export const getByInsight = query({
  args: { insightId: v.id("insights") },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      return [];
    }

    const visualizations = await ctx.db
      .query("visualizations")
      .withIndex("by_insightId", (q) => q.eq("insightId", args.insightId))
      .filter((q) => q.eq(q.field("userId"), identity.subject))
      .collect();

    return visualizations;
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new visualization
 */
export const create = mutation({
  args: {
    name: v.string(),
    dataFrameId: v.string(),
    insightId: v.optional(v.id("insights")),
    spec: v.any(),
    visualizationType: v.union(
      v.literal("table"),
      v.literal("bar"),
      v.literal("line"),
      v.literal("scatter"),
      v.literal("area")
    ),
    encoding: v.optional(
      v.object({
        x: v.optional(v.string()),
        y: v.optional(v.string()),
        xType: v.optional(
          v.union(
            v.literal("quantitative"),
            v.literal("nominal"),
            v.literal("ordinal"),
            v.literal("temporal")
          )
        ),
        yType: v.optional(
          v.union(
            v.literal("quantitative"),
            v.literal("nominal"),
            v.literal("ordinal"),
            v.literal("temporal")
          )
        ),
        color: v.optional(v.string()),
        size: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // If linked to an insight, verify user owns it
    if (args.insightId) {
      const insight = await ctx.db.get(args.insightId);
      if (!insight || insight.userId !== identity.subject) {
        throw new Error("Insight not found");
      }
    }

    const now = Date.now();
    const id = await ctx.db.insert("visualizations", {
      userId: identity.subject,
      name: args.name,
      dataFrameId: args.dataFrameId,
      insightId: args.insightId,
      spec: args.spec,
      visualizationType: args.visualizationType,
      encoding: args.encoding,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  },
});

/**
 * Update a visualization
 */
export const update = mutation({
  args: {
    id: v.id("visualizations"),
    name: v.optional(v.string()),
    dataFrameId: v.optional(v.string()),
    spec: v.optional(v.any()),
    visualizationType: v.optional(
      v.union(
        v.literal("table"),
        v.literal("bar"),
        v.literal("line"),
        v.literal("scatter"),
        v.literal("area")
      )
    ),
    encoding: v.optional(
      v.object({
        x: v.optional(v.string()),
        y: v.optional(v.string()),
        xType: v.optional(
          v.union(
            v.literal("quantitative"),
            v.literal("nominal"),
            v.literal("ordinal"),
            v.literal("temporal")
          )
        ),
        yType: v.optional(
          v.union(
            v.literal("quantitative"),
            v.literal("nominal"),
            v.literal("ordinal"),
            v.literal("temporal")
          )
        ),
        color: v.optional(v.string()),
        size: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const visualization = await ctx.db.get(args.id);
    if (!visualization || visualization.userId !== identity.subject) {
      throw new Error("Visualization not found");
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.dataFrameId !== undefined) updates.dataFrameId = args.dataFrameId;
    if (args.spec !== undefined) updates.spec = args.spec;
    if (args.visualizationType !== undefined)
      updates.visualizationType = args.visualizationType;
    if (args.encoding !== undefined) updates.encoding = args.encoding;

    await ctx.db.patch(args.id, updates);
    return args.id;
  },
});

/**
 * Update visualization spec only
 */
export const updateSpec = mutation({
  args: {
    id: v.id("visualizations"),
    spec: v.any(),
  },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const visualization = await ctx.db.get(args.id);
    if (!visualization || visualization.userId !== identity.subject) {
      throw new Error("Visualization not found");
    }

    await ctx.db.patch(args.id, {
      spec: args.spec,
      updatedAt: Date.now(),
    });

    return args.id;
  },
});

/**
 * Update visualization encoding
 */
export const updateEncoding = mutation({
  args: {
    id: v.id("visualizations"),
    encoding: v.object({
      x: v.optional(v.string()),
      y: v.optional(v.string()),
      xType: v.optional(
        v.union(
          v.literal("quantitative"),
          v.literal("nominal"),
          v.literal("ordinal"),
          v.literal("temporal")
        )
      ),
      yType: v.optional(
        v.union(
          v.literal("quantitative"),
          v.literal("nominal"),
          v.literal("ordinal"),
          v.literal("temporal")
        )
      ),
      color: v.optional(v.string()),
      size: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const visualization = await ctx.db.get(args.id);
    if (!visualization || visualization.userId !== identity.subject) {
      throw new Error("Visualization not found");
    }

    await ctx.db.patch(args.id, {
      encoding: args.encoding,
      updatedAt: Date.now(),
    });

    return args.id;
  },
});

/**
 * Delete a visualization
 */
export const remove = mutation({
  args: { id: v.id("visualizations") },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const visualization = await ctx.db.get(args.id);
    if (!visualization || visualization.userId !== identity.subject) {
      throw new Error("Visualization not found");
    }

    await ctx.db.delete(args.id);
    return args.id;
  },
});
