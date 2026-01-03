/**
 * Debug logging utility for engine-browser package.
 * Conditionally logs debug messages based on environment.
 * Tree-shakeable in production builds.
 */

/**
 * Logs debug messages in development environments only.
 *
 * @param category - Debug category (e.g., 'sql', 'query', 'analyze')
 * @param message - Primary message to log
 * @param args - Additional arguments to log
 *
 * @example
 * debugLog('sql', 'Executing query:', sqlString);
 */
export function debugLog(
  category: string,
  message: string,
  ...args: unknown[]
): void {
  // Only log in development or when explicitly enabled
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PUBLIC_DEBUG === 'true'
  ) {
    console.debug(`[${category}]`, message, ...args);
  }
}
