import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

/**
 * Fields Queries & Mutations
 *
 * CRUD operations for fields (columns) within a data table.
 */

// ============================================================================
// Queries
// ============================================================================

/**
 * List all fields for a data table
 */
export const list = query({
  args: { dataTableId: v.id("dataTables") },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      return [];
    }

    // Verify user owns the data table
    const dataTable = await ctx.db.get(args.dataTableId);
    if (!dataTable) {
      return [];
    }

    const dataSource = await ctx.db.get(dataTable.dataSourceId);
    if (!dataSource || dataSource.userId !== identity.subject) {
      return [];
    }

    const fields = await ctx.db
      .query("fields")
      .withIndex("by_dataTableId", (q) => q.eq("dataTableId", args.dataTableId))
      .collect();

    return fields;
  },
});

/**
 * Get a single field by ID
 */
export const get = query({
  args: { id: v.id("fields") },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      return null;
    }

    const field = await ctx.db.get(args.id);
    if (!field) {
      return null;
    }

    // Verify user owns the parent data table
    const dataTable = await ctx.db.get(field.dataTableId);
    if (!dataTable) {
      return null;
    }

    const dataSource = await ctx.db.get(dataTable.dataSourceId);
    if (!dataSource || dataSource.userId !== identity.subject) {
      return null;
    }

    return field;
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new field
 */
export const create = mutation({
  args: {
    dataTableId: v.id("dataTables"),
    name: v.string(),
    columnName: v.string(),
    type: v.union(
      v.literal("string"),
      v.literal("number"),
      v.literal("date"),
      v.literal("boolean")
    ),
    isIdentifier: v.optional(v.boolean()),
    isReference: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Verify user owns the data table
    const dataTable = await ctx.db.get(args.dataTableId);
    if (!dataTable) {
      throw new Error("Data table not found");
    }

    const dataSource = await ctx.db.get(dataTable.dataSourceId);
    if (!dataSource || dataSource.userId !== identity.subject) {
      throw new Error("Data table not found");
    }

    const id = await ctx.db.insert("fields", {
      dataTableId: args.dataTableId,
      name: args.name,
      columnName: args.columnName,
      type: args.type,
      isIdentifier: args.isIdentifier,
      isReference: args.isReference,
      createdAt: Date.now(),
    });

    return id;
  },
});

/**
 * Update a field
 */
export const update = mutation({
  args: {
    id: v.id("fields"),
    name: v.optional(v.string()),
    type: v.optional(
      v.union(
        v.literal("string"),
        v.literal("number"),
        v.literal("date"),
        v.literal("boolean")
      )
    ),
    isIdentifier: v.optional(v.boolean()),
    isReference: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const field = await ctx.db.get(args.id);
    if (!field) {
      throw new Error("Field not found");
    }

    // Verify user owns the parent data table
    const dataTable = await ctx.db.get(field.dataTableId);
    if (!dataTable) {
      throw new Error("Field not found");
    }

    const dataSource = await ctx.db.get(dataTable.dataSourceId);
    if (!dataSource || dataSource.userId !== identity.subject) {
      throw new Error("Field not found");
    }

    const updates: Record<string, unknown> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.type !== undefined) updates.type = args.type;
    if (args.isIdentifier !== undefined) updates.isIdentifier = args.isIdentifier;
    if (args.isReference !== undefined) updates.isReference = args.isReference;

    await ctx.db.patch(args.id, updates);
    return args.id;
  },
});

/**
 * Delete a field
 */
export const remove = mutation({
  args: { id: v.id("fields") },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const field = await ctx.db.get(args.id);
    if (!field) {
      throw new Error("Field not found");
    }

    // Verify user owns the parent data table
    const dataTable = await ctx.db.get(field.dataTableId);
    if (!dataTable) {
      throw new Error("Field not found");
    }

    const dataSource = await ctx.db.get(dataTable.dataSourceId);
    if (!dataSource || dataSource.userId !== identity.subject) {
      throw new Error("Field not found");
    }

    await ctx.db.delete(args.id);
    return args.id;
  },
});

/**
 * Batch create fields
 */
export const batchCreate = mutation({
  args: {
    dataTableId: v.id("dataTables"),
    fields: v.array(
      v.object({
        name: v.string(),
        columnName: v.string(),
        type: v.union(
          v.literal("string"),
          v.literal("number"),
          v.literal("date"),
          v.literal("boolean")
        ),
        isIdentifier: v.optional(v.boolean()),
        isReference: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const identity = await auth.getUserIdentity(ctx);
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Verify user owns the data table
    const dataTable = await ctx.db.get(args.dataTableId);
    if (!dataTable) {
      throw new Error("Data table not found");
    }

    const dataSource = await ctx.db.get(dataTable.dataSourceId);
    if (!dataSource || dataSource.userId !== identity.subject) {
      throw new Error("Data table not found");
    }

    const now = Date.now();
    const ids: string[] = [];

    for (const field of args.fields) {
      const id = await ctx.db.insert("fields", {
        dataTableId: args.dataTableId,
        name: field.name,
        columnName: field.columnName,
        type: field.type,
        isIdentifier: field.isIdentifier,
        isReference: field.isReference,
        createdAt: now,
      });
      ids.push(id);
    }

    return ids;
  },
});
