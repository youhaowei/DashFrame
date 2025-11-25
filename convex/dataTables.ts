import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

/**
 * DataTables Queries & Mutations
 *
 * CRUD operations for data tables within a data source.
 */

// ============================================================================
// Queries
// ============================================================================

/**
 * List all tables for a data source
 */
export const list = query({
  args: { dataSourceId: v.id("dataSources") },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      return [];
    }

    // Verify user owns the data source
    const dataSource = await ctx.db.get(args.dataSourceId);
    if (!dataSource || dataSource.userId !== identity.subject) {
      return [];
    }

    const dataTables = await ctx.db
      .query("dataTables")
      .withIndex("by_dataSourceId", (q) =>
        q.eq("dataSourceId", args.dataSourceId)
      )
      .collect();

    return dataTables;
  },
});

/**
 * Get a single table by ID
 */
export const get = query({
  args: { id: v.id("dataTables") },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      return null;
    }

    const dataTable = await ctx.db.get(args.id);
    if (!dataTable) {
      return null;
    }

    // Verify user owns the parent data source
    const dataSource = await ctx.db.get(dataTable.dataSourceId);
    if (!dataSource || dataSource.userId !== identity.subject) {
      return null;
    }

    return dataTable;
  },
});

/**
 * Get a table with all its fields and metrics
 */
export const getWithFieldsAndMetrics = query({
  args: { id: v.id("dataTables") },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      return null;
    }

    const dataTable = await ctx.db.get(args.id);
    if (!dataTable) {
      return null;
    }

    // Verify user owns the parent data source
    const dataSource = await ctx.db.get(dataTable.dataSourceId);
    if (!dataSource || dataSource.userId !== identity.subject) {
      return null;
    }

    const fields = await ctx.db
      .query("fields")
      .withIndex("by_dataTableId", (q) => q.eq("dataTableId", args.id))
      .collect();

    const metrics = await ctx.db
      .query("metrics")
      .withIndex("by_dataTableId", (q) => q.eq("dataTableId", args.id))
      .collect();

    return { dataTable, fields, metrics };
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new data table
 */
export const create = mutation({
  args: {
    dataSourceId: v.id("dataSources"),
    name: v.string(),
    table: v.string(),
    sourceSchema: v.optional(
      v.object({
        fields: v.array(
          v.object({
            name: v.string(),
            type: v.string(),
            notionType: v.optional(v.string()),
          })
        ),
      })
    ),
    dataFrameId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Verify user owns the data source
    const dataSource = await ctx.db.get(args.dataSourceId);
    if (!dataSource || dataSource.userId !== identity.subject) {
      throw new Error("Data source not found");
    }

    const id = await ctx.db.insert("dataTables", {
      dataSourceId: args.dataSourceId,
      name: args.name,
      table: args.table,
      sourceSchema: args.sourceSchema,
      dataFrameId: args.dataFrameId,
      createdAt: Date.now(),
    });

    // Auto-create fields from source schema
    if (args.sourceSchema) {
      for (const schemaField of args.sourceSchema.fields) {
        await ctx.db.insert("fields", {
          dataTableId: id,
          name: schemaField.name,
          columnName: schemaField.name,
          type: mapSchemaType(schemaField.type),
          createdAt: Date.now(),
        });
      }

      // Auto-create default count metric
      await ctx.db.insert("metrics", {
        dataTableId: id,
        name: "Count",
        aggregation: "count",
        createdAt: Date.now(),
      });
    }

    return id;
  },
});

/**
 * Update a data table
 */
export const update = mutation({
  args: {
    id: v.id("dataTables"),
    name: v.optional(v.string()),
    sourceSchema: v.optional(
      v.object({
        fields: v.array(
          v.object({
            name: v.string(),
            type: v.string(),
            notionType: v.optional(v.string()),
          })
        ),
      })
    ),
    dataFrameId: v.optional(v.string()),
    lastFetchedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const dataTable = await ctx.db.get(args.id);
    if (!dataTable) {
      throw new Error("Data table not found");
    }

    // Verify user owns the parent data source
    const dataSource = await ctx.db.get(dataTable.dataSourceId);
    if (!dataSource || dataSource.userId !== identity.subject) {
      throw new Error("Data table not found");
    }

    const updates: Record<string, unknown> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.sourceSchema !== undefined) updates.sourceSchema = args.sourceSchema;
    if (args.dataFrameId !== undefined) updates.dataFrameId = args.dataFrameId;
    if (args.lastFetchedAt !== undefined) updates.lastFetchedAt = args.lastFetchedAt;

    await ctx.db.patch(args.id, updates);
    return args.id;
  },
});

/**
 * Delete a data table and cascade delete fields/metrics
 */
export const remove = mutation({
  args: { id: v.id("dataTables") },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const dataTable = await ctx.db.get(args.id);
    if (!dataTable) {
      throw new Error("Data table not found");
    }

    // Verify user owns the parent data source
    const dataSource = await ctx.db.get(dataTable.dataSourceId);
    if (!dataSource || dataSource.userId !== identity.subject) {
      throw new Error("Data table not found");
    }

    // Delete fields
    const fields = await ctx.db
      .query("fields")
      .withIndex("by_dataTableId", (q) => q.eq("dataTableId", args.id))
      .collect();
    for (const field of fields) {
      await ctx.db.delete(field._id);
    }

    // Delete metrics
    const metrics = await ctx.db
      .query("metrics")
      .withIndex("by_dataTableId", (q) => q.eq("dataTableId", args.id))
      .collect();
    for (const metric of metrics) {
      await ctx.db.delete(metric._id);
    }

    // Delete the table
    await ctx.db.delete(args.id);
    return args.id;
  },
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map source schema type to our field type
 */
function mapSchemaType(
  sourceType: string
): "string" | "number" | "date" | "boolean" {
  const type = sourceType.toLowerCase();
  if (type.includes("number") || type.includes("int") || type.includes("float")) {
    return "number";
  }
  if (type.includes("date") || type.includes("time")) {
    return "date";
  }
  if (type.includes("bool")) {
    return "boolean";
  }
  return "string";
}
