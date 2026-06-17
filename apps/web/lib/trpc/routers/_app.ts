import { router } from "../server";

/**
 * This is the primary router for your server.
 * All routers added here should be manually added to the root router
 */
export const appRouter = router({});

// Export type router type signature for the client
export type AppRouter = typeof appRouter;
