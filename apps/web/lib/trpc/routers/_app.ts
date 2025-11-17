import { router } from "../server";
import { notionRouter } from "./notion";

/**
 * This is the primary router for your server.
 * All routers added here should be manually added to the root router
 */
export const appRouter = router({
  notion: notionRouter,
});

// Export type router type signature for the client
export type AppRouter = typeof appRouter;
