/**
 * @dashframe/core-store
 *
 * Stub package for storage backend selection.
 *
 * TypeScript sees the type declarations from @dashframe/core-dexie (default backend).
 * Webpack replaces this module at build time based on NEXT_PUBLIC_DATA_BACKEND env var.
 *
 * @example
 * ```bash
 * # Use Dexie backend (default)
 * NEXT_PUBLIC_DATA_BACKEND=dexie bun dev
 *
 * # Use custom backend
 * NEXT_PUBLIC_DATA_BACKEND=custom bun dev
 * ```
 */

// Re-export all types and implementations from the default storage backend
// Webpack will replace this entire module at build time
export * from "@dashframe/core-dexie";
