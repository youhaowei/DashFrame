import { publicProcedure } from "./init";
import { rateLimitMiddleware } from "./middleware/rate-limit";

// Re-export tRPC primitives from init.ts to maintain backward compatibility
// The init.ts file exists to break circular dependencies between server.ts and middleware/rate-limit.ts
export { middleware, publicProcedure, router, type Context } from "./init";

/**
 * Rate-limited procedure with default limits (10 requests per minute)
 *
 * Use this for API endpoints that need basic rate limiting protection.
 * The rate limit is applied per client IP address using a sliding window algorithm.
 *
 * Default limits:
 * - Window: 60 seconds
 * - Max requests: 10
 *
 * When rate limit is exceeded, throws TRPCError with code 'TOO_MANY_REQUESTS'
 * and includes retry-after information in the error cause.
 *
 * @example
 * ```ts
 * import { rateLimitedProcedure } from '@/lib/trpc/server';
 *
 * // Use default rate limiting (10 req/min)
 * export const listItems = rateLimitedProcedure
 *   .input(z.object({ id: z.string() }))
 *   .query(async ({ input }) => {
 *     // Your logic here
 *   });
 * ```
 *
 * @example
 * ```ts
 * // For custom limits, use publicProcedure with rateLimitMiddleware
 * import { publicProcedure } from '@/lib/trpc/server';
 * import { rateLimitMiddleware } from '@/lib/trpc/middleware/rate-limit';
 *
 * export const heavyQuery = publicProcedure
 *   .use(rateLimitMiddleware({
 *     windowMs: 60000,
 *     maxRequests: 30,
 *     name: 'heavyQuery'
 *   }))
 *   .query(async ({ input }) => {
 *     // Your logic here
 *   });
 * ```
 *
 * @see rateLimitMiddleware For creating procedures with custom rate limits
 */
export const rateLimitedProcedure = publicProcedure.use(rateLimitMiddleware());
