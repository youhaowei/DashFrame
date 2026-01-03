import { initTRPC } from "@trpc/server";
import superjson from "superjson";

/**
 * Context type for tRPC procedures
 * Includes request headers for IP extraction and rate limiting
 */
export interface Context {
  /** Request headers (for IP extraction in rate limiting middleware) */
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
