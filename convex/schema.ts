import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * DashFrame Convex Schema
 *
 * Entity hierarchy:
 * DataSource → DataTable → Field/Metric
 *            ↘ Insight → InsightMetric
 *                      ↘ Visualization
 *
 * DataFrames are kept client-side (localStorage/IndexedDB) for performance.
 *
 * Auth tables are provided by @convex-dev/auth for anonymous and OAuth authentication.
 */
export default defineSchema({
  // =====================================================
  // AUTH TABLES - Convex Auth (users, sessions, accounts)
  // =====================================================
  ...authTables,


  // =====================================================
  // DATA SOURCES - Top-level data connections
  // =====================================================
  dataSources: defineTable({
    userId: v.string(),
    type: v.union(
      v.literal("local"),
      v.literal("notion"),
      v.literal("postgresql")
    ),
    name: v.string(),
    // Type-specific credentials (encrypted in production)
    apiKey: v.optional(v.string()), // Notion only
    connectionString: v.optional(v.string()), // PostgreSQL only
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_type", ["type"]),

  // =====================================================
  // DATA TABLES - Tables within a data source
  // =====================================================
  dataTables: defineTable({
    dataSourceId: v.id("dataSources"),
    name: v.string(),
    // Source identifier (Notion DB ID, CSV filename, PostgreSQL table)
    table: v.string(),
    // Discovered schema from source
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
    // Client-side DataFrame reference (stored in localStorage)
    dataFrameId: v.optional(v.string()),
    lastFetchedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_dataSourceId", ["dataSourceId"]),

  // =====================================================
  // FIELDS - Columns in a data table
  // =====================================================
  fields: defineTable({
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
    createdAt: v.number(),
  }).index("by_dataTableId", ["dataTableId"]),

  // =====================================================
  // METRICS - Aggregations on a data table
  // =====================================================
  metrics: defineTable({
    dataTableId: v.id("dataTables"),
    name: v.string(),
    columnName: v.optional(v.string()), // undefined for count()
    aggregation: v.union(
      v.literal("sum"),
      v.literal("avg"),
      v.literal("count"),
      v.literal("min"),
      v.literal("max"),
      v.literal("count_distinct")
    ),
    createdAt: v.number(),
  }).index("by_dataTableId", ["dataTableId"]),

  // =====================================================
  // INSIGHTS - User-defined queries/transformations
  // =====================================================
  insights: defineTable({
    userId: v.string(),
    name: v.string(),
    // Base table reference
    baseTableId: v.id("dataTables"),
    // Selected field IDs (array of field document IDs)
    selectedFieldIds: v.array(v.id("fields")),
    // Filtering and sorting options
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
    // Forking support
    forkedFromId: v.optional(v.id("insights")),
    // Client-side DataFrame reference (execution result)
    dataFrameId: v.optional(v.string()),
    lastComputedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_baseTableId", ["baseTableId"]),

  // =====================================================
  // INSIGHT METRICS - Aggregations within an insight
  // =====================================================
  insightMetrics: defineTable({
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
    createdAt: v.number(),
  }).index("by_insightId", ["insightId"]),

  // =====================================================
  // VISUALIZATIONS - Saved Vega-Lite specs
  // =====================================================
  visualizations: defineTable({
    userId: v.string(),
    name: v.string(),
    // Data references
    dataFrameId: v.string(), // Client-side reference
    insightId: v.optional(v.id("insights")),
    // Vega-Lite spec (without data - data injected at render)
    spec: v.any(), // TopLevelSpec from vega-lite
    // Visual type for UI
    visualizationType: v.union(
      v.literal("table"),
      v.literal("bar"),
      v.literal("line"),
      v.literal("scatter"),
      v.literal("area")
    ),
    // Column encodings
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_insightId", ["insightId"]),
});
