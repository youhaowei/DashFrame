/**
 * Sliding window rate limiter for tRPC endpoints
 *
 * Provides in-memory rate limiting with configurable window sizes and request limits.
 * Uses a sliding window algorithm to prevent burst abuse at window boundaries.
 *
 * @example
 * ```ts
 * const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 10 });
 * const result = limiter.checkLimit("user-ip-address");
 * if (!result.success) {
 *   throw new Error(`Rate limit exceeded. Retry after ${result.reset}ms`);
 * }
 * ```
 */

/**
 * Configuration options for the rate limiter
 */
export interface RateLimiterOptions {
  /** Time window in milliseconds (default: 60000ms = 1 minute) */
  windowMs?: number;
  /** Maximum number of requests allowed within the window (default: 10) */
  maxRequests?: number;
  /** Cleanup interval in milliseconds (default: 60000ms = 1 minute) */
  cleanupIntervalMs?: number;
}

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  success: boolean;
  /** Number of requests remaining in the current window */
  remaining: number;
  /** Milliseconds until the rate limit resets */
  reset: number;
}

/**
 * Tracks request timestamps for a single identifier
 */
interface RateLimitEntry {
  timestamps: number[];
  lastAccess: number;
}

/**
 * Rate limiter instance with sliding window algorithm
 */
export interface RateLimiter {
  /**
   * Check if a request should be allowed for the given identifier
   * @param identifier - Unique identifier (e.g., IP address)
   * @returns Rate limit check result
   */
  checkLimit: (identifier: string) => RateLimitResult;

  /**
   * Reset rate limit for a specific identifier (useful for testing)
   * @param identifier - Unique identifier to reset
   */
  reset: (identifier: string) => void;

  /**
   * Clear all rate limit data (useful for testing)
   */
  clear: () => void;

  /**
   * Stop the cleanup interval (useful for testing and cleanup)
   */
  destroy: () => void;
}

/**
 * Creates a new rate limiter instance
 *
 * @param options - Configuration options
 * @returns Rate limiter instance
 *
 * @example
 * ```ts
 * const limiter = createRateLimiter({
 *   windowMs: 60000,      // 1 minute window
 *   maxRequests: 10,       // 10 requests per window
 * });
 * ```
 */
export function createRateLimiter(
  options: RateLimiterOptions = {},
): RateLimiter {
  const windowMs = options.windowMs ?? 60000; // Default: 1 minute
  const maxRequests = options.maxRequests ?? 10; // Default: 10 requests
  const cleanupIntervalMs = options.cleanupIntervalMs ?? 60000; // Default: 1 minute

  // In-memory storage: identifier -> timestamps
  const store = new Map<string, RateLimitEntry>();

  /**
   * Remove expired entries to prevent memory leaks
   */
  function cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of store.entries()) {
      // Remove entries that haven't been accessed in 2x the window duration
      if (now - entry.lastAccess > windowMs * 2) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      store.delete(key);
    }
  }

  // Set up automatic cleanup
  const cleanupInterval = setInterval(cleanup, cleanupIntervalMs);

  /**
   * Check if a request should be allowed
   */
  function checkLimit(identifier: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get or create entry
    let entry = store.get(identifier);
    if (!entry) {
      entry = { timestamps: [], lastAccess: now };
      store.set(identifier, entry);
    }

    // Update last access time
    entry.lastAccess = now;

    // Remove timestamps outside the current window (sliding window)
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

    // Check if limit is exceeded
    if (entry.timestamps.length >= maxRequests) {
      // Calculate when the oldest request in the window will expire
      const oldestTimestamp = entry.timestamps[0];
      const resetMs = oldestTimestamp + windowMs - now;

      return {
        success: false,
        remaining: 0,
        reset: Math.max(0, resetMs),
      };
    }

    // Add current timestamp
    entry.timestamps.push(now);

    // Calculate remaining requests and reset time
    const remaining = maxRequests - entry.timestamps.length;
    const oldestTimestamp = entry.timestamps[0];
    const resetMs = oldestTimestamp + windowMs - now;

    return {
      success: true,
      remaining,
      reset: Math.max(0, resetMs),
    };
  }

  /**
   * Reset rate limit for a specific identifier
   */
  function reset(identifier: string): void {
    store.delete(identifier);
  }

  /**
   * Clear all rate limit data
   */
  function clear(): void {
    store.clear();
  }

  /**
   * Stop the cleanup interval
   */
  function destroy(): void {
    clearInterval(cleanupInterval);
  }

  return {
    checkLimit,
    reset,
    clear,
    destroy,
  };
}

/**
 * Extract IP address from request headers
 *
 * Checks common headers used by proxies and load balancers:
 * - x-forwarded-for (standard proxy header)
 * - x-real-ip (nginx)
 *
 * @param headers - Request headers (Record<string, string | string[] | undefined>)
 * @returns IP address or 'unknown' for local development
 *
 * @example
 * ```ts
 * const ip = getClientIp(request.headers);
 * const result = limiter.checkLimit(ip);
 * ```
 */
export function getClientIp(
  headers: Record<string, string | string[] | undefined>,
): string {
  // Try x-forwarded-for first (most common)
  const forwardedFor = headers["x-forwarded-for"];
  if (forwardedFor) {
    // x-forwarded-for can be comma-separated list: "client, proxy1, proxy2"
    // The first IP is the original client
    const firstIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor.split(",")[0];
    return firstIp?.trim() ?? "unknown";
  }

  // Try x-real-ip (nginx)
  const realIp = headers["x-real-ip"];
  if (realIp) {
    return Array.isArray(realIp) ? (realIp[0] ?? "unknown") : realIp;
  }

  // Fallback for local development
  return "unknown";
}
