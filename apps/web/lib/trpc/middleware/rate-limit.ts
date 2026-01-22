/**
 * Rate limiting middleware for tRPC procedures
 *
 * Applies configurable rate limiting to tRPC endpoints using sliding window algorithm.
 * Extracts client IP from request headers and enforces per-IP rate limits.
 *
 * @example
 * ```ts
 * import { rateLimitMiddleware } from './middleware/rate-limit';
 *
 * // Use with default limits (10 req/min)
 * const rateLimitedProcedure = publicProcedure.use(rateLimitMiddleware());
 *
 * // Use with custom limits
 * const customLimitedProcedure = publicProcedure.use(
 *   rateLimitMiddleware({ windowMs: 60000, maxRequests: 30 })
 * );
 * ```
 */

import { TRPCError } from "@trpc/server";
import { middleware } from "../init";
import {
  createRateLimiter,
  getClientIp,
  type RateLimiterOptions,
} from "../rate-limiter";

/**
 * Rate limiter options for middleware
 * Extends RateLimiterOptions with optional name for better error messages
 */
export interface RateLimitMiddlewareOptions extends RateLimiterOptions {
  /** Optional name for the rate limiter (used in error messages) */
  name?: string;
}

/**
 * Global rate limiter instances keyed by configuration
 * Reuses limiters with the same configuration to avoid creating duplicates
 */
const rateLimiters = new Map<string, ReturnType<typeof createRateLimiter>>();

/**
 * Get or create a rate limiter instance for the given options
 */
function getRateLimiter(options: RateLimitMiddlewareOptions) {
  const key = JSON.stringify({
    windowMs: options.windowMs ?? 60000,
    maxRequests: options.maxRequests ?? 10,
  });

  let limiter = rateLimiters.get(key);
  if (!limiter) {
    limiter = createRateLimiter(options);
    rateLimiters.set(key, limiter);
  }

  return limiter;
}

/**
 * Creates a rate limiting middleware for tRPC procedures
 *
 * @param options - Rate limiter configuration options
 * @returns tRPC middleware that enforces rate limits
 *
 * @example
 * ```ts
 * // Default: 10 requests per minute
 * const defaultRateLimit = rateLimitMiddleware();
 *
 * // Custom: 30 requests per minute
 * const customRateLimit = rateLimitMiddleware({
 *   windowMs: 60000,
 *   maxRequests: 30,
 *   name: 'queryDatabase'
 * });
 *
 * // Apply to procedure
 * export const myProcedure = publicProcedure
 *   .use(customRateLimit)
 *   .mutation(async ({ input }) => {
 *     // Your logic here
 *   });
 * ```
 */
export function rateLimitMiddleware(options: RateLimitMiddlewareOptions = {}) {
  const procedureName = options.name ?? "endpoint";

  return middleware(({ ctx, next }) => {
    const limiter = getRateLimiter(options);
    const clientIp = getClientIp(ctx.headers);
    const result = limiter.checkLimit(clientIp);

    if (!result.success) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Rate limit exceeded for ${procedureName}. Please try again later.`,
        cause: {
          retryAfter: Math.ceil(result.reset / 1000),
          resetMs: result.reset,
          clientIp,
        },
      });
    }

    return next();
  });
}

/**
 * Cleanup function to destroy all rate limiter instances
 * Useful for testing and graceful shutdown
 */
export function destroyAllRateLimiters(): void {
  for (const limiter of rateLimiters.values()) {
    limiter.destroy();
  }
  rateLimiters.clear();
}
