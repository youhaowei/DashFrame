import { z } from "zod";
import { router, publicProcedure } from "../server";
import {
  fetchNotionDatabases,
  fetchNotionDatabaseSchema,
  notionToDataFrame,
  type NotionConfig,
} from "@dash-frame/notion";

export const notionRouter = router({
  listDatabases: publicProcedure
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
    .input(
      z.object({
        apiKey: z.string().min(1, "API key is required"),
        databaseId: z.string().min(1, "Database ID is required"),
        selectedPropertyIds: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return await notionToDataFrame(input as NotionConfig);
    }),
});
