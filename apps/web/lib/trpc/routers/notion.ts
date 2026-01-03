import {
  fetchNotionDatabases,
  fetchNotionDatabaseSchema,
  generateFieldsFromNotionSchema,
  notionToDataFrame,
  type NotionConfig,
} from "@dashframe/connector-notion";
import { z } from "zod";
import { publicProcedure, rateLimitedProcedure, router } from "../server";
import { rateLimitMiddleware } from "../middleware/rate-limit";

export const notionRouter = router({
  listDatabases: rateLimitedProcedure
    .input(
      z.object({
        apiKey: z.string().min(1, "API key is required"),
      }),
    )
    .mutation(async ({ input }) => {
      const { apiKey } = input;
      return await fetchNotionDatabases(apiKey);
    }),

  getDatabaseSchema: publicProcedure
    .use(
      rateLimitMiddleware({
        windowMs: 60000,
        maxRequests: 20,
        name: "getDatabaseSchema",
      }),
    )
    .input(
      z.object({
        apiKey: z.string().min(1, "API key is required"),
        databaseId: z.string().min(1, "Database ID is required"),
      }),
    )
    .mutation(async ({ input }) => {
      const { apiKey, databaseId } = input;
      return await fetchNotionDatabaseSchema(apiKey, databaseId);
    }),

  queryDatabase: publicProcedure
    .use(
      rateLimitMiddleware({
        windowMs: 60000,
        maxRequests: 30,
        name: "queryDatabase",
      }),
    )
    .input(
      z.object({
        apiKey: z.string().min(1, "API key is required"),
        databaseId: z.string().min(1, "Database ID is required"),
        selectedPropertyIds: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { apiKey, databaseId, selectedPropertyIds } = input;

      // Fetch schema and generate fields internally
      const schema = await fetchNotionDatabaseSchema(apiKey, databaseId);
      const dataTableId = databaseId; // Use actual Notion database ID for lineage tracking
      const { fields } = generateFieldsFromNotionSchema(schema, dataTableId);

      // Call notionToDataFrame with generated fields
      const config: NotionConfig = {
        apiKey,
        databaseId,
        selectedPropertyIds,
      };

      return await notionToDataFrame(config, fields);
    }),
});
